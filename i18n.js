import { translateDynamic } from './i18n-messages.js';

const STORAGE_KEY = 'lamp-studio-language-v1';
const ENGLISH = new Map(Object.entries({
  'Lingua': 'Language',
  'STAMPA E MONTAGGIO': 'PRINTING AND ASSEMBLY',
  'Prima di iniziare': 'Before you start',
  'Una stampante 3D con AMS per stampare insieme il materiale opaco e quello trasparente.': 'A 3D printer with AMS to print the opaque and transparent materials together.',
  'Una luce LED IKEA KAPPLAKE.': 'An IKEA KAPPLAKE LED light.',
  'Colla per unire i pannelli alla scocca.': 'Glue to join the panels to the housing.',
  'Per incastrare la luce LED nell’alloggiamento, devi rimuovere la parte che fa da diffusore.': 'To fit the LED light into its housing, you need to remove its diffuser.',
  'OK, ho capito': 'OK, got it',
  'LaLosch, sito principale': 'LaLosch, main website',
  'PAROLE CHE FANNO LUCE': 'WORDS THAT MAKE LIGHT',
  'Il tuo laboratorio': 'Your lab',
  'Anteprima gratuita': 'Free preview',
  'DISEGNA CON LA LUCE': 'DESIGN WITH LIGHT',
  'La tua lampada.': 'Your lamp.',
  'Ripristina i valori iniziali': 'Restore defaults',
  'La forma': 'Shape',
  'Forma della lampada': 'Lamp shape',
  'Direzione': 'Direction',
  'Direzione del cartello': 'Sign direction',
  'Punta verso sinistra': 'Point left',
  'Punta verso destra': 'Point right',
  'Sinistra': 'Left', 'Destra': 'Right',
  'Dimensioni automatiche': 'Automatic dimensions',
  'La scocca si adatta alle parole. Incastro LED con scarico fisso di 0,20 mm radiali.': 'The housing adapts to your words. Fixed 0.20 mm radial relief for the LED fit.',
  'Raccordi esterni': 'Corner radius',
  '0 mm · angoli netti': '0 mm · sharp corners',
  '5 mm · morbidi': '5 mm · soft', '10 mm · ampi': '10 mm · rounded',
  'Pannelli e sedi restano piani.': 'Panels and sockets stay flat.',
  'Le parole': 'Words',
  'Consiglio sul numero di lettere': 'Recommended number of letters',
  'Parola centrale': 'Central word',
  'Minimo 2 caratteri. Le proiezioni mantengono la stessa grandezza del testo centrale.': 'At least 2 characters. Projections keep the same font size as the central text.',
  'Sostituisci i # con le tue parole. Minimo 2 caratteri al centro; le proiezioni mantengono la stessa grandezza.': 'Replace the # with your words. At least 2 characters in the centre; projections keep the same font size.',
  'Dove proiettare': 'Where to project',
  'Anteprima live delle scritte': 'Live word preview',
  'Sopra e sotto': 'Above and below',
  'Sopra': 'Above', 'Sotto': 'Below',
  'Lato sinistro': 'Left side', 'Lato destro': 'Right side',
  'Fino a 4 lettere sopra e sotto. Il controllo geometrico verifica che siano realizzabili.': 'Up to 4 letters above and below. The geometry check verifies they can be made.',
  'Il montaggio': 'Assembly',
  'Pannelli scorrevoli': 'Sliding panels',
  'Cambia parole, conserva la base': 'Change the words, keep the base',
  'MODULARE': 'MODULAR',
  'Regolazione delle guide · utenti esperti': 'Guide adjustment · experienced users',
  'Solo per utenti esperti.': 'For experienced users only.',
  'Gioco delle guide per lato': 'Guide clearance per side',
  '0,2 mm per lato, 0,4 mm totali. Verifica l’incastro con un provino.': '0.2 mm per side, 0.4 mm in total. Check the fit with a test piece.',
  'Chiudi il consiglio': 'Close tip',
  'PER UNA PROIEZIONE PIÙ EQUILIBRATA': 'FOR A MORE BALANCED PROJECTION',
  '4 al centro, 4 sopra, 4 sotto.': '4 in the centre, 4 above, 4 below.',
  'La combinazione consigliata è': 'The recommended combination is',
  '4–4–4 lettere': '4–4–4 letters',
  ': parole compatte e una composizione equilibrata.': ': compact words and a balanced composition.',
  'La regola minima è': 'The minimum is',
  '1 sopra · 2 al centro · 1 sotto': '1 above · 2 in the centre · 1 below',
  '. Nella modalità solo laterale bastano due lettere centrali; i lati sono opzionali.': '. In side-only mode, two central letters are enough; the sides are optional.',
  'Ho capito': 'Got it',
  'IL PROGETTO': 'THE PROJECT',
  'Disposizione della lampada': 'Lamp layout',
  'Assemblata': 'Assembled', 'Per la stampa': 'Print layout',
  'Anteprima tridimensionale della lampada': '3D lamp preview',
  'Le tue parole, in tre dimensioni.': 'Your words, in three dimensions.',
  'Il modello apparirà qui appena il generatore è pronto.': 'Your model will appear here when the generator is ready.',
  'In preparazione': 'Preparing',
  'Mostra proiezioni': 'Show projections',
  'Piatto da visualizzare': 'Plate to display',
  'Scocca, tagli e due materiali': 'Housing, cut-outs and two materials',
  'Controlli dell’anteprima': 'Preview controls',
  'Centra il modello': 'Centre model',
  'Mostra gli interni': 'Show internals',
  'Fronte': 'Front', 'Alto': 'Top',
  'Trascina per ruotare · scorri per lo zoom': 'Drag to rotate · scroll to zoom',
  'Anteprima geometrica · proiezione ideale': 'Geometry preview · ideal projection',
  'Opaco': 'Opaque', 'Trasparente': 'Transparent',
  'CONTROLLO GEOMETRICO': 'GEOMETRY CHECK',
  'In attesa del modello': 'Waiting for model',
  'Ingombro scocca': 'Housing dimensions',
  'Pezzi da stampare': 'Parts to print',
  'Piatto di riferimento': 'Reference plate',
  'La generazione verifica il modello prima di abilitare i file.': 'Generation checks the model before enabling downloads.',
  'PRONTI PER LO SLICER': 'READY FOR YOUR SLICER',
  'Due materiali.': 'Two materials.', 'Un solo progetto.': 'One project.',
  'Due STEP con coordinate condivise, da caricare insieme come parti dello stesso oggetto.': 'Two STEP files with shared coordinates. Load them together as parts of the same object.',
  'Scarica i 2 STEP': 'Download 2 STEP files',
  'Acconsento alla consegna immediata dei file digitali e riconosco che, con l’inizio della fornitura, perdo il diritto di recesso.': 'I consent to immediate delivery of the digital files and acknowledge that I lose my right of withdrawal once delivery begins.',
  'Acquisti i file digitali personalizzati della configurazione visualizzata. Controlla parole, forma e anteprima prima di pagare: le modifiche successive non sono incluse. La resa di stampa e proiezione dipende da LED, materiali e profilo di stampa reali e va verificata con un prototipo fisico. Restano salvi i diritti inderogabili del consumatore.': 'You are purchasing personalised digital files for the configuration shown. Check the words, shape and preview before paying: later changes are not included. Print and projection results depend on the actual LED, materials and print profile and must be checked with a physical prototype. Your mandatory consumer rights remain unaffected.',
  'Confermo di aver controllato parole, forma e anteprima e di aver letto le condizioni sopra. Acconsento alla consegna immediata dei file digitali e riconosco che, con l’inizio della fornitura, perdo il diritto di recesso.': 'I confirm that I have checked the words, shape and preview and read the terms above. I consent to immediate delivery of the digital files and acknowledge that I lose my right of withdrawal once delivery begins.',
  'Massimo 4 caratteri al centro, sopra e sotto; massimo 2 per lato. La resa effettiva va verificata con LED e stampa reali.': 'Maximum 4 characters in the centre, above and below; maximum 2 per side. Check the actual results with the real LED and a physical print.',
  'Restano salvi i diritti inderogabili e le tutele PayPal.': 'Mandatory statutory rights and PayPal protections still apply.',
  'Le anteprime e gli eventuali calcoli non riusciti non consumano la correzione. I file originali restano disponibili.': 'Previews and failed calculations do not use your revision. The original files remain available.',
  'Scarica di nuovo l’originale ↗': 'Download the original again ↗',
  'Usa la correzione inclusa': 'Use included revision',
  'Scarica la ricevuta dell’acquisto ↗': 'Download purchase receipt ↗',
  'Progettato per PLA · ugello 0,4 mm · AMS': 'Designed for PLA · 0.4 mm nozzle · AMS',
  'Pannelli piani · rinforzi interni automatici': 'Flat panels · automatic internal reinforcement',
  'CORREZIONE INCLUSA': 'INCLUDED REVISION',
  'Confermi questa versione?': 'Confirm this version?',
  'Questa conferma utilizza la correzione inclusa nell’acquisto. Potrai riscaricare sia l’originale sia la versione corretta.': 'Confirming uses the revision included with your purchase. You can download both the original and the revised version again.',
  'Conferma la correzione': 'Confirm revision',
  'Continua a modificare': 'Keep editing',
  '© 2026 LaLosch. Tutti i diritti riservati.': '© 2026 LaLosch. All rights reserved.',
  'Configura una lampada a parole con pannelli di proiezione. Genera i due modelli STEP per il materiale opaco e trasparente.': 'Design a word lamp with projection panels. Generate the two STEP models for opaque and transparent materials.',
}));

