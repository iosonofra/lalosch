#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import JSZip from 'jszip';
import { meshToBinarySTL, createStlPackage, cleanLampData } from './stl-exporter.js';

const UPSTREAM_CAD_ORIGIN = Buffer.from('aHR0cHM6Ly90aGVsYW1wbWFrZXIudGhlcmFiYml4LmNvbQ==', 'base64').toString('utf8');

function parseArgs() {
  const args = process.argv.slice(2);
  const params = {
    shape: 'rectangle', // rectangle | arrow
    arrowDirection: 'right', // left | right
    projectionMode: 'top_bottom', // top_bottom | sides | combined
    centerText: 'MO',
    topText: 'TRI',
    bottomText: 'NE',
    leftText: '',
    rightText: '',
    panelMode: 'sliding',
    railClearance: 0.2,
    filletRadius: 10,
    cableExit: 'bottom', // bottom (Option A) | right (Option B)
    pinMode: 'auto',
    pinAngle: 0,
    font: 'Archivo Black'
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--center' || arg === '-c') params.centerText = args[++i].toUpperCase();
    else if (arg === '--top' || arg === '-t') params.topText = args[++i].toUpperCase();
    else if (arg === '--bottom' || arg === '-b') params.bottomText = args[++i].toUpperCase();
    else if (arg === '--left') params.leftText = args[++i].toUpperCase();
    else if (arg === '--right') params.rightText = args[++i].toUpperCase();
    else if (arg === '--shape' || arg === '-s') params.shape = args[++i];
    else if (arg === '--direction' || arg === '-d') params.arrowDirection = args[++i];
    else if (arg === '--mode' || arg === '-m') params.projectionMode = args[++i];
    else if (arg === '--cable-exit' || arg === '-e') params.cableExit = args[++i];
    else if (arg === '--fillet') params.filletRadius = Number(args[++i]);
    else if (arg === '--clearance') params.railClearance = Number(args[++i]);
    else if (arg === '--out' || arg === '-o') params.outputDir = args[++i];
    else if (arg === '--help' || arg === '-h') {
      console.log(`
LaLosch — CLI STL Generator
Uso: node generate-stl.js [opzioni]

Opzioni:
  -c, --center <testo>       Parola centrale (2-4 lettere, es. ROMA, CAFE, AMOR)
  -t, --top <testo>          Parola proiettata sopra (0-4 lettere)
  -b, --bottom <testo>       Parola proiettata sotto (0-4 lettere)
  --left <testo>             Parola proiettata a sinistra (0-2 lettere)
  --right <testo>            Parola proiettata a destra (0-2 lettere)
  -s, --shape <forma>        Forma: 'rectangle' o 'arrow' (default: rectangle)
  -d, --direction <dir>      Direzione freccia: 'left' o 'right' (default: right)
  -m, --mode <mode>          Modo proiezione: 'top_bottom', 'sides', 'combined'
  -e, --cable-exit <exit>    Uscita cavo: 'bottom' (Scelta A) o 'right' (Scelta B: scocca destra, pannelli integri)
  --fillet <mm>              Raggio raccordi: 0, 5 o 10 mm (default: 10)
  --clearance <mm>           Gioco guide: 0.1 - 0.6 mm (default: 0.2)
  -o, --out <dir>            Cartella di destinazione output (default: ./output)
  -h, --help                 Mostra questo messaggio di aiuto
      `);
      process.exit(0);
    }
  }

  return params;
}

