/** Shared ZIP layout. JSZip is supplied by the caller; this module has no dependencies. */
export const DOWNLOAD_PACKAGE_FORMAT_VERSION = 1;
export const QUICK_START_GUIDE_FILENAME = 'LALOSCH_QUICK_START_GUIDE.png';
const ZIP_DATE = new Date('2026-01-01T00:00:00Z');
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

export function validateQuickStartGuide(guide) {
  const bytes = guide instanceof Uint8Array ? guide : guide instanceof ArrayBuffer ? new Uint8Array(guide) : null;
  if (!bytes || bytes.length <= PNG_SIGNATURE.length || PNG_SIGNATURE.some((byte, i) => bytes[i] !== byte)) {
    throw new Error('La guida PNG non è disponibile. Riprova tra poco.');
  }
  return bytes;
}
function fileOptions(date = ZIP_DATE) { return { date, createFolders: true }; }
function fixedFolderDates(zip) {
  // JSZip creates parent folders using the current clock, independently of a
  // file's date. Pin those entries too so orphan-cache recovery is repeatable.
  for (const entry of Object.values(zip.files)) if (entry.dir) entry.date = new Date(ZIP_DATE);
  return zip;
}
function nonempty(value) { return typeof value === 'string' ? value.length > 0 : value?.byteLength > 0; }

/** Add every printable plate and its instructions beneath exactly two root folders. */
export function addLampPackageFiles(zip, { plates, guide, configuration, readme, receipt } = {}) {
  const png = validateQuickStartGuide(guide), seen = new Set();
  if (!Array.isArray(plates) || !plates.length || configuration === undefined || typeof readme !== 'string' || !readme.trim()) {
    throw new Error('Il pacchetto di stampa non contiene tutti i file richiesti.');
  }
  for (const plate of plates) {
    if (!Number.isInteger(plate.index) || plate.index < 1 || seen.has(plate.index) || !nonempty(plate.steps?.opaque)) {
      throw new Error('Il pacchetto di stampa non contiene tutti i file richiesti.');
    }
    seen.add(plate.index);
  }
  if (!seen.has(1) || !nonempty(plates.find(plate => plate.index === 1).steps.transparent)) {
    throw new Error('Il pacchetto di stampa non contiene tutti i file richiesti.');
  }
  for (const plate of plates) {
    const prefix = `print/piatto-${plate.index}`;
    zip.file(`${prefix}/opaco.step`, plate.steps.opaque, fileOptions());
    if (nonempty(plate.steps.transparent)) zip.file(`${prefix}/trasparente.step`, plate.steps.transparent, fileOptions());
  }
  zip.file('info/configurazione.json', typeof configuration === 'string' ? configuration : JSON.stringify(configuration, null, 2), fileOptions());
  zip.file('info/LEGGIMI.txt', readme, fileOptions());
  zip.file(`info/${QUICK_START_GUIDE_FILENAME}`, png, { ...fileOptions(), compression: 'STORE' });
  if (receipt !== undefined) zip.file('info/ricevuta.txt', receipt, fileOptions());
  return fixedFolderDates(zip);
}

function destination(name) {
  if (/^(?:print\/)?piatto-([1-9]\d*)\/(.+\.(?:step|stp))$/i.test(name)) {
    const [, index, filename] = name.match(/^(?:print\/)?piatto-([1-9]\d*)\/(.+\.(?:step|stp))$/i);
    return `print/piatto-${index}/${filename}`;
  }
  const flatStep = name.match(/^(?:.*\/)?[^/]+_p([1-9]\d*)_(opaco|trasparente)\.(?:step|stp)$/i);
  if (flatStep) return `print/piatto-${flatStep[1]}/${flatStep[2].toLowerCase()}.step`;
  if (/\.(?:step|stp)$/i.test(name)) return `print/piatto-1/${name.replace(/^print\//, '')}`;
  const basename = name.split('/').at(-1);
  if (['configurazione.json', 'LEGGIMI.txt', 'ricevuta.txt'].includes(basename)) return `info/${basename}`;
  return name.startsWith('info/') ? name : `info/${name}`;
}
function sameBytes(a, b) { return a.length === b.length && a.every((byte, i) => byte === b[i]); }
function safePath(name) { return !name.startsWith('/') && !name.includes('\\') && name.split('/').every(part => part && part !== '.' && part !== '..') && !name.includes('\0'); }

/** Repackage a legacy delivery without editing its STEP, configuration, readme or receipt bytes. */
export async function normalizeLampDownloadPackage(JSZip, { source, guide, receipt } = {}) {
  const png = validateQuickStartGuide(guide), input = await JSZip.loadAsync(source, { checkCRC32: true }), output = new JSZip(), copied = new Map();
  for (const entry of Object.values(input.files)) {
    if (entry.dir) continue;
    if (!safePath(entry.name) || !safePath(entry.unsafeOriginalName ?? entry.name)) throw new Error('Il pacchetto contiene un percorso non valido.');
    if (entry.name.split('/').at(-1) === QUICK_START_GUIDE_FILENAME) continue;
    const target = destination(entry.name);
    const bytes = await entry.async('uint8array');
    if (copied.has(target)) {
      if (!sameBytes(copied.get(target), bytes)) throw new Error('Il pacchetto contiene file di stampa in conflitto.');
      continue;
    }
    copied.set(target, bytes);
    output.file(target, bytes, fileOptions(entry.date));
  }
  if (!output.file('print/piatto-1/opaco.step') || !output.file('print/piatto-1/trasparente.step')
    || !output.file('info/configurazione.json') || !output.file('info/LEGGIMI.txt')) {
    throw new Error('Il pacchetto di stampa non contiene tutti i file richiesti.');
  }
  output.file(`info/${QUICK_START_GUIDE_FILENAME}`, png, { ...fileOptions(), compression: 'STORE' });
  if (receipt !== undefined) output.file('info/ricevuta.txt', receipt, fileOptions());
  return fixedFolderDates(output);
}