let language = 'it';
let initialized = false;
const sources = new WeakMap();
const attributeSources = new WeakMap();
const ATTRIBUTES = ['aria-label', 'title'];

export const getLanguage = () => language;
export const getLocale = () => language === 'en' ? 'en-GB' : 'it-IT';

function translated(source) {
  if (language === 'it' || !source.trim()) return source;
  const value = source.trim();
  const translation = ENGLISH.get(value) ?? translateDynamic(value);
  return translation == null ? source : source.replace(value, () => translation);
}

function excluded(element) {
  return !element || element.closest('script, style, textarea, input, svg, [data-no-translate]')
    // The first text node is the user's central word, never an interface label.
    || (element.closest('#project-title') && !element.closest('#project-shape'));
}

function textNode(node) {
  if (excluded(node.parentElement)) return;
  const current = node.nodeValue;
  let record = sources.get(node);
  if (!record || current !== record.rendered) record = { source: current };
  const output = translated(record.source);
  record.rendered = output; sources.set(node, record);
  if (current !== output) node.nodeValue = output;
}

function attributes(element) {
  if (excluded(element)) return;
  let records = attributeSources.get(element);
  if (!records) { records = {}; attributeSources.set(element, records); }
  for (const name of ATTRIBUTES) {
    const current = element.getAttribute(name);
    if (current === null) { delete records[name]; continue; }
    let record = records[name];
    if (!record || current !== record.rendered) record = { source: current };
    const output = translated(record.source);
    record.rendered = output; records[name] = record;
    if (current !== output) element.setAttribute(name, output);
  }
}