async function main() {
  const options = parseArgs();
  const outputDir = path.resolve(options.outputDir || './output');
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

  console.log('='.repeat(60));
  console.log('LaLosch — Generatore STL automatico');
  console.log('='.repeat(60));
  console.log(`Forma: ${options.shape} (direzione: ${options.arrowDirection})`);
  console.log(`Parole: Centro="${options.centerText}" | Sopra="${options.topText}" | Sotto="${options.bottomText}" | Lati="${options.leftText}/${options.rightText}"`);
  console.log(`Raccordo: ${options.filletRadius} mm | Gioco guide: ${options.railClearance} mm`);
  console.log(`Uscita cavo: ${options.cableExit === 'right' ? 'Scelta B · Laterale destra sulla scocca (Pannelli integri, luce libera)' : 'Scelta A · Centrale inferiore (Standard)'}`);
  console.log(`Connessione all'endpoint CAD...`);

  const requestPayload = {
    params: {
      shape: options.shape,
      arrowDirection: options.arrowDirection,
      projectionMode: options.projectionMode,
      centerText: options.centerText,
      topText: options.topText,
      bottomText: options.bottomText,
      leftText: options.leftText,
      rightText: options.rightText,
      panelMode: options.panelMode,
      railClearance: options.railClearance,
      filletRadius: options.filletRadius,
      pinMode: options.pinMode,
      pinAngle: options.pinAngle,
      font: options.font
    }
  };

  const startTime = Date.now();
  const response = await fetch(`${UPSTREAM_CAD_ORIGIN}/api/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Referer': `${UPSTREAM_CAD_ORIGIN}/`
    },
    body: JSON.stringify(requestPayload)
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error(`Errore API (${response.status}):`, errText);
    process.exit(1);
  }

  const json = await response.json();
  const data = json.data;
  cleanLampData(data, options.cableExit);
  if (data.meta?.params) data.meta.params.cableExit = options.cableExit;
  console.log(`Geometria calcolata in ${((Date.now() - startTime) / 1000).toFixed(1)}s!`);
  console.log(`Dimensioni ingombro: ${data.meta?.params?.width?.toFixed(1)} x ${data.meta?.params?.height} x ${data.meta?.params?.depth} mm`);
  console.log(`Numero piatti di stampa necessari: ${data.plates?.length || 1}`);

  // Convert and export assembled meshes
  const centerClean = options.centerText.toLowerCase().replace(/[^a-z0-9]/g, '_');
  if (data.assembled?.opaque) {
    const buf = meshToBinarySTL(data.assembled.opaque, `${centerClean} assembled opaque`);
    const file = path.join(outputDir, `${centerClean}_opaco_assemblato.stl`);
    fs.writeFileSync(file, Buffer.from(buf));
    console.log(`✓ Salvato STL: ${path.basename(file)} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
  }
  if (data.assembled?.transparent) {
    const buf = meshToBinarySTL(data.assembled.transparent, `${centerClean} assembled transparent`);
    const file = path.join(outputDir, `${centerClean}_trasparente_assemblato.stl`);
    fs.writeFileSync(file, Buffer.from(buf));
    console.log(`✓ Salvato STL: ${path.basename(file)} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
  }

  // Convert and export plate meshes (ready for 3D printer slicer)
  const plates = data.plates || [];
  plates.forEach((plate, i) => {
    const plateNum = plate.index || (i + 1);
    if (plate.opaque) {
      const buf = meshToBinarySTL(plate.opaque, `Plate ${plateNum} opaque`);
      const file = path.join(outputDir, `piatto_${plateNum}_opaco.stl`);
      fs.writeFileSync(file, Buffer.from(buf));
      console.log(`✓ Salvato STL Piatto ${plateNum}: ${path.basename(file)} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
    }
    if (plate.transparent) {
      const buf = meshToBinarySTL(plate.transparent, `Plate ${plateNum} transparent`);
      const file = path.join(outputDir, `piatto_${plateNum}_trasparente.stl`);
      fs.writeFileSync(file, Buffer.from(buf));
      console.log(`✓ Salvato STL Piatto ${plateNum}: ${path.basename(file)} (${(buf.byteLength / 1024).toFixed(1)} KB)`);
    }
  });

  // Export full ZIP package
  let guideBytes = null;
  const guidePath = path.resolve('./assets/LALOSCH_QUICK_START_GUIDE.png');
  if (fs.existsSync(guidePath)) {
    guideBytes = fs.readFileSync(guidePath);
  }

  const zip = await createStlPackage(JSZip, data, guideBytes);
  const zipBuf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const zipFile = path.join(outputDir, `${centerClean}_lamp_package_STL.zip`);
  fs.writeFileSync(zipFile, zipBuf);
  console.log(`✓ Pacchetto ZIP completo: ${path.basename(zipFile)} (${(zipBuf.byteLength / 1024).toFixed(1)} KB)`);

  console.log('\nTutti i file STL sono pronti in:', outputDir);
  console.log('Per stampare: apri Bambu Studio o OrcaSlicer e trascina insieme i file "piatto_1_opaco.stl" e "piatto_1_trasparente.stl"!');
}

main().catch(err => {
  console.error('Errore:', err);
  process.exit(1);
});