function localize(root) {
  if (root.nodeType === Node.TEXT_NODE) { textNode(root); return; }
  if (root.nodeType !== Node.ELEMENT_NODE || excluded(root)) return;
  attributes(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    if (walker.currentNode.nodeType === Node.TEXT_NODE) textNode(walker.currentNode);
    else attributes(walker.currentNode);
  }
}

export function setLanguage(value, { persist = true } = {}) {
  language = value === 'en' ? 'en' : 'it';
  document.documentElement.lang = language;
  document.title = 'LaLosch — 3D STL Generator';
  document.querySelector('meta[name="description"]')?.setAttribute('content', translated('Configura una lampada a parole con pannelli di proiezione. Genera i due modelli STEP per il materiale opaco e trasparente.'));
  for (const id of ['language-select', 'requirements-language']) {
    const selector = document.getElementById(id);
    if (selector) selector.value = language;
  }
  if (persist) try { localStorage.setItem(STORAGE_KEY, language); } catch { /* Optional storage. */ }
  localize(document.body);
  window.dispatchEvent(new CustomEvent('lamp:languagechange', { detail: { language } }));
}

export function initializeLanguage() {
  if (initialized) return;
  initialized = true;
  let saved = 'it';
  try { saved = localStorage.getItem(STORAGE_KEY) ?? 'it'; } catch { /* Italian is the default. */ }
  setLanguage(saved, { persist: false });
  for (const id of ['language-select', 'requirements-language']) {
    document.getElementById(id)?.addEventListener('change', event => setLanguage(event.target.value));
  }
  // Legacy rendering and CAD messages stay in their original language internally.
  // Keep a source copy so switching back never rewrites user text or app state.
  const observer = new MutationObserver(records => {
    for (const record of records) {
      if (record.type === 'characterData') textNode(record.target);
      else if (record.type === 'attributes') attributes(record.target);
      else for (const node of record.addedNodes) localize(node);
    }
  });
  observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRIBUTES });
}
