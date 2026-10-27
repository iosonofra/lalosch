import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { DEFAULT_PARAMS, MAX_TEXT_GLYPHS, MAX_SIDE_GLYPHS, validateParams, countProjectionGlyphs } from './rules.js';
import { paypalReturn, safeApprovalUrl, sameOriginDownload, formatPrice, requestJson, purchaseStorageKey } from './payment-client.js';
import { initializeLanguage, getLocale } from './i18n.js';
import { projectionFieldIcon, projectionModeIcon, projectionModeLabel, liveLampIcon } from './control-icons.js';
import { populateStartupDemo } from './startup-demo.js';
import { installTextInputLimit } from './text-input.js';
import { meshToBinarySTL, createStlPackage, cleanLampData } from './stl-exporter.js';

initializeLanguage();

const $ = (id) => document.getElementById(id);
const all = (selector) => [...document.querySelectorAll(selector)];
const requirementsDialog = $('startup-requirements');
if (requirementsDialog && $('confirm-requirements')) {
  $('confirm-requirements').addEventListener('click', () => requirementsDialog.close());
  requirementsDialog.showModal();
}
const STORAGE_KEY = 'lalosch-config-v2';
const SERVER_MODE = window.LAMP_RUNTIME?.mode === 'server';
const API_BASE = SERVER_MODE ? String(window.LAMP_RUNTIME?.apiBase ?? '').replace(/\/$/, '') : '';
const TEXT_FIELDS = ['centerText', 'topText', 'bottomText', 'leftText', 'rightText'];
const iconTextContext = document.createElement('canvas').getContext('2d');
const INITIAL = { ...DEFAULT_PARAMS, shape: 'rectangle', arrowDirection: 'right', panelMode: 'sliding' };
const NUMBER_FIELDS = ['railClearance', 'filletRadius'];
const state = { shape: INITIAL.shape, direction: INITIAL.arrowDirection, panelMode: INITIAL.panelMode,
  ready: false, busy: false, dirty: true, result: null, generatedParams: null,
  request: 0, view: 'assembled', plate: 0, camera: 'iso', internals: false, projections: true,
  lampOn: false, explodeAmount: 0, targetExplode: 0, wallStyle: 'dark_concrete',
  colors: { opaque: '#f20071', opaqueName: 'Rosa LaLosch', finish: 'matte', transparent: '#ffffff', transparentName: 'Bianco Neve' },
  autoStarted: false, worker: null, workerFailed: false, renderer: null, purchase: null, demoActive: false,
  payment: { config: null, previewId: null, accessToken: null, configHash: null, orderId: null,
    paid: false, downloadUrl: null, receiptUrl: null, revisionOfOrderId: null, busy: false, captureFailed: false, message: '' } };
let scene, camera, renderer, controls, modelGroup, backdrop, wallModule, grid, resizeObserver, keyLight, wallMaterial, shadowMaterial;
let hemiLight, fillLight, rimLight, lampLight, bulbMesh, kapplakePuck, explodeGuideLines, buildPlateGroup;
let toastTimeout;
function showWordAdvice() {
  const dialog = $('word-advice');
  if (!dialog.open) dialog.showModal();
}

function setPressed(buttons, selected, attribute) {
  buttons.forEach((button) => {
    const on = button.dataset[attribute] === selected;
    button.classList.toggle(attribute === 'shape' || attribute === 'panel' ? 'selected' : 'active', on);
    button.setAttribute('aria-pressed', String(on));
  });
}

function refreshCableCards() {
  const current = document.querySelector('input[name="cableExit"]:checked')?.value || 'bottom';
  const bottomCard = $('cable-card-bottom');
  const rightCard = $('cable-card-right');
  if (bottomCard) bottomCard.classList.toggle('selected', current === 'bottom');
  if (rightCard) rightCard.classList.toggle('selected', current === 'right');
}

function readParams() {
  const params = { ...INITIAL, shape: state.shape, arrowDirection: state.direction, panelMode: 'sliding' };
  for (const field of ['width', 'height', 'depth', 'margin']) delete params[field];
  for (const name of TEXT_FIELDS) params[name] = $(name).value;
  for (const name of NUMBER_FIELDS) params[name] = $(name).value;
  params.projectionMode = $('projectionMode').value;
  const checkedCable = document.querySelector('input[name="cableExit"]:checked');
  params.cableExit = checkedCable ? checkedCable.value : 'bottom';
  params.pinMode = 'auto'; params.pinAngle = 0; params.ledHeight = DEFAULT_PARAMS.ledHeight;
  // The pointed wall is unavailable. Keep its field value in the form for a
  // future rectangle, while explicitly excluding it from this lamp's request.
  if (params.shape === 'arrow') params[state.direction === 'left' ? 'leftText' : 'rightText'] = '';
  return params;
}

function writeParams(params) {
  state.shape = params.shape; state.direction = params.arrowDirection; state.panelMode = 'sliding';
  for (const name of [...TEXT_FIELDS, ...NUMBER_FIELDS, 'projectionMode']) {
    if ($(name) && params[name] !== undefined) {
      $(name).value = params[name];
      textInputLimits.get(name)?.sync();
    }
  }
  const cableVal = params.cableExit || 'bottom';
  const cableRadio = document.querySelector(`input[name="cableExit"][value="${cableVal}"]`);
  if (cableRadio) cableRadio.checked = true;
  refreshCableCards();
  refreshControls();
}

function hasWords() {
  return TEXT_FIELDS.some(name => $(name).value.trim());
}

function configurationSummary(params = state.generatedParams) {
  return params ? [params.centerText, params.topText && `sopra ${params.topText}`, params.bottomText && `sotto ${params.bottomText}`,
    params.leftText && `sinistra ${params.leftText}`, params.rightText && `destra ${params.rightText}`].filter(Boolean).join(' · ') : '';
}

function refreshLocationIcons(mode) {
  const shape = state.shape, direction = state.direction, language = getLocale().startsWith('en') ? 'en' : 'it';
  $('shape-direction-preview').setAttribute('href', direction === 'left' ? '#i-sign-left' : '#i-arrow');
  setPressed(all('[data-mode]'), mode, 'mode');
  for (const button of all('[data-mode]')) {
    const label = projectionModeLabel(button.dataset.mode, shape, direction, language);
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.querySelector('svg').innerHTML = projectionModeIcon({ mode: button.dataset.mode, shape, direction });
  }
  for (const icon of all('[data-field-icon]')) {
    icon.innerHTML = projectionFieldIcon({ side: icon.dataset.fieldIcon, shape, direction, language });
  }
  const words = Object.fromEntries(TEXT_FIELDS.map(name => [name, $(name).value]));
  if (iconTextContext) iconTextContext.font = '100px "Archivo Black"';
  const wordWidths = Object.fromEntries(['center', 'top', 'bottom', 'left', 'right'].map(side =>
    [side, iconTextContext ? iconTextContext.measureText(words[`${side}Text`].trim().toUpperCase()).width / 100 : 0]));
  $('live-word-preview').setAttribute('aria-label', language === 'en' ? 'Live word preview' : 'Anteprima live delle scritte');
  $('live-word-preview').innerHTML = liveLampIcon({ mode, shape, direction, words, wordWidths });
}

function refreshControls() {
  setPressed(all('[data-shape]'), state.shape, 'shape');
  setPressed(all('[data-direction]'), state.direction, 'direction');
  $('fillet-preview').setAttribute('rx', String(Number($('filletRadius').value)));
  $('direction-control').hidden = state.shape !== 'arrow';
  const mode = $('projectionMode').value;
  refreshLocationIcons(mode);
  $('top-bottom-fields').hidden = mode === 'sides';
  $('side-fields').hidden = mode === 'top_bottom';
  const arrow = state.shape === 'arrow';
  $('left-field').hidden = arrow && state.direction === 'left';
  $('right-field').hidden = arrow && state.direction === 'right';
  $('side-fields').classList.toggle('single-field', arrow);
  const options = $('projectionMode').options;
  options[1].textContent = arrow ? 'Sul lato piatto' : 'A sinistra e a destra';
  if ($('projection-help')) {
    $('projection-help').textContent = mode === 'top_bottom'
      ? 'Proiezioni opzionali: fino a 4 caratteri sopra e sotto. Minimo 2 caratteri al centro.'
      : mode === 'combined'
        ? arrow ? 'Sopra e sotto opzionali, fino a 4 caratteri; lato piatto opzionale, fino a 2 caratteri.' : 'Proiezioni opzionali: fino a 4 caratteri sopra e sotto, fino a 2 per lato.'
        : arrow ? 'Lato piatto opzionale, fino a 2 caratteri. Minimo 2 caratteri al centro.'
          : 'Laterali opzionali, fino a 2 caratteri. Minimo 2 caratteri al centro.';
  }
  for (const [field, countId, max] of [['centerText', 'center-count', 4],
    ['topText', 'top-count', 4], ['bottomText', 'bottom-count', 4],
    ['leftText', 'left-count', MAX_SIDE_GLYPHS], ['rightText', 'right-count', MAX_SIDE_GLYPHS]]) {
    $(field).placeholder = '#'.repeat(max);
    const count = countProjectionGlyphs($(field).value);
    $(countId).textContent = max ? `${count} / ${max}` : `${count} ${count === 1 ? 'lettera' : 'lettere'}`;
    const minimum = field === 'centerText' ? 2 : 0;
    $(countId).classList.toggle('invalid', hasWords() && ((max !== null && count > max) || count < minimum));
  }
  const title = ($('centerText').value.trim().toUpperCase() || '####').slice(0, 28);
  $('project-title').firstChild.textContent = title;
  $('project-shape').textContent = arrow ? 'Cartello stradale' : 'Rettangolo';
}

function renderInputErrors(validation, show = true) {
  all('.field.invalid').forEach((el) => el.classList.remove('invalid'));
  const box = $('validation-errors'); box.replaceChildren();
  if (!show || validation.valid) { box.hidden = true; return; }
  const list = document.createElement('ul');
  for (const error of validation.errors) {
    const li = document.createElement('li'); li.textContent = error.message ?? String(error); list.append(li);
    $(error.field)?.closest('.field')?.classList.add('invalid');
  }
  box.append(list); box.hidden = false;
}

function markDirty() {
  refreshControls();
  const consent = $('digital-content-consent');
  if (consent) consent.checked = false;
  state.dirty = true;
  const validation = validateParams(readParams());
  renderInputErrors(validation, hasWords());
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(readParams())); } catch { /* Storage is optional. */ }
  if (!state.busy && !hasWords()) showStartupDemo();
  else if (!state.busy && state.demoActive) showStartupDemo(false);
  else if (!state.busy && state.result) {
    setBadge('Modifiche da generare', 'stale');
    setStatus('Anteprima da aggiornare', 'MODIFICATA', 'Le nuove impostazioni verranno applicate con Genera lampada.', 'stale');
  }
  updateButtons(validation);
}

function setBadge(text, kind = '') {
  const badge = $('model-badge'); badge.className = `model-badge ${kind}`;
  badge.replaceChildren(); badge.append(document.createElement('span'), document.createTextNode(text));
}

function setStatus(title, chip, message, kind = '') {
  $('status-title').textContent = title; $('status-chip').textContent = chip;
  $('status-chip').className = `status-chip ${kind}`;
  $('status-symbol').className = `status-symbol ${kind}`;
  const icon = kind === 'valid' ? 'check' : kind === 'error' ? 'alert' : 'cube';
  $('status-symbol').querySelector('use').setAttribute('href', `#i-${icon}`);
  $('status-message').className = `status-message ${kind}`;
  $('status-message').querySelector('p').textContent = message;
  // Successful geometric checks stay behind the scenes. Only blocking errors
  // need additional explanation below the dimensions.
  $('status-message').hidden = kind !== 'error';
}

function validStep(text) { return typeof text === 'string' && text.includes('ISO-10303-21'); }

function resultPlates(result = state.result) {
  if (!result) return [];
  if (Array.isArray(result.plates) && result.plates.length) return result.plates;
  return [{ index: 1, opaque: result.print?.opaque, transparent: result.print?.transparent,
    steps: result.steps ?? {}, fit: true }];
}

function resultIsValid() {
  const result = state.result;
  if (!result || state.dirty || state.busy || result.validation?.valid === false) return false;
  if (Array.isArray(result.validation?.errors) && result.validation.errors.length) return false;
  return Boolean(result.assembled?.opaque?.positions?.length);
}

function updateButtons(validation = validateParams(readParams())) {
  const generate = $('generate-button');
  generate.disabled = state.busy || (!state.ready && !state.workerFailed) || (!state.workerFailed && !validation.valid);
  generate.querySelector('span').textContent = state.busy ? 'Calcolo geometria CAD…'
    : state.workerFailed ? 'Ricarica il generatore' : state.ready ? 'Genera lampada 3D' : 'Preparazione…';
  const shouldPulse = !state.busy && state.ready && validation.valid && (state.dirty || !state.result);
  generate.classList.toggle('pulse-ready', shouldPulse);
  $('generate-hint').textContent = state.busy ? 'Il calcolo può richiedere qualche istante'
    : !hasWords() ? 'Scrivi le tue parole al posto dei #'
      : !state.ready ? 'Caricamento del generatore geometrico'
      : !validation.valid ? 'Correggi i campi evidenziati per continuare'
        : state.dirty && state.result ? 'Applica le modifiche e aggiorna i file'
          : 'Geometria reale calcolata · due materiali separati';
  const valid = resultIsValid();
  $('download-all').disabled = !valid || state.busy;
  $('download-label').textContent = state.busy ? 'Elaborazione in corso…' : 'Scarica Pacchetto STL Completo';
  if ($('dl-plate-stl')) $('dl-plate-stl').disabled = !valid || state.busy;
  if ($('dl-opaque-stl')) $('dl-opaque-stl').disabled = !valid || state.busy;
  if ($('dl-trans-stl')) $('dl-trans-stl').disabled = !valid || state.busy;
  if ($('export-note')) {
    $('export-note').textContent = valid
      ? 'File STL 3D pronti per lo slicer (Bambu Studio, OrcaSlicer, PrusaSlicer).'
      : 'Genera il modello per preparare i file STL da stampare.';
  }
  $('plate-select-wrap').hidden = state.view !== 'print' || !state.result;
  $('projection-toggle-wrap').hidden = state.view !== 'assembled';
  $('view-print').disabled = state.busy || state.demoActive || !state.result;
  $('show-internals').disabled = state.busy || state.demoActive || !state.result;
  $('show-internals').setAttribute('aria-pressed', String(state.internals));
  if ($('toggle-light')) $('toggle-light').disabled = state.busy;
  if ($('toggle-explode')) $('toggle-explode').disabled = state.busy || state.view !== 'assembled';
}

function notify(message) {
  clearTimeout(toastTimeout); $('toast').textContent = message; $('toast').hidden = false;
  toastTimeout = setTimeout(() => { $('toast').hidden = true; }, 4500);
}

function createBuildPlate() {
  const group = new THREE.Group();
  group.name = 'buildPlateGroup';

  // Base 256 x 256 mm sheet
  const sheetGeo = new THREE.PlaneGeometry(256, 256);
  const sheetMat = new THREE.MeshStandardMaterial({
    color: 0x212328,
    roughness: 0.88,
    metalness: 0.12,
    side: THREE.DoubleSide
  });
  const sheetMesh = new THREE.Mesh(sheetGeo, sheetMat);
  sheetMesh.receiveShadow = true;
  sheetMesh.position.set(128, 128, 0);
  group.add(sheetMesh);

  // Border lines
  const borderEdges = new THREE.EdgesGeometry(sheetGeo);
  const borderMat = new THREE.LineBasicMaterial({ color: 0x4a4e5c, transparent: true, opacity: 0.75 });
  const borderLines = new THREE.LineSegments(borderEdges, borderMat);
  borderLines.position.set(128, 128, 0.04);
  group.add(borderLines);

  // Grid lines: 32 divisions = 8 mm squares
  const gridHelper = new THREE.GridHelper(256, 32, 0x474c5c, 0x2c303a);
  gridHelper.rotation.x = Math.PI / 2;
  gridHelper.position.set(128, 128, 0.08);
  gridHelper.material.transparent = true;
  gridHelper.material.opacity = 0.65;
  group.add(gridHelper);

  // Decorative build plate branding & markings banner
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 96;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#212328';
  ctx.fillRect(0, 0, 1024, 96);
  ctx.fillStyle = '#ff318b';
  ctx.fillRect(0, 0, 1024, 3);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 30px "Segoe UI", Inter, sans-serif';
  ctx.fillText('LaLosch', 36, 58);

  ctx.fillStyle = '#8e96a8';
  ctx.font = '22px "Segoe UI", Inter, sans-serif';
  ctx.fillText('PIATTO DI STAMPA · 256 × 256 mm', 180, 58);

  ctx.fillStyle = '#ff4f9c';
  ctx.font = 'bold 20px "Segoe UI", Inter, sans-serif';
  ctx.fillText('TEXTURED PEI', 820, 58);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const bannerMat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.85 });
  const bannerMesh = new THREE.Mesh(new THREE.PlaneGeometry(244, 23), bannerMat);
  bannerMesh.position.set(128, 242, 0.15);
  group.add(bannerMesh);

  group.visible = false;
  return group;
}

function createWallBackTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 768;
  const ctx = canvas.getContext('2d');

  // Background slate
  ctx.fillStyle = '#1e1c25';
  ctx.fillRect(0, 0, 1024, 768);

  // Technical drafting grid
  ctx.strokeStyle = '#282532';
  ctx.lineWidth = 1;
  for (let x = 32; x < 1024; x += 32) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 768); ctx.stroke();
  }
  for (let y = 32; y < 768; y += 32) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(1024, y); ctx.stroke();
  }

  // Double perimeter border
  ctx.strokeStyle = '#4e4a5d';
  ctx.lineWidth = 2;
  ctx.strokeRect(26, 26, 1024 - 52, 768 - 52);
  ctx.strokeStyle = '#363342';
  ctx.lineWidth = 1;
  ctx.strokeRect(34, 34, 1024 - 68, 768 - 68);

  // Corner registration targets
  const drawCorner = (x, y) => {
    ctx.strokeStyle = '#ff4f9c';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y);
    ctx.moveTo(x, y - 12); ctx.lineTo(x, y + 12);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, 6, 0, Math.PI * 2);
    ctx.stroke();
  };
  drawCorner(52, 52);
  drawCorner(1024 - 52, 52);
  drawCorner(52, 768 - 52);
  drawCorner(1024 - 52, 768 - 52);

  // Top badge
  ctx.fillStyle = '#ff4f9c';
  ctx.font = 'bold 15px "Segoe UI", Inter, sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('LA LOSCH · SISTEMA DI MONTAGGIO A PARETE', 84, 58);

  // Header Title
  ctx.fillStyle = '#f0edf5';
  ctx.font = 'bold 30px "Segoe UI", Inter, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PARETE DI SUPPORTO · SEZIONE RETRO', 512, 126);

  ctx.fillStyle = '#9e99ab';
  ctx.font = '15px "Segoe UI", Inter, sans-serif';
  ctx.fillText('Pannello architettonico spessore 24 mm · Superficie posteriore non visibile', 512, 154);

  // Center mounting zone diagram
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = '#5a556b';
  ctx.lineWidth = 2;
  ctx.strokeRect(220, 196, 584, 310);
  ctx.setLineDash([]);

  // Draw mounting anchors
  const drawAnchor = (x, y, label) => {
    ctx.fillStyle = '#2d293b';
    ctx.strokeStyle = '#d4e52b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(x, y, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.strokeStyle = '#d4e52b';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x - 11, y); ctx.lineTo(x + 11, y);
    ctx.moveTo(x, y - 11); ctx.lineTo(x, y + 11);
    ctx.stroke();

    ctx.fillStyle = '#d4e52b';
    ctx.font = 'bold 12px "Segoe UI", Inter, sans-serif';
    ctx.fillText(label, x, y + 38);
  };
  drawAnchor(320, 290, 'FORO ANCORAGGIO SX');
  drawAnchor(704, 290, 'FORO ANCORAGGIO DX');

  // Interasse dimension line
  ctx.strokeStyle = '#8e899b';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(350, 290); ctx.lineTo(674, 290);
  ctx.stroke();
  ctx.fillStyle = '#cfcad8';
  ctx.font = '13px "Segoe UI", Inter, sans-serif';
  ctx.fillText('◄── INTERASSE DI FISSAGGIO A MURO ──►', 512, 276);

  // Central friendly callout
  ctx.fillStyle = '#16141d';
  ctx.strokeStyle = '#ff4f9c88';
  ctx.lineWidth = 1.5;
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(256, 360, 512, 116, 12);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.rect(256, 360, 512, 116);
    ctx.fill();
    ctx.stroke();
  }

  ctx.fillStyle = '#ff4f9c';
  ctx.font = 'bold 16px "Segoe UI", Inter, sans-serif';
  ctx.fillText('LA LAMPADA È INSTALLATA SUL FRONTE DELLA PARETE', 512, 396);

  ctx.fillStyle = '#f0edf5';
  ctx.font = '14px "Segoe UI", Inter, sans-serif';
  ctx.fillText('Questa superficie rappresenta il retro del muro di sostegno.', 512, 424);

  ctx.fillStyle = '#9e99ab';
  ctx.font = '13px "Segoe UI", Inter, sans-serif';
  ctx.fillText('Ruota la visuale sul lato frontale per visualizzare la lampada.', 512, 448);

  // Bottom action hint
  ctx.fillStyle = '#d4e52b';
  ctx.font = 'bold 15px "Segoe UI", Inter, sans-serif';
  ctx.fillText('↻ RUOTA SUL FRONTE PER ESPLORARE LA LAMPADA', 512, 590);

  // Technical specs
  ctx.fillStyle = '#6e697c';
  ctx.font = '13px "Segoe UI", Inter, sans-serif';
  ctx.fillText('LaLosch 3D Studio · Fissaggio a scomparsa con tasselli Ø 5/6 mm · Passacavo a parete integrato', 512, 690);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createWoodSlatsTexture(isNight = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Background acoustic felt (matte dark gap)
  ctx.fillStyle = isNight ? '#0b0b0e' : '#141318';
  ctx.fillRect(0, 0, 1024, 1024);

  // Vertical slats
  // Width 1024px: 32 slats of 24px width + 8px gap = 32px cycle
  const slatWidth = 24;
  const gapWidth = 8;
  const cycle = slatWidth + gapWidth; // 32px -> 32 slats
  const numSlats = 1024 / cycle;

  for (let i = 0; i < numSlats; i++) {
    const x = i * cycle;

    // Wood base gradient across the slat for realistic 3D bevel / rounded edge
    const slatGrad = ctx.createLinearGradient(x, 0, x + slatWidth, 0);
    if (isNight) {
      slatGrad.addColorStop(0, '#2e2017');
      slatGrad.addColorStop(0.18, '#443224');
      slatGrad.addColorStop(0.5, '#4f3b2c');
      slatGrad.addColorStop(0.82, '#443224');
      slatGrad.addColorStop(1, '#271b13');
    } else {
      slatGrad.addColorStop(0, '#a67a4b');
      slatGrad.addColorStop(0.14, '#c99c66');
      slatGrad.addColorStop(0.5, '#ddb27e');
      slatGrad.addColorStop(0.86, '#c99c66');
      slatGrad.addColorStop(1, '#986c3f');
    }
    ctx.fillStyle = slatGrad;
    ctx.fillRect(x, 0, slatWidth, 1024);

    // Fine wood grain fibers inside this slat
    ctx.lineWidth = 1;
    const grainCount = 10;
    for (let g = 0; g < grainCount; g++) {
      const gx = x + 2 + Math.random() * (slatWidth - 4);
      const alpha = 0.07 + Math.random() * 0.12;
      ctx.strokeStyle = isNight ? `rgba(20, 14, 10, ${alpha})` : `rgba(110, 72, 35, ${alpha})`;
      ctx.beginPath();
      ctx.moveTo(gx, 0);
      ctx.bezierCurveTo(
        gx + (Math.random() - 0.5) * 4, 340,
        gx + (Math.random() - 0.5) * 4, 680,
        gx + (Math.random() - 0.5) * 2, 1024
      );
      ctx.stroke();
    }

    // Left edge highlight
    ctx.fillStyle = isNight ? 'rgba(255, 230, 190, 0.06)' : 'rgba(255, 255, 255, 0.18)';
    ctx.fillRect(x, 0, 1.5, 1024);

    // Right inner edge shadow
    ctx.fillStyle = isNight ? 'rgba(0, 0, 0, 0.70)' : 'rgba(0, 0, 0, 0.40)';
    ctx.fillRect(x + slatWidth - 1.5, 0, 1.5, 1024);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(3, 1);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createConcreteTexture(isNight = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Base microcement background
  ctx.fillStyle = isNight ? '#16171d' : '#2d3039';
  ctx.fillRect(0, 0, 1024, 1024);

  // Spatula cloud strokes (stucco veneziano / spatolato effect)
  const numStrokes = 65;
  for (let i = 0; i < numStrokes; i++) {
    const cx = Math.random() * 1024;
    const cy = Math.random() * 1024;
    const rx = 80 + Math.random() * 160;
    const ry = 40 + Math.random() * 90;
    const angle = (Math.random() - 0.5) * Math.PI * 0.6;
    const isLight = Math.random() > 0.45;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, rx);
    if (isLight) {
      grad.addColorStop(0, isNight ? 'rgba(60, 65, 82, 0.12)' : 'rgba(255, 255, 255, 0.07)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
      grad.addColorStop(0, isNight ? 'rgba(8, 9, 12, 0.18)' : 'rgba(20, 22, 28, 0.14)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // Micro-porosity sand grain dots
  const imgData = ctx.getImageData(0, 0, 1024, 1024);
  const data = imgData.data;
  for (let p = 0; p < data.length; p += 4) {
    if (Math.random() < 0.12) {
      const delta = (Math.random() - 0.5) * (isNight ? 10 : 16);
      data[p] = Math.max(0, Math.min(255, data[p] + delta));
      data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + delta));
      data[p + 2] = Math.max(0, Math.min(255, data[p + 2] + delta));
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createPlasterTexture(isNight = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');

  // Warm Nordic plaster / limestone tone
  ctx.fillStyle = isNight ? '#1f1e27' : '#ece7df';
  ctx.fillRect(0, 0, 1024, 1024);

  // Soft cloudy color variations
  for (let i = 0; i < 40; i++) {
    const cx = Math.random() * 1024;
    const cy = Math.random() * 1024;
    const r = 100 + Math.random() * 220;
    const grad = ctx.createRadialGradient(cx, cy, 20, cx, cy, r);
    const lighter = Math.random() > 0.5;
    if (lighter) {
      grad.addColorStop(0, isNight ? 'rgba(50, 48, 65, 0.09)' : 'rgba(255, 255, 255, 0.09)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    } else {
      grad.addColorStop(0, isNight ? 'rgba(15, 14, 20, 0.11)' : 'rgba(200, 192, 180, 0.08)');
      grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    }
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // Delicate plaster fine grain
  const imgData = ctx.getImageData(0, 0, 1024, 1024);
  const data = imgData.data;
  for (let p = 0; p < data.length; p += 4) {
    if (Math.random() < 0.15) {
      const delta = (Math.random() - 0.5) * (isNight ? 7 : 12);
      data[p] = Math.max(0, Math.min(255, data[p] + delta));
      data[p + 1] = Math.max(0, Math.min(255, data[p + 1] + delta));
      data[p + 2] = Math.max(0, Math.min(255, data[p + 2] + delta));
    }
  }
  ctx.putImageData(imgData, 0, 0);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(2, 1.5);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createVolumetricLightWashTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  const cx = 512, cy = 512;

  // 1. Concentrated warm 2700K core hotspot directly behind letters
  const coreGrad = ctx.createRadialGradient(cx, cy, 15, cx, cy, 260);
  coreGrad.addColorStop(0, 'rgba(255, 246, 215, 1.0)');
  coreGrad.addColorStop(0.14, 'rgba(255, 222, 145, 0.90)');
  coreGrad.addColorStop(0.32, 'rgba(255, 185, 90, 0.62)');
  coreGrad.addColorStop(0.60, 'rgba(255, 140, 48, 0.28)');
  coreGrad.addColorStop(0.85, 'rgba(255, 110, 30, 0.08)');
  coreGrad.addColorStop(1.0, 'rgba(255, 90, 20, 0.0)');
  ctx.fillStyle = coreGrad;
  ctx.fillRect(0, 0, 1024, 1024);

  // 2. Horizontal elliptical expansion (stretches along lamp width)
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1.5, 0.75);
  const wideGrad = ctx.createRadialGradient(0, 0, 20, 0, 0, 320);
  wideGrad.addColorStop(0, 'rgba(255, 230, 160, 0.45)');
  wideGrad.addColorStop(0.4, 'rgba(255, 170, 70, 0.22)');
  wideGrad.addColorStop(0.8, 'rgba(255, 120, 35, 0.05)');
  wideGrad.addColorStop(1.0, 'rgba(255, 90, 20, 0.0)');
  ctx.fillStyle = wideGrad;
  ctx.beginPath();
  ctx.arc(0, 0, 320, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // 3. Vertical fan wash (up and down wall graze from top/bottom slits)
  const drawFan = (upwards) => {
    ctx.save();
    ctx.translate(cx, cy);
    const fanGrad = ctx.createRadialGradient(0, upwards ? -40 : 40, 10, 0, upwards ? -260 : 260, 280);
    fanGrad.addColorStop(0, 'rgba(255, 225, 150, 0.35)');
    fanGrad.addColorStop(0.5, 'rgba(255, 160, 60, 0.14)');
    fanGrad.addColorStop(1, 'rgba(255, 110, 30, 0)');
    ctx.fillStyle = fanGrad;
    ctx.beginPath();
    ctx.moveTo(-180, 0);
    ctx.lineTo(180, 0);
    ctx.lineTo(upwards ? 240 : 240, upwards ? -380 : 380);
    ctx.lineTo(upwards ? -240 : -240, upwards ? -380 : 380);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  drawFan(true);
  drawFan(false);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function createWallModule() {
  const wallGroup = new THREE.Group();
  wallGroup.name = 'wallModule';

  // Panoramic architectural backdrop (2400 x 1800 x 24 mm)
  // Generous dimensions ensure the wall seamlessly covers the entire 3D viewer background
  // on all mobile and desktop aspect ratios without edge cutoffs or lateral offset illusions.
  const width = 2400, height = 1800, depth = 24;
  const geometry = new THREE.BoxGeometry(width, height, depth);

  const sideMat = new THREE.MeshStandardMaterial({
    color: 0x14131a,
    roughness: 0.88,
    metalness: 0.02
  });

  const backTexture = createWallBackTexture();
  const backMat = new THREE.MeshBasicMaterial({
    map: backTexture,
    toneMapped: false
  });

  const textures = {
    wood_slats: {
      day: createWoodSlatsTexture(false),
      night: createWoodSlatsTexture(true)
    },
    dark_concrete: {
      day: createConcreteTexture(false),
      night: createConcreteTexture(true)
    },
    soft_plaster: {
      day: createPlasterTexture(false),
      night: createPlasterTexture(true)
    }
  };

  const initialStyle = state.wallStyle || 'dark_concrete';
  const initialTex = state.lampOn ? textures[initialStyle].night : textures[initialStyle].day;

  const frontMat = new THREE.MeshStandardMaterial({
    map: initialTex,
    roughness: initialStyle === 'wood_slats' ? 0.72 : (initialStyle === 'dark_concrete' ? 0.88 : 0.95),
    metalness: initialStyle === 'wood_slats' ? 0.04 : 0.0
  });

  // BoxGeometry face groups:
  // 0: +X, 1: -X, 2: +Y, 3: -Y (sides)
  // 4: +Z (back of wall)
  // 5: -Z (front of wall facing lamp & camera)
  const materials = [sideMat, sideMat, sideMat, sideMat, backMat, frontMat];
  const wallMesh = new THREE.Mesh(geometry, materials);
  wallMesh.receiveShadow = false;
  wallMesh.position.z = depth / 2;
  wallGroup.add(wallMesh);

  // Volumetric wall-wash lighting gradient behind the lamp (covers 1200 x 950 mm smoothly)
  const washTexture = createVolumetricLightWashTexture();
  const washMat = new THREE.MeshBasicMaterial({
    map: washTexture,
    transparent: true,
    opacity: 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false
  });
  const washMesh = new THREE.Mesh(new THREE.PlaneGeometry(1200, 950), washMat);
  washMesh.position.set(0, 0, -0.02);
  washMesh.renderOrder = 0;
  wallGroup.add(washMesh);

  wallGroup.userData = {
    frontMat,
    sideMat,
    backMat,
    washMat,
    washMesh,
    textures,
    depth,
    width,
    height
  };

  return wallGroup;
}

function applyWallStyle(style) {
  if (!wallModule?.userData) return;
  state.wallStyle = style;
  const isNight = Boolean(state.lampOn);
  const { frontMat, textures, washMat } = wallModule.userData;

  all('.wall-chip').forEach(chip => {
    const active = chip.dataset.wallStyle === style;
    chip.classList.toggle('active', active);
    chip.setAttribute('aria-pressed', String(active));
  });

  if (frontMat && textures && textures[style]) {
    const texObj = textures[style];
    frontMat.map = isNight ? (texObj.night || texObj.day) : texObj.day;
    frontMat.color.setHex(0xffffff);
    frontMat.roughness = style === 'wood_slats' ? 0.72 : (style === 'dark_concrete' ? 0.88 : 0.95);
    frontMat.metalness = style === 'wood_slats' ? 0.04 : 0.0;
    frontMat.needsUpdate = true;
  }

  if (washMat) {
    if (isNight) {
      washMat.opacity = style === 'dark_concrete' ? 0.95 : (style === 'wood_slats' ? 0.90 : 0.85);
    } else {
      washMat.opacity = state.view === 'assembled' ? 0.16 : 0;
    }
    washMat.needsUpdate = true;
  }
}

function updateWallTheme() {
  if (!wallModule?.userData) return;
  const isNight = Boolean(state.lampOn);
  const { sideMat, frameMat } = wallModule.userData;
  if (sideMat) {
    sideMat.color.setHex(isNight ? 0x14131a : 0xd2cdc2);
    sideMat.needsUpdate = true;
  }
  if (frameMat) {
    frameMat.color.setHex(isNight ? 0x363442 : 0xbbb5a8);
    frameMat.needsUpdate = true;
  }
  applyWallStyle(state.wallStyle || 'dark_concrete');
}

function updateWallBackIndicator() {
  const hint = $('wall-back-hint');
  if (!hint) return;
  if (state.view !== 'assembled') {
    if (!hint.hidden) hint.hidden = true;
    return;
  }
  const wallZ = Number(state.result?.meta?.wallZ ?? state.result?.meta?.params?.depth ?? 50);
  const isBehind = camera.position.z > (wallZ + 15);
  if (hint.hidden === isBehind) {
    hint.hidden = !isBehind;
  }
}

function initializeViewer() {
  try {
    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(35, 1, .1, 5000); camera.up.set(0, 1, 0);
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.domElement.setAttribute('aria-label', 'Modello tridimensionale: trascina per ruotare e scorri per lo zoom');
    renderer.domElement.setAttribute('role', 'img');
    $('viewer').append(renderer.domElement); state.renderer = renderer;
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = .07; controls.minDistance = 25; controls.maxDistance = 2400;
    controls.enablePan = true;
    hemiLight = new THREE.HemisphereLight(0xffffff, 0x5d354e, 1.5);
    scene.add(hemiLight);
    const key = new THREE.DirectionalLight(0xffffff, 2); keyLight = key; key.position.set(-130, 220, -300); key.castShadow = false;
    key.shadow.mapSize.set(2048, 2048); key.shadow.camera.left = -360; key.shadow.camera.right = 360;
    key.shadow.camera.top = 360; key.shadow.camera.bottom = -360; key.shadow.camera.near = .1; key.shadow.camera.far = 1100;
    key.shadow.bias = -.001; key.shadow.normalBias = .15; key.shadow.radius = 4;
    scene.add(key);
    fillLight = new THREE.DirectionalLight(0xffffff, 1.1); fillLight.position.set(220, -80, -120); scene.add(fillLight);
    rimLight = new THREE.DirectionalLight(0xffecd6, 1.25); rimLight.position.set(0, 150, 240); scene.add(rimLight);
    lampLight = new THREE.PointLight(0xffb24d, 0, 550, 1.2);
    lampLight.castShadow = false;
    scene.add(lampLight);
    shadowMaterial = new THREE.ShadowMaterial({ color: 0x0c060b, opacity: .25, side: THREE.DoubleSide });
    wallMaterial = new THREE.MeshBasicMaterial({ color: 0x8a858b, side: THREE.DoubleSide, toneMapped: false });
    wallModule = createWallModule();
    backdrop = wallModule;
    scene.add(wallModule);
    grid = new THREE.GridHelper(256, 32, 0x997687, 0x997687); grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true; grid.material.opacity = .13; grid.visible = false; scene.add(grid);
    modelGroup = new THREE.Group(); scene.add(modelGroup);
    explodeGuideLines = new THREE.Group(); explodeGuideLines.visible = false; scene.add(explodeGuideLines);
    buildPlateGroup = createBuildPlate(); scene.add(buildPlateGroup);
    const resize = () => {
      const { width, height } = $('viewer').getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      renderer.setSize(width, height, false); camera.aspect = width / height; camera.updateProjectionMatrix();
    };
    resizeObserver = new ResizeObserver(resize); resizeObserver.observe($('viewer')); resize();
    camera.position.set(180, 150, -330); controls.target.set(0, 0, 15); controls.update();
    renderer.setAnimationLoop(() => {
      updateExplodeAnimation();
      controls.update();
      updateWallBackIndicator();
      renderer.render(scene, camera);
    });
  } catch (error) {
    console.error('Anteprima 3D:', error);
    $('viewer-empty').querySelector('h3').textContent = 'Anteprima 3D non disponibile';
    $('viewer-empty').querySelector('p').textContent = 'I file possono comunque essere generati. Prova un browser con accelerazione grafica.';
  }
}

function clearModel() {
  if (!modelGroup) return;
  while (modelGroup.children.length) {
    const child = modelGroup.children[0]; modelGroup.remove(child);
    child.traverse((object) => { object.geometry?.dispose(); if (Array.isArray(object.material)) object.material.forEach((m) => {m.map?.dispose();m.dispose();}); else {object.material?.map?.dispose();object.material?.dispose();} });
  }
  if (explodeGuideLines) {
    while (explodeGuideLines.children.length) {
      const c = explodeGuideLines.children[0]; explodeGuideLines.remove(c);
      c.geometry?.dispose(); c.material?.dispose();
    }
    explodeGuideLines.visible = false;
  }
}

function createKapplakePuck() {
  const puckGroup = new THREE.Group();
  puckGroup.name = 'kapplakePuck';

  const bodyGeo = new THREE.CylinderGeometry(21.5, 21.5, 11, 40);
  bodyGeo.rotateX(Math.PI / 2);
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xefede8, roughness: 0.45, metalness: 0.05
  });
  const bodyMesh = new THREE.Mesh(bodyGeo, bodyMat);
  bodyMesh.castShadow = true;
  bodyMesh.receiveShadow = true;
  puckGroup.add(bodyMesh);

  const lensGeo = new THREE.CylinderGeometry(18, 18, 1.2, 40);
  lensGeo.rotateX(Math.PI / 2);
  const lensMat = new THREE.MeshStandardMaterial({
    color: 0xfff4e6, roughness: 0.2, metalness: 0,
    emissive: state.lampOn ? 0xffaa40 : 0x221810,
    emissiveIntensity: state.lampOn ? 3.0 : 0.1
  });
  const lensMesh = new THREE.Mesh(lensGeo, lensMat);
  lensMesh.position.z = -5.4;
  puckGroup.add(lensMesh);
  bulbMesh = lensMesh;

  const buttonGeo = new THREE.CylinderGeometry(4, 4, 0.8, 24);
  buttonGeo.rotateX(Math.PI / 2);
  const buttonMat = new THREE.MeshStandardMaterial({ color: 0xded8cc, roughness: 0.6 });
  const buttonMesh = new THREE.Mesh(buttonGeo, buttonMat);
  buttonMesh.position.z = -5.9;
  puckGroup.add(buttonMesh);

  const notchGeo = new THREE.BoxGeometry(4, 3, 8);
  const notchMat = new THREE.MeshStandardMaterial({ color: 0x333333, roughness: 0.8 });
  const notchMesh = new THREE.Mesh(notchGeo, notchMat);
  notchMesh.position.set(0, -20.5, 2);
  puckGroup.add(notchMesh);

  puckGroup.userData.isPuck = true;
  return puckGroup;
}

function ensureKapplakePuck(box, center) {
  if (!kapplakePuck) {
    kapplakePuck = createKapplakePuck();
    scene.add(kapplakePuck);
  }
  if (state.view !== 'assembled') {
    kapplakePuck.visible = false;
    if (lampLight) lampLight.intensity = 0;
    return;
  }
  const maxZ = Number.isFinite(box?.max?.z) ? box.max.z : 50;
  const puckZ = maxZ - 13;
  const posX = Number.isFinite(center?.x) ? center.x : 0;
  const posY = Number.isFinite(center?.y) ? center.y : 0;
  kapplakePuck.userData.basePos = new THREE.Vector3(posX, posY, puckZ);
  kapplakePuck.position.copy(kapplakePuck.userData.basePos);
  kapplakePuck.visible = true;
  if (lampLight) {
    lampLight.position.set(posX, posY, puckZ - 6);
  }
}

function toggleLampLight() {
  state.lampOn = !state.lampOn;
  applyLampLight();
}

function applyLampLight() {
  const btn = $('toggle-light');
  if (btn) {
    btn.classList.toggle('active', state.lampOn);
    btn.setAttribute('aria-pressed', String(state.lampOn));
  }
  const shell = $('viewer')?.closest('.viewer-shell');
  if (shell) {
    shell.classList.toggle('night-mode', state.lampOn);
  }

  if (hemiLight) hemiLight.intensity = state.lampOn ? 0.22 : 1.5;
  if (keyLight) keyLight.intensity = state.lampOn ? 0.28 : 2.0;
  if (fillLight) fillLight.intensity = state.lampOn ? 0.12 : 1.1;
  if (rimLight) {
    rimLight.intensity = state.lampOn ? 0.40 : 1.25;
    rimLight.color.setHex(state.lampOn ? 0xffd29d : 0xffecd6);
  }

  if (lampLight) {
    lampLight.intensity = (state.lampOn && state.view === 'assembled') ? 8.5 : 0;
    lampLight.color.setHex(0xffb24d);
  }

  if (bulbMesh && bulbMesh.material) {
    bulbMesh.material.emissive.setHex(state.lampOn ? 0xffbf66 : 0x221810);
    bulbMesh.material.emissiveIntensity = state.lampOn ? 3.8 : 0.1;
  }

  applyFilamentColors();
  updateWallTheme();

  if (modelGroup) {
    modelGroup.children.forEach((obj) => {
      if (obj.userData.isProjection && obj.material && obj.material.color) {
        obj.material.color.setHex(state.lampOn ? 0xfffae8 : 0xfff3e2);
      }
    });
  }
}

function applyFilamentColors() {
  if (!modelGroup) return;
  const opaqueHex = new THREE.Color(state.colors.opaque);
  const transHex = new THREE.Color(state.colors.transparent);
  const isSilk = state.colors.finish === 'silk';
  const roughness = isSilk ? 0.22 : 0.62;
  const metalness = isSilk ? 0.28 : 0.0;

  modelGroup.children.forEach((mesh) => {
    if (!mesh.isMesh || mesh.userData.isProjection) return;
    if (mesh.userData.materialName === 'opaque') {
      mesh.material.color.copy(opaqueHex);
      mesh.material.roughness = roughness;
      mesh.material.metalness = metalness;
      mesh.material.needsUpdate = true;
    } else if (mesh.userData.materialName === 'transparent') {
      mesh.material.color.copy(transHex);
      if (state.lampOn) {
        mesh.material.emissive.copy(transHex).lerp(new THREE.Color(0xffb84d), 0.65);
        mesh.material.emissiveIntensity = 2.4;
      } else {
        mesh.material.emissive.copy(transHex);
        mesh.material.emissiveIntensity = 0.15;
      }
      mesh.material.needsUpdate = true;
    }
  });

  all('#opaque-swatches .color-swatch-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.color?.toLowerCase() === state.colors.opaque.toLowerCase());
  });
  all('#trans-swatches .color-swatch-btn').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.trans?.toLowerCase() === state.colors.transparent.toLowerCase());
  });
  all('.finish-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.finish === state.colors.finish);
  });
  if ($('opaque-color-name')) $('opaque-color-name').textContent = state.colors.opaqueName;
  if ($('trans-color-name')) $('trans-color-name').textContent = state.colors.transparentName;
  if ($('opaque-custom-color')) $('opaque-custom-color').value = state.colors.opaque;
}

function setOpaqueColor(colorHex, name = 'Personalizzato') {
  state.colors.opaque = colorHex;
  state.colors.opaqueName = name;
  applyFilamentColors();
}

function setTransColor(colorHex, name = 'Trasparente') {
  state.colors.transparent = colorHex;
  state.colors.transparentName = name;
  applyFilamentColors();
}

function setOpaqueFinish(finish) {
  if (['matte', 'silk'].includes(finish)) {
    state.colors.finish = finish;
    applyFilamentColors();
  }
}

function resetFilamentColors() {
  state.colors.opaque = '#f20071';
  state.colors.opaqueName = 'Rosa LaLosch';
  state.colors.finish = 'matte';
  state.colors.transparent = '#ffffff';
  state.colors.transparentName = 'Bianco Neve';
  applyFilamentColors();
  notify('Colori filamento ripristinati');
}

function toggleExplodedView() {
  if (state.view !== 'assembled') return;
  const activating = state.targetExplode < 0.5;
  state.targetExplode = activating ? 1.0 : 0.0;
  const btn = $('toggle-explode');
  if (btn) {
    btn.classList.toggle('active', activating);
    btn.setAttribute('aria-pressed', String(activating));
  }
  const floatCtrl = $('explode-float-control');
  if (floatCtrl) {
    floatCtrl.hidden = !activating && state.targetExplode === 0;
  }
  const slider = $('explode-slider');
  if (slider) slider.value = Math.round(state.targetExplode * 100);
  const valText = $('explode-val');
  if (valText) valText.textContent = slider.value + '%';
}

function onExplodeSliderInput(event) {
  const val = Number(event.target.value) / 100;
  state.targetExplode = val;
  state.explodeAmount = val;
  applyExplodePositions();
  if ($('explode-val')) $('explode-val').textContent = event.target.value + '%';
  const btn = $('toggle-explode');
  const isActive = val > 0.05;
  if (btn) {
    btn.classList.toggle('active', isActive);
    btn.setAttribute('aria-pressed', String(isActive));
  }
}

function updateExplodeAnimation() {
  if (Math.abs(state.targetExplode - state.explodeAmount) > 0.002) {
    state.explodeAmount += (state.targetExplode - state.explodeAmount) * 0.14;
    applyExplodePositions();
    if ($('explode-slider')) $('explode-slider').value = Math.round(state.explodeAmount * 100);
    if ($('explode-val')) $('explode-val').textContent = Math.round(state.explodeAmount * 100) + '%';
  }
}

function applyExplodePositions() {
  if (!modelGroup || state.view !== 'assembled') return;
  const diffShift = -state.explodeAmount * 54;
  const puckShift = state.explodeAmount * 48;

  modelGroup.children.forEach((mesh) => {
    if (mesh.userData.isDiffuser || (mesh.userData.materialName === 'transparent' && !mesh.userData.isProjection)) {
      if (mesh.userData.baseZ === undefined) mesh.userData.baseZ = mesh.position.z;
      mesh.position.z = mesh.userData.baseZ + diffShift;
    }
  });

  if (kapplakePuck && kapplakePuck.userData.basePos) {
    kapplakePuck.position.z = kapplakePuck.userData.basePos.z + puckShift;
    if (lampLight) {
      lampLight.position.z = kapplakePuck.position.z - 6;
    }
  }

  updateExplodeGuideLines();
}

function updateExplodeGuideLines() {
  if (!explodeGuideLines) return;
  while (explodeGuideLines.children.length) {
    const c = explodeGuideLines.children[0];
    explodeGuideLines.remove(c);
    c.geometry?.dispose();
    c.material?.dispose();
  }

  if (state.explodeAmount <= 0.03 || state.view !== 'assembled') {
    explodeGuideLines.visible = false;
    return;
  }

  const box = new THREE.Box3();
  modelGroup.children.forEach((child) => {
    if (child.userData.isHousing || child.userData.materialName === 'opaque') {
      box.expandByObject(child);
    }
  });
  if (box.isEmpty()) return;

  const min = box.min, max = box.max;
  const diffShift = -state.explodeAmount * 54;
  const puckShift = state.explodeAmount * 48;

  const points = [
    new THREE.Vector3(min.x, min.y, 0), new THREE.Vector3(min.x, min.y, diffShift),
    new THREE.Vector3(max.x, min.y, 0), new THREE.Vector3(max.x, min.y, diffShift),
    new THREE.Vector3(max.x, max.y, 0), new THREE.Vector3(max.x, max.y, diffShift),
    new THREE.Vector3(min.x, max.y, 0), new THREE.Vector3(min.x, max.y, diffShift),
  ];

  if (kapplakePuck && kapplakePuck.userData.basePos) {
    const bp = kapplakePuck.userData.basePos;
    points.push(
      new THREE.Vector3(bp.x, bp.y, bp.z),
      new THREE.Vector3(bp.x, bp.y, bp.z + puckShift)
    );
  }

  const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
  const lineMat = new THREE.LineDashedMaterial({
    color: 0xff318b,
    dashSize: 3,
    gapSize: 2,
    transparent: true,
    opacity: 0.65
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.computeLineDistances();
  explodeGuideLines.add(lines);
  explodeGuideLines.visible = true;
}

function showStartupDemo(resetCamera = true) {
  // This illustration contains no printable result or purchase entitlement.
  state.result = null; state.generatedParams = null; state.generatedSignature = null;
  if (!state.workerFailed) state.previewError = null;
  state.dirty = true; state.demoActive = Boolean(modelGroup);
  state.view = 'assembled'; state.internals = false;
  setPressed(all('[data-view]'), 'assembled', 'view');
  if (modelGroup) {
    clearModel();
    const demo = populateStartupDemo(modelGroup, { shape: state.shape, direction: state.direction,
      radius: Number($('filletRadius').value), projections: state.projections });
    const box = new THREE.Box3().setFromObject(modelGroup);
    const center = box.getCenter(new THREE.Vector3());
    ensureKapplakePuck(box, center);
    applyLampLight();
    applyFilamentColors();
    applyExplodePositions();
    if (wallModule) {
      wallModule.visible = true;
      wallModule.position.set(0, 0, demo.wallZ + 0.05);
    }
    if (buildPlateGroup) buildPlateGroup.visible = false;
    grid.visible = false;
    keyLight.castShadow = false;
    keyLight.position.set(-130, 220, -300); keyLight.target.position.set(0, 0, demo.depth / 2);
    keyLight.target.updateMatrixWorld();
    $('viewer-empty').hidden = true;
    if (resetCamera) fitView();
  }
  hideViewerLoading(true);
  $('projection-preview-note').hidden = !state.projections;
  $('projection-preview-note').textContent = 'Esempio · sostituisci i #';
  $('orbit-hint').hidden = state.projections;
  $('warnings-list').hidden = true;
  $('metric-size').textContent = '—'; $('metric-parts').textContent = '—';
  if (state.workerFailed) {
    setBadge('Servizio non disponibile', 'error');
    setStatus('Servizio non disponibile', 'RIPROVA', state.previewError || 'Il servizio non è disponibile. Riprova tra poco.', 'error');
  } else {
    setBadge('Sostituisci i # con le tue parole');
    setStatus('Inizia dalle tue parole', 'DA PERSONALIZZARE', 'I # sono segnaposto. Inserisci le tue parole e genera la lampada.');
  }
}

function appendMesh(data, materialName) {
  if (!data || !modelGroup) return;
  if (Array.isArray(data) && !data.positions) { data.forEach((part) => appendMesh(part, materialName)); return; }
  if (Array.isArray(data.meshes)) { data.meshes.forEach((part) => appendMesh(part, materialName)); return; }
  if (!data.positions?.length) return;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
  if (data.indices?.length) geometry.setIndex(data.indices);
  if (data.normals?.length === data.positions.length) geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3));
  else geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const opaque = materialName === 'opaque';
  const isSilk = state.colors.finish === 'silk';
  const transColor = new THREE.Color(state.colors.transparent);
  const material = opaque
    ? new THREE.MeshStandardMaterial({
        color: new THREE.Color(state.colors.opaque),
        roughness: isSilk ? 0.22 : 0.62,
        metalness: isSilk ? 0.28 : 0.0,
        side: THREE.DoubleSide
      })
    : new THREE.MeshStandardMaterial({
        color: transColor,
        roughness: 0.32,
        metalness: 0,
        emissive: state.lampOn ? transColor.clone().lerp(new THREE.Color(0xffa830), 0.6) : transColor,
        emissiveIntensity: state.lampOn ? 1.8 : 0.15,
        side: THREE.DoubleSide
      });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = (state.view === 'print') && opaque;
  mesh.receiveShadow = (state.view === 'print');
  mesh.userData.materialName = materialName;
  mesh.userData.isHousing = opaque;
  mesh.userData.isDiffuser = !opaque;
  mesh.userData.baseZ = mesh.position.z;
  modelGroup.add(mesh);
  // Edge overlays amplify tessellation and overlap the flush material boundaries.
  // Smooth surface normals preserve the actual round surfaces in both modes.
}

function currentMeshes() {
  if (!state.result) return null;
  return state.view === 'assembled' ? state.result.assembled : resultPlates()[state.plate] ?? state.result.print;
}

function polygonArea(points) {
  let twice = 0;
  for (let i = 0, previous = points.length - 1; i < points.length; previous = i++) {
    twice += points[previous][0] * points[i][1] - points[i][0] * points[previous][1];
  }
  return twice / 2;
}

function pointInside(point, polygon) {
  let inside = false;
  for (let i = 0, previous = polygon.length - 1; i < polygon.length; previous = i++) {
    const a = polygon[i], b = polygon[previous];
    if ((a[1] > point[1]) !== (b[1] > point[1])
      && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function pathFromPolygon(points, path) {
  path.moveTo(points[0][0], points[0][1]);
  for (const point of points.slice(1)) path.lineTo(point[0], point[1]);
  path.closePath(); return path;
}

function projectionGeometry(shape, bridges = []) {
  const original = new THREE.ShapeGeometry(shape);
  if (!bridges.length) return original;
  const source = original.getAttribute('position'), index = original.index, vertices = [];
  const halfPlane = (poly, axis, value, keepLower) => {
    const out = [], inside = p => keepLower ? p[axis] <= value : p[axis] >= value;
    for (let i=0;i<poly.length;i++) {
      const a=poly[i], b=poly[(i+1)%poly.length], ai=inside(a), bi=inside(b);
      if (ai) out.push(a);
      if (ai!==bi) { const t=(value-a[axis])/(b[axis]-a[axis]); out.push([a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t]); }
    }
    return out;
  };
  const bands = bridges.map(poly => [Math.min(...poly.map(p=>p[0])),Math.max(...poly.map(p=>p[0])),Math.min(...poly.map(p=>p[1])),Math.max(...poly.map(p=>p[1]))]);
  for (let i=0;i<(index?.count ?? source.count);i+=3) {
    let pieces = [[0,1,2].map(j => {
      const n=index ? index.getX(i+j) : i+j;
      return [source.getX(n),source.getY(n)];
    })];
    for (const [left,right,bottom,top] of bands) pieces=pieces.flatMap(poly=>{
      const middle=halfPlane(halfPlane(poly,0,left,false),0,right,true);
      return [halfPlane(poly,0,left,true),halfPlane(poly,0,right,false),halfPlane(middle,1,bottom,true),halfPlane(middle,1,top,false)];
    }).filter(poly=>poly.length>=3);
    for (const poly of pieces) for (let j=1;j<poly.length-1;j++) {
      for (const p of [poly[0],poly[j],poly[j+1]]) vertices.push(p[0],p[1],0);
    }
  }
  original.dispose();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  return geometry;
}

function appendProjectionGlow(item) {
  const contours = item.wall ?? [], points = contours.flat();
  if (!points.length) return;
  const padding = 12, minX = Math.min(...points.map(p=>p[0])) - padding,
    maxX = Math.max(...points.map(p=>p[0])) + padding,
    minY = Math.min(...points.map(p=>p[1])) - padding,
    maxY = Math.max(...points.map(p=>p[1])) + padding;
  const width = maxX-minX, height = maxY-minY, pixels = Math.min(4, 2048/Math.max(width,height));
  const mask = document.createElement('canvas'); mask.width = Math.ceil(width*pixels); mask.height = Math.ceil(height*pixels);
  const ctx = mask.getContext('2d');
  const drawContours = list => {
    ctx.beginPath();
    for (const poly of list) {
      poly.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo']((x-minX)*pixels,(maxY-y)*pixels));
      ctx.closePath();
    }
    ctx.fill('evenodd');
  };
  ctx.fillStyle = '#fff0dc'; drawContours(contours);
  ctx.globalCompositeOperation = 'destination-out'; drawContours(item.wallBridges ?? []);
  const canvas = document.createElement('canvas'); canvas.width = mask.width; canvas.height = mask.height;
  const glow = canvas.getContext('2d');
  glow.globalAlpha = 0.40; glow.filter = `blur(${8 * pixels}px)`; glow.drawImage(mask, 0, 0);
  glow.globalAlpha = 0.65; glow.filter = `blur(${3.5 * pixels}px)`; glow.drawImage(mask, 0, 0);
  glow.globalAlpha = 0.85; glow.filter = `blur(${1.2 * pixels}px)`; glow.drawImage(mask, 0, 0);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:1,depthWrite:false,
    blending:THREE.AdditiveBlending,side:THREE.DoubleSide,toneMapped:false});
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(width,height),material);
  mesh.position.set((minX+maxX)/2,(minY+maxY)/2,Number(state.result.meta.wallZ ?? state.result.meta.params?.depth ?? 50)-.04);
  mesh.userData.isProjection = true; mesh.renderOrder = 0; modelGroup.add(mesh);
}

function appendWallProjections() {
  const projection = state.result?.meta?.projection;
  const enabled = state.view === 'assembled' && state.projections && Array.isArray(projection) && projection.length > 0;
  $('projection-preview-note').hidden = !enabled;
  $('projection-preview-note').textContent = 'Anteprima geometrica · proiezione ideale';
  $('orbit-hint').hidden = enabled;
  if (!enabled) return;
  for (const item of projection) {
    appendProjectionGlow(item);
    const contours = (item.wall ?? []).filter((polygon) => Array.isArray(polygon) && polygon.length >= 3
      && polygon.every((point) => point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])))
      .map((polygon, index) => ({ polygon, index, area: Math.abs(polygonArea(polygon)), parent: -1, depth: 0 }));
    for (const contour of contours) {
      const containers = contours.filter((candidate) => candidate !== contour && candidate.area > contour.area
        && pointInside(contour.polygon[0], candidate.polygon)).sort((a, b) => a.area - b.area);
      if (containers.length) contour.parent = containers[0].index;
    }
    for (const contour of contours) {
      let parent = contours.find((candidate) => candidate.index === contour.parent);
      while (parent) { contour.depth += 1; parent = contours.find((candidate) => candidate.index === parent.parent); }
    }
    for (const outer of contours.filter((contour) => contour.depth % 2 === 0 && contour.area > .0001)) {
      const shape = pathFromPolygon(outer.polygon, new THREE.Shape());
      for (const hole of contours.filter((contour) => contour.parent === outer.index && contour.depth % 2 === 1)) {
        shape.holes.push(pathFromPolygon(hole.polygon, new THREE.Path()));
      }
      const geometry = projectionGeometry(shape, item.wallBridges);
      const material = new THREE.MeshBasicMaterial({ color: 0xfff3e2, side: THREE.DoubleSide, toneMapped: false,
        polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const mesh = new THREE.Mesh(geometry, material);
      const wallZ = Number(state.result.meta.wallZ ?? outer.polygon[0][2] ?? state.result.meta.params?.depth);
      mesh.position.z = wallZ - .1; mesh.userData.isProjection = true;
      mesh.renderOrder = 1; modelGroup.add(mesh);
    }
  }
}

function displayModel(resetCamera = true) {
  if (state.demoActive) { showStartupDemo(resetCamera); return; }
  if (!modelGroup || !state.result || state.previewError) return;
  clearModel();
  const data = currentMeshes(); appendMesh(data?.opaque, 'opaque'); appendMesh(data?.transparent, 'transparent');
  appendWallProjections();
  if (!modelGroup.children.length) return;
  $('viewer-empty').hidden = true;
  const box = new THREE.Box3().setFromObject(modelGroup);
  const center = box.getCenter(new THREE.Vector3());
  ensureKapplakePuck(box, center);
  applyLampLight();
  applyFilamentColors();
  applyExplodePositions();
  const print = state.view === 'print';
  if (buildPlateGroup) {
    buildPlateGroup.visible = print;
    if (print) {
      buildPlateGroup.position.z = box.min.z - 0.15;
    }
  }
  if (wallModule) {
    wallModule.visible = !print;
    if (!print) {
      const wallZ = Number(state.result?.meta?.wallZ ?? state.result?.meta?.params?.depth ?? box.max.z);
      wallModule.position.set(center.x, center.y, wallZ + 0.05);
    }
  }
  backdrop = wallModule;
  if (grid) grid.visible = false;

  keyLight.castShadow = print;
  if (print) {
    const bedZ = box.min.z;
    keyLight.position.set(128 - 70, 128 + 170, bedZ + 360);
    keyLight.target.position.set(128, 128, bedZ);
    keyLight.target.updateMatrixWorld();
    keyLight.shadow.camera.left = -160;
    keyLight.shadow.camera.right = 160;
    keyLight.shadow.camera.top = 160;
    keyLight.shadow.camera.bottom = -160;
    keyLight.shadow.camera.near = 50;
    keyLight.shadow.camera.far = 800;
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.shadow.bias = -0.0006;
  } else {
    keyLight.position.set(center.x - 130, center.y + 220, center.z - 300);
    keyLight.target.position.copy(center);
    keyLight.target.updateMatrixWorld();
    keyLight.shadow.camera.left = -360;
    keyLight.shadow.camera.right = 360;
    keyLight.shadow.camera.top = 360;
    keyLight.shadow.camera.bottom = -360;
    keyLight.shadow.camera.near = 0.1;
    keyLight.shadow.camera.far = 1100;
    keyLight.shadow.camera.updateProjectionMatrix();
    keyLight.shadow.bias = -0.001;
  }
  applyInternals();
  if (resetCamera) fitView();
}

function fitView() {
  if (!modelGroup?.children.length || !camera || !controls) return;
  const box = new THREE.Box3().setFromObject(modelGroup);
  if (state.view === 'print') {
    // Exported parts share the slicer's [0, 256] XY coordinates. Include the
    // complete plate so small panels do not appear to fill a larger print bed.
    const bedZ = box.min.z;
    box.expandByPoint(new THREE.Vector3(0, 0, bedZ));
    box.expandByPoint(new THREE.Vector3(256, 256, bedZ));
  }
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maximum = Math.max(size.x, size.y, size.z, 50);
  const halfAngle = THREE.MathUtils.degToRad(camera.fov / 2);
  const isPortrait = camera.aspect < 1.0;
  const paddingFactor = isPortrait ? 1.18 : 1.35;
  const distance = Math.max(
    size.y / (2 * Math.tan(halfAngle)),
    size.x / (2 * Math.tan(halfAngle) * camera.aspect),
    maximum * .7
  ) * paddingFactor;

  let direction;
  if (state.camera === 'front') {
    direction = new THREE.Vector3(0, 0, state.view === 'print' ? 1 : -1);
  } else if (state.camera === 'top') {
    direction = new THREE.Vector3(0, 1, .015);
  } else if (state.camera === 'bottom') {
    direction = new THREE.Vector3(0.05, -0.65, state.view === 'print' ? 0.35 : -0.7).normalize();
  } else {
    // Balanced isometric perspective:
    // On mobile portrait, avoid excessive lateral (X) and vertical (Y) shift
    // so the lamp is prominently centered and background is stable
    const xAngle = isPortrait ? 0.18 : 0.35;
    const yAngle = isPortrait ? 0.30 : 0.55;
    direction = new THREE.Vector3(xAngle, yAngle, state.view === 'print' ? 1 : -1).normalize();
  }
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.near = .1; camera.far = Math.max(5000, distance * 8); camera.updateProjectionMatrix();
  controls.target.copy(center); controls.update();
}

function applyInternals() {
  $('show-internals').setAttribute('aria-pressed', String(state.internals));
  if (!modelGroup) return;
  modelGroup.children.forEach((object) => {
    if (['opaque', 'transparent'].includes(object.userData.materialName)
      && !object.userData.isEdges && !object.userData.isProjection) {
      object.material.transparent = state.internals;
      object.material.opacity = state.internals ? .23 : 1;
      object.material.depthWrite = !state.internals; object.material.needsUpdate = true;
    }
  });
}

function switchView(view) {
  if (!['assembled', 'print'].includes(view)) return;
  if ((state.demoActive || !state.result) && view === 'print') return;
  state.view = view; setPressed(all('[data-view]'), view, 'view');
  if (view !== 'assembled') {
    state.targetExplode = 0;
    state.explodeAmount = 0;
    applyExplodePositions();
    if ($('explode-float-control')) $('explode-float-control').hidden = true;
    if ($('toggle-explode')) {
      $('toggle-explode').classList.remove('active');
      $('toggle-explode').setAttribute('aria-pressed', 'false');
    }
  }
  if ($('wall-style-selector')) {
    $('wall-style-selector').hidden = (view !== 'assembled');
  }
  displayModel(); updateButtons();
}

function toggleInternals() {
  if (state.demoActive || !state.result) return;
  state.internals = !state.internals;
  applyInternals(); updateButtons();
}

function setCameraView(value) {
  if (!['iso', 'front', 'top', 'bottom'].includes(value)) return;
  state.camera = value; setPressed(all('[data-camera]'), value, 'camera');
  fitView();
}

const STAGES = { init: 'Preparazione del generatore', loading: 'Caricamento della geometria', font: 'Lettura delle parole',
  socket: 'Inserimento della sede LED', housing: 'Costruzione della scocca', text: 'Disegno delle lettere',
  projection: 'Calcolo delle proiezioni', panels: 'Costruzione dei pannelli', pins: 'Orientamento dei pin',
  assembly: 'Montaggio dei componenti', validation: 'Controllo della geometria', meshing: 'Preparazione dell’anteprima',
  export: 'Creazione dei file STEP', step: 'Creazione dei file STEP', print: 'Disposizione sui piatti' };

function progressMessage(message) {
  const stage = message.message ?? STAGES[message.stage] ?? (typeof message.stage === 'string' && /\s/.test(message.stage) ? message.stage : 'Costruzione della lampada');
  const progress = Number(message.progress);
  const percentage = Number.isFinite(progress) ? Math.round(progress <= 1 ? progress * 100 : progress) : null;
  return percentage !== null ? `${stage} · ${Math.min(100, Math.max(0, percentage))}%` : stage;
}

function purchaseKey() {
  // Keep existing Sandbox purchases recoverable without treating them as Live purchases.
  return purchaseStorageKey(state.payment.config?.freeTestDownloads?'test':state.payment.config?.paypalEnvironment ?? 'sandbox');
}

function purchaseStore() {
  try {
    const saved = JSON.parse(localStorage.getItem(purchaseKey()));
    if (saved && typeof saved === 'object' && saved.previews && typeof saved.previews === 'object') return saved;
  } catch { /* A fresh browser has no purchase record. */ }
  return { current: null, previews: {} };
}

function savePurchase() {
  const payment = state.payment;
  if (!payment.previewId || !payment.accessToken) return false;
  try {
    const saved = purchaseStore(), previousCurrent = saved.current; saved.current = payment.previewId;
    saved.previews[payment.previewId] = { previewId: payment.previewId, accessToken: payment.accessToken,
      configHash: payment.configHash, orderId: payment.orderId, revisionOfOrderId: payment.revisionOfOrderId,
      params: state.generatedParams, updatedAt: Date.now() };
    const entries = Object.entries(saved.previews).sort((a, b) => (b[1].updatedAt ?? 0) - (a[1].updatedAt ?? 0));
    saved.previews = Object.fromEntries(entries.filter(([id, item], index) => previousCurrent === null || index < 30
      || id === previousCurrent || item.orderId || item.revisionOfOrderId || saved.purchase?.previewId === id));
    localStorage.setItem(purchaseKey(), JSON.stringify(saved)); return true;
  } catch { return false; }
}

function paymentApi(path, options = {}) {
  return requestJson(`${API_BASE}${path}`, { ...options, accessToken: state.payment.accessToken });
}

function purchaseApi(path, options = {}) {
  return requestJson(`${API_BASE}${path}`, { ...options, accessToken: state.purchase?.accessToken });
}

function saveOriginalPurchase() {
  if (!state.purchase) return;
  try {
    const saved = purchaseStore(); saved.purchase = { orderId: state.purchase.orderId, accessToken: state.purchase.accessToken,
      previewId: state.purchase.previewId, params: state.purchase.params };
    localStorage.setItem(purchaseKey(), JSON.stringify(saved));
  } catch { /* The current purchase can still be used until the page closes. */ }
}

async function refreshPurchase(saved = state.purchase) {
  if (!saved?.orderId || !saved?.accessToken) return;
  const entitlement = await requestJson(`${API_BASE}/api/orders/${encodeURIComponent(saved.orderId)}/entitlement`, { accessToken: saved.accessToken });
  state.purchase = { ...saved, ...entitlement }; saveOriginalPurchase(); updateButtons();
}

async function currentPaidLinks() {
  if (!state.payment.revisionOfOrderId) return paymentApi(`/api/orders/${encodeURIComponent(state.payment.orderId)}/download-link`, { method: 'POST', body: {} });
  if (state.purchase?.orderId !== state.payment.revisionOfOrderId) throw new Error('Riapri questa correzione nel browser usato per l’acquisto originale.');
  await refreshPurchase();
  if (state.purchase.revisionPreviewId !== state.payment.previewId || !state.purchase.revisionDownloadUrl) throw new Error('Questa correzione non risulta ancora confermata.');
  return { downloadUrl: state.purchase.revisionDownloadUrl, receiptUrl: state.purchase.revisionReceiptUrl };
}

async function restoreServerPreview(saved) {
  state.payment.previewId = saved.previewId; state.payment.accessToken = saved.accessToken;
  state.payment.configHash = saved.configHash; state.payment.orderId = saved.orderId;
  state.payment.revisionOfOrderId = saved.revisionOfOrderId ?? null;
  const response = await paymentApi(`/api/preview/${encodeURIComponent(saved.previewId)}`);
  if (saved.params) writeParams({ ...INITIAL, ...saved.params });
  state.generatedParams = validateParams(readParams()).params;
  state.generatedSignature = JSON.stringify(state.generatedParams);
  receiveResult(response.data); state.autoStarted = true;
}

function clearPayPalReturn() {
  const url = new URL(location.href);
  for (const key of ['paypal', 'token', 'PayerID']) url.searchParams.delete(key);
  history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
}

async function verifyPayment(orderId) {
  if(state.payment.config?.freeTestDownloads)return;
  state.payment.busy = true; state.payment.message = 'Verifica del pagamento con PayPal…'; updateButtons();
  try {
    const receipt = await paymentApi(`/api/orders/${encodeURIComponent(orderId)}/capture`, { method: 'POST', body: {} });
    if (receipt.status !== 'COMPLETED' || !receipt.downloadUrl) throw new Error('Il pagamento non risulta ancora completato. Riprova la verifica.');
    state.payment.paid = true; state.payment.downloadUrl = sameOriginDownload(receipt.downloadUrl, location.origin);
    state.payment.receiptUrl = receipt.receiptUrl ? sameOriginDownload(receipt.receiptUrl, location.origin) : null;
    state.payment.orderId = orderId; state.payment.captureFailed = false;
    state.payment.message = 'Pagamento confermato. I tuoi file STEP sono pronti da scaricare.';
    state.purchase = { orderId, accessToken: state.payment.accessToken, previewId: state.payment.previewId,
      originalPreviewId: state.payment.previewId, params: state.generatedParams,
      revisionAllowance: receipt.revisionAllowance, remainingRevisions: receipt.remainingRevisions ?? null };
    savePurchase(); saveOriginalPurchase();
    await refreshPurchase(); clearPayPalReturn(); notify('Pagamento confermato: i file STEP sono sbloccati.');
  } catch (error) {
    state.payment.captureFailed = true; state.payment.message = error.message; notify(error.message);
  } finally { state.payment.busy = false; updateButtons(); }
}

async function initializeServer() {
  state.ready = false; state.workerFailed = false; updateButtons(); setBadge('Connessione al generatore');
  try {
    state.payment.config = await requestJson(`${API_BASE}/api/studio`);
    state.ready = true; state.workerFailed = false; updateButtons();
    const freeTest=state.payment.config.freeTestDownloads===true;
    const returning = freeTest?null:paypalReturn(location.search), saved = purchaseStore();
    if(freeTest){state.purchase=null;if(paypalReturn(location.search))clearPayPalReturn();}
    if (!freeTest && saved.purchase) {
      try { await refreshPurchase(saved.purchase); }
      catch { state.payment.message = 'L’acquisto salvato non è al momento raggiungibile. Riprova nello stesso browser usato per PayPal.'; }
    }
    const record = returning?.action === 'capture'
      ? Object.values(saved.previews).find(item => item.orderId === returning.orderId)
      : saved.previews[saved.current];
    if (record?.previewId && record?.accessToken) {
      state.busy = true;
      startLoadingProgress('Ripristino della tua lampada');
      updateButtons();
      try { await restoreServerPreview(record); }
      catch (error) {
        const missingUnpaid = (error.status === 404 || error.status === 403 || error.code === 'NOT_FOUND' || error.code === 'ACCESS_DENIED') && !returning
          && !record.orderId && !record.revisionOfOrderId && saved.purchase?.previewId !== record.previewId;
        const mechanicalUpdate=error.status===410&&error.code==='MECHANICAL_UPDATE_REQUIRED';
        if (!missingUnpaid&&!mechanicalUpdate) throw error;
        // A deployment may discard an unpaid preview. Keep its draft and all
        // purchase records, then replace only the unavailable current preview.
        let storedDraft = false;
        try { const draft = JSON.parse(localStorage.getItem(STORAGE_KEY)); storedDraft = Boolean(draft && typeof draft === 'object'); } catch { /* Prefer the form's current words. */ }
        if (mechanicalUpdate&&record.params&&!storedDraft)writeParams({...INITIAL,...record.params});
        else if (!storedDraft && !hasWords() && record.params) writeParams({ ...INITIAL, ...record.params });
        if(mechanicalUpdate&&returning)clearPayPalReturn();
        try {
          const retained = purchaseStore();
          if (retained.current === record.previewId) {
            retained.current = null; localStorage.setItem(purchaseKey(), JSON.stringify(retained));
          }
        } catch { /* Preview generation still works without browser storage. */ }
        Object.assign(state.payment, { previewId: null, accessToken: null, configHash: null, orderId: null,
          paid: false, downloadUrl: null, receiptUrl: null, revisionOfOrderId: null, busy: false, captureFailed: false, message: '' });
        state.busy = false; state.workerFailed = false; state.ready = true; state.autoStarted = false;
        state.result = null; state.generatedParams = null; state.generatedSignature = null; state.previewError = null;
        hideViewerLoading(true);
        startInitialGeneration(); updateButtons(); return;
      }
      if(freeTest){
        Object.assign(state.payment,{paid:false,orderId:null,revisionOfOrderId:null,downloadUrl:null,receiptUrl:null});
        updateButtons();return;
      }
      if (returning?.action === 'capture') await verifyPayment(returning.orderId);
      else if (returning?.action === 'cancel') {
        state.payment.orderId = null; state.payment.message = 'Pagamento annullato. Puoi riprenderlo quando vuoi.';
        savePurchase(); clearPayPalReturn(); updateButtons();
      } else if (record.orderId || record.revisionOfOrderId) {
        try {
          const receipt = await currentPaidLinks();
          state.payment.downloadUrl = sameOriginDownload(receipt.downloadUrl, location.origin); state.payment.paid = true;
          state.payment.receiptUrl = receipt.receiptUrl ? sameOriginDownload(receipt.receiptUrl, location.origin) : null;
        } catch { /* An unapproved order does not unlock downloads. */ }
        updateButtons();
      }
      return;
    }
    if (returning?.action === 'capture') {
      state.payment.message = 'Per verificare questo acquisto, riapri il collegamento nello stesso browser usato per il pagamento.';
      notify(state.payment.message);
    } else if (returning?.action === 'cancel') {
      state.payment.message = 'Pagamento annullato. Nessun file è stato acquistato.'; clearPayPalReturn();
    }
    startInitialGeneration();
  } catch (error) {
    state.workerFailed = true; state.ready = false;
    generationError(error.message ?? 'Il servizio non è disponibile. Riprova tra poco.');
  }
}

function initializeWorker() {
  if (SERVER_MODE) { initializeServer(); return; }
  state.worker?.terminate(); state.ready = false; state.workerFailed = false; updateButtons();
  setBadge('Preparazione del generatore');
  try {
    const worker = new Worker(new URL('./cad-worker.js', import.meta.url), { type: 'module' }); state.worker = worker;
    worker.onmessage = ({ data: message }) => {
      if (message.type === 'ready') {
        state.ready = true; state.workerFailed = false; updateButtons();
        if (!state.result) setBadge('Generatore pronto');
        startInitialGeneration();
        return;
      }
      if (message.id !== undefined && message.id !== state.request) return;
      if (message.type === 'progress') {
        const text = progressMessage(message);
        if (state.busy) $('loading-message').textContent = text;
        else $('generate-hint').textContent = text;
      } else if (message.type === 'result') receiveResult(message.data ?? message);
      else if (message.type === 'error') {
        if (!state.ready) state.workerFailed = true;
        generationError(message.error ?? 'La geometria non può essere completata con questi valori.');
      }
    };
    worker.onerror = async (error) => {
      console.error('Generatore:', error); state.workerFailed = true; state.ready = false;
      let message = 'Il motore CAD non è riuscito ad avviarsi. Premi Ricarica il generatore per riprovare.';
      try {
        const response = await fetch(new URL('./runtime-config.js', import.meta.url), {cache:'no-store',signal:AbortSignal.timeout(4000)});
        if (!response.ok) message = 'Una risorsa del generatore non è disponibile. Ricarica la pagina dopo aver riavviato Lamp Studio.';
      } catch {
        message = 'Il servizio locale di Lamp Studio è spento. Apri Avvia Lamp Studio.command e poi premi Ricarica il generatore.';
      }
      if (worker !== state.worker) return;
      generationError(message);
    };
    worker.onmessageerror = () => generationError('Il risultato non è stato ricevuto correttamente. Genera nuovamente il modello.');
    worker.postMessage({ type: 'init' });
  } catch (error) {
    state.workerFailed = true; generationError('Il browser non può avviare il generatore. Ricarica la pagina per riprovare.');
  }
}

function startInitialGeneration() {
  if (state.autoStarted) return;
  state.autoStarted = true;
  if (validateParams(readParams()).valid) generate();
  else if (!hasWords()) { showStartupDemo(); updateButtons(); }
}

let loadingProgressTimer = null;
let currentLoadingPercent = 12;

function showViewerLoading(mainTitle = 'Costruzione della lampada 3D') {
  const loadingEl = $('viewer-loading');
  if (!loadingEl) return;
  loadingEl.classList.remove('fade-out', 'is-hidden');
  loadingEl.removeAttribute('hidden');
  loadingEl.hidden = false;
  loadingEl.style.removeProperty('display');
  const mainTitleEl = $('loading-message');
  if (mainTitleEl && mainTitle) mainTitleEl.textContent = mainTitle;
}

function hideViewerLoading(immediate = false) {
  const loadingEl = $('viewer-loading');
  if (!loadingEl) return;
  if (immediate) {
    loadingEl.classList.add('is-hidden');
    loadingEl.classList.remove('fade-out');
    loadingEl.setAttribute('hidden', '');
    loadingEl.hidden = true;
    loadingEl.style.setProperty('display', 'none', 'important');
  } else {
    loadingEl.classList.add('fade-out');
    setTimeout(() => {
      loadingEl.classList.add('is-hidden');
      loadingEl.classList.remove('fade-out');
      loadingEl.setAttribute('hidden', '');
      loadingEl.hidden = true;
      loadingEl.style.setProperty('display', 'none', 'important');
    }, 280);
  }
}

function startLoadingProgress(mainTitle = 'Costruzione della lampada 3D') {
  clearInterval(loadingProgressTimer);
  currentLoadingPercent = 12;
  showViewerLoading(mainTitle);

  const progressBar = $('loading-progress-bar');
  const percentText = $('loading-percent-text');
  const stepText = $('loading-step-text');
  const wordDisplay = $('loading-word-display');
  const stageBadge = $('loading-stage-badge');

  if (wordDisplay) {
    const p = readParams();
    const parts = [];
    if (p.topText) parts.push(`Sopra: ${p.topText}`);
    if (p.centerText) parts.push(`Centro: ${p.centerText}`);
    if (p.bottomText) parts.push(`Sotto: ${p.bottomText}`);
    if (p.leftText) parts.push(`Sx: ${p.leftText}`);
    if (p.rightText) parts.push(`Dx: ${p.rightText}`);
    wordDisplay.textContent = parts.join(' · ') || 'TRI · MO · NE';
  }

  const stages = [
    { at: 12, badge: 'MOTORE CAD ONLINE', step: 'Inizializzazione calcolo geometrico OpenCASCADE...' },
    { at: 32, badge: 'MODELLAZIONE SCOCCA', step: 'Generazione scocca esterna e raccordi 10 mm...' },
    { at: 52, badge: 'TAGLIO STENCIL CAD', step: 'Incisione stencil lettere e ponti ottici...' },
    { at: 70, badge: 'DIFFUSORE OTTICO', step: 'Modellazione diffusore trasparente in PETG...' },
    { at: 84, badge: 'HARDWARE & CAVO', step: 'Calibrazione sede IKEA KAPPLAKE e passacavi...' },
    { at: 92, badge: 'CALCOLO BOOLEANO 3D', step: 'Unione volumetrica e taglio solido...' },
    { at: 96, badge: 'FINALIZZAZIONE MESH', step: 'Compilazione coordinate bicolore e buffer 3D...' }
  ];

  if (progressBar) progressBar.style.width = '12%';
  if (percentText) percentText.textContent = '12%';
  if (stepText) stepText.textContent = stages[0].step;
  if (stageBadge) stageBadge.textContent = stages[0].badge;

  const startTime = Date.now();
  loadingProgressTimer = setInterval(() => {
    const elapsedSeconds = (Date.now() - startTime) / 1000;
    // Smooth continuous progression over ~50-60s so progress never freezes
    const targetPercent = Math.min(98, Math.round(12 + 86 * (1 - Math.exp(-elapsedSeconds / 28))));
    if (targetPercent > currentLoadingPercent) {
      currentLoadingPercent = targetPercent;
    } else if (currentLoadingPercent < 98 && Math.random() < 0.25) {
      currentLoadingPercent = Math.min(98, currentLoadingPercent + 1);
    }

    if (progressBar) progressBar.style.width = `${currentLoadingPercent}%`;
    if (percentText) percentText.textContent = `${currentLoadingPercent}%`;

    for (let i = stages.length - 1; i >= 0; i--) {
      if (currentLoadingPercent >= stages[i].at) {
        if (stepText) stepText.textContent = stages[i].step;
        if (stageBadge) stageBadge.textContent = stages[i].badge;
        break;
      }
    }
  }, 350);
}

function stopLoadingProgress(success = true) {
  clearInterval(loadingProgressTimer);
  const progressBar = $('loading-progress-bar');
  const percentText = $('loading-percent-text');
  const stepText = $('loading-step-text');
  const stageBadge = $('loading-stage-badge');

  if (success && progressBar && percentText) {
    progressBar.style.width = '100%';
    percentText.textContent = '100%';
    if (stepText) stepText.textContent = 'Modello 3D pronto per la stampa!';
    if (stageBadge) stageBadge.textContent = 'CALCOLO COMPLETATO';
    setTimeout(() => {
      hideViewerLoading(false);
    }, 450);
  } else {
    hideViewerLoading(true);
  }
}

function generate() {
  if (state.workerFailed) { initializeWorker(); state.autoStarted = false; return; }
  if (!state.ready || state.busy || (SERVER_MODE && state.payment.busy)) return;
  const validation = validateParams(readParams()); renderInputErrors(validation);
  if (!validation.valid) { updateButtons(validation); return; }
  for (const name of TEXT_FIELDS) $(name).value = validation.params[name];
  refreshControls();
  state.busy = true; state.request += 1; state.generatedParams = validation.params;
  state.generatedSignature = JSON.stringify(validateParams(readParams()).params);
  startLoadingProgress();
  setBadge('Generazione in corso');
  setStatus('Costruzione del modello', 'IN CORSO', 'Calcolo delle aperture, degli incastri e dei due materiali.');
  $('warnings-list').hidden = true; updateButtons(validation);
  const requestParams = { ...validation.params };
  for (const field of ['width', 'height', 'depth', 'margin']) delete requestParams[field];
  if (SERVER_MODE) {
    const requestId = state.request, config = state.payment.config;
    state.payment = { config, previewId: null, accessToken: null, configHash: null, orderId: null,
      paid: false, downloadUrl: null, receiptUrl: null, revisionOfOrderId: null, busy: false, captureFailed: false, message: '' };
    const consent = $('digital-content-consent');
    if (consent) consent.checked = false;
    requestJson(`${API_BASE}/api/preview`, { method: 'POST', body: { params: requestParams } }).then(response => {
      if (requestId !== state.request) return;
      if (!response.previewId || !response.accessToken || !response.data) throw new Error('L’anteprima non è stata ricevuta correttamente.');
      state.payment.previewId = response.previewId; state.payment.accessToken = response.accessToken;
      state.payment.configHash = response.configHash; savePurchase(); receiveResult(response.data);
    }).catch(error => { if (requestId === state.request) generationError(error.message); });
  } else state.worker.postMessage({ type: 'generate', id: state.request, params: requestParams });
}

function messagesOf(items) {
  return (Array.isArray(items) ? items : items ? [items] : []).map((item) => typeof item === 'string' ? item : item.message ?? item.description ?? '').filter(Boolean);
}

function partsCount(data) {
  const meta = data.meta ?? {};
  for (const candidate of [meta.partsCount, meta.partCount, meta.solidCount, data.validation?.partsCount]) if (Number.isFinite(candidate)) return candidate;
  if (Array.isArray(data.validation?.solids) && data.validation.solids.length) {
    return (data.validation.combinedBodySolids ?? 1) + data.validation.solids.filter(part => part.material !== 'transparent' && part.name !== 'Scocca').reduce((sum, part) => sum + (Number.isFinite(part.solids) ? part.solids : 1), 0);
  }
  const parts = resultPlates(data).flatMap((plate) => Array.isArray(plate.parts) ? plate.parts : []);
  return parts.length || null;
}

function updatePlateSelector() {
  const plates = resultPlates(); $('plate-select').replaceChildren();
  plates.forEach((plate, i) => {
    const option = document.createElement('option'); option.value = String(i);
    option.textContent = `Piatto ${i + 1}${plate.steps?.transparent || plate.transparent?.positions?.length ? ' · 2 materiali' : ' · opaco'}`;
    $('plate-select').append(option);
  });
  state.plate = Math.min(state.plate, Math.max(0, plates.length - 1)); $('plate-select').value = String(state.plate);
}

function updateMeasurements() {
  if (!state.result || state.previewError) return;
  const params = state.result.meta?.params ?? state.generatedParams;
  const millimetres = value => Number(value).toLocaleString(getLocale(), {minimumFractionDigits: 1, maximumFractionDigits: 1});
  $('metric-size').replaceChildren(document.createTextNode(`${millimetres(params.width)} × ${millimetres(params.height)} × ${millimetres(params.depth)} `));
  const unit = document.createElement('small'); unit.textContent = 'mm'; $('metric-size').append(unit);
}

function receiveResult(data) {
  const currentCable = readParams().cableExit || 'bottom';
  cleanLampData(data, currentCable);
  state.busy = false; state.result = data; state.previewError = null; state.demoActive = false;
  state.dirty = JSON.stringify(validateParams(readParams()).params) !== state.generatedSignature;
  stopLoadingProgress(true);
  updatePlateSelector(); displayModel();
  const errors = messagesOf(data.validation?.errors);
  const freeTest=SERVER_MODE && state.payment.config?.freeTestDownloads===true;
  const list = $('warnings-list'); list.replaceChildren();
  list.hidden = true;
  updateMeasurements();
  $('metric-parts').textContent = partsCount(data) ?? '—';
  const plates = resultPlates();
  const plateCount = SERVER_MODE ? data.meta?.plateCount ?? 1 : plates.length;
  $('export-note').textContent = plateCount > 1
    ? `${plateCount} piatti: importa insieme opaco e trasparente del primo. I pannelli degli altri piatti si stampano separatamente.`
    : 'Importa insieme nello slicer i file opaco e trasparente, mantenendo le posizioni originali.';
  if (state.dirty) {
    setBadge('Modifiche da generare', 'stale');
    setStatus('Anteprima da aggiornare', 'MODIFICATA', 'Le impostazioni sono cambiate durante il calcolo. Genera nuovamente per applicarle.', 'stale');
  } else if (!resultIsValid()) {
    setBadge('Controllo non superato', 'error');
    setStatus('Geometria da correggere', 'DA RIVEDERE', errors[0] ?? 'I file non sono disponibili: uno dei controlli geometrici non è stato superato.', 'error');
  } else {
    setBadge('Modello aggiornato', 'valid');
    setStatus(SERVER_MODE ? 'Anteprima generata' : 'Modello generato', 'COMPLETATO',
      freeTest ? 'File pronti. Scarica gratuitamente il pacchetto STEP e verifica il risultato con una stampa reale.'
        : SERVER_MODE ? 'Anteprima pronta. Controlla la configurazione prima di acquistare i file STEP.'
        : 'File pronti. Verifica incastri e proiezione con una stampa reale.', 'valid');
  }
  updateButtons();
}

function generationError(error) {
  state.busy = false; state.dirty = true;
  stopLoadingProgress(false);
  const text = typeof error === 'string' ? error : error?.message ?? 'Non è stato possibile completare la geometria.';
  setBadge('Generazione interrotta', 'error');
  setStatus('Impossibile generare il modello', 'DA RIVEDERE', text, 'error');
  state.previewError = text;
  if (modelGroup && !state.demoActive) clearModel();
  $('viewer-empty').hidden = state.demoActive;
  $('viewer-empty').querySelector('h3').textContent = 'Questa configurazione non è stata generata.';
  $('viewer-empty').querySelector('p').textContent = text;
  $('metric-size').textContent = '—';
  $('metric-parts').textContent = '—';
  $('export-note').textContent = 'I file saranno disponibili quando questa configurazione sarà generata correttamente.';
  updateButtons();
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

function filePrefix() {
  return (state.generatedParams?.centerText ?? 'lampada').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9_-]+/gi, '_').replace(/^_|_$/g, '').toLowerCase() || 'lampada';
}

let quickStartGuidePromise = null;
async function loadQuickStartGuide() {
  if (!quickStartGuidePromise) quickStartGuidePromise = (async () => {
    const response = await fetch(new URL(`./assets/${QUICK_START_GUIDE_FILENAME}`, import.meta.url), { credentials: 'same-origin', cache: 'no-cache' });
    if (!response.ok) throw new Error('Guide response unavailable');
    const bytes = new Uint8Array(await response.arrayBuffer());
    const signature = [137, 80, 78, 71, 13, 10, 26, 10];
    if (bytes.length <= signature.length || !signature.every((byte, index) => bytes[index] === byte)) throw new Error('Invalid guide image');
    return bytes;
  })().catch(() => {
    quickStartGuidePromise = null;
    const error = new Error('La guida di montaggio non è disponibile. Riprova il download tra poco.');
    error.code = 'QUICK_START_GUIDE_UNAVAILABLE';
    throw error;
  });
  return quickStartGuidePromise;
}

function downloadSingleStl(mesh, filename) {
  if (!mesh || !mesh.positions?.length) {
    notify('Geometria non disponibile per questo elemento.');
    return;
  }
  try {
    const buf = meshToBinarySTL(mesh, filename);
    const blob = new Blob([buf], { type: 'model/stl' });
    downloadBlob(blob, filename);
    notify(`Scaricato: ${filename}`);
  } catch (err) {
    console.error(err);
    notify('Errore creazione STL: ' + err.message);
  }
}

async function downloadAll() {
  if (!resultIsValid() || state.busy) return;
  const downloadBtn = $('download-all');
  downloadBtn.disabled = true;
  notify('Generazione archivio STL (Bambu/Orca/Prusa) in corso...');
  try {
    let guideBytes = null;
    try { guideBytes = await loadQuickStartGuide(); } catch (e) { /* Optional */ }
    const zip = await createStlPackage(window.JSZip, state.result, guideBytes);
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    const prefix = filePrefix();
    downloadBlob(blob, `${prefix}_lamp_studio_STL.zip`);
    notify('Pacchetto STL scaricato con successo!');
  } catch (error) {
    console.error('Download STL ZIP:', error);
    notify('Download ZIP non riuscito: ' + error.message);
  } finally {
    downloadBtn.disabled = false;
    updateButtons();
  }
}

async function purchaseOrDownload() {
  return downloadAll();
}

async function downloadReceipt() {
  if (!SERVER_MODE || !state.payment.paid || state.payment.busy) return;
  state.payment.busy = true; updateButtons();
  try {
    const receipt = await currentPaidLinks();
    if (!receipt.receiptUrl) throw new Error('La ricevuta non è disponibile. Riprova tra poco.');
    const response = await fetch(sameOriginDownload(receipt.receiptUrl, location.origin), { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error('Non è stato possibile scaricare la ricevuta. Riprova.');
    downloadBlob(await response.blob(), `${filePrefix()}_ricevuta.txt`);
  } catch (error) { notify(error.message); }
  finally { state.payment.busy = false; updateButtons(); }
}

async function downloadOriginal() {
  if (!SERVER_MODE || !state.purchase || state.payment.busy) return;
  state.payment.busy = true; updateButtons();
  try {
    await refreshPurchase();
    const response = await fetch(sameOriginDownload(state.purchase.originalDownloadUrl, location.origin), { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok || !response.headers.get('content-type')?.includes('zip')) throw new Error('Non è stato possibile scaricare l’originale. Riprova tra poco.');
    downloadBlob(await response.blob(), 'lamp_studio_originale.zip');
  } catch (error) { notify(error.message); }
  finally { state.payment.busy = false; updateButtons(); }
}

function showRevisionConfirmation() {
  if (!SERVER_MODE || !resultIsValid() || state.payment.paid || state.payment.busy || Number(state.purchase?.remainingRevisions ?? 0) < 1) return;
  if ($('revision-summary')) $('revision-summary').textContent = `Versione corretta: ${configurationSummary()}. Nessun nuovo pagamento.`;
  $('revision-confirmation')?.showModal();
}

async function confirmRevision() {
  $('revision-confirmation')?.close();
  if (!SERVER_MODE || !resultIsValid() || state.payment.paid || state.payment.busy || Number(state.purchase?.remainingRevisions ?? 0) < 1) return;
  state.payment.busy = true; state.payment.message = 'Conferma della correzione inclusa…'; updateButtons();
  try {
    const receipt = await purchaseApi(`/api/orders/${encodeURIComponent(state.purchase.orderId)}/revisions`, {
      method: 'POST', body: { previewId: state.payment.previewId, previewAccessToken: state.payment.accessToken },
    });
    if (receipt.status !== 'COMPLETED' || !receipt.downloadUrl || receipt.revisionPreviewId !== state.payment.previewId) throw new Error('La correzione non è stata confermata. Riprova tra poco.');
    state.payment.revisionOfOrderId = state.purchase.orderId;
    state.payment.orderId = null; state.payment.paid = true;
    state.payment.downloadUrl = sameOriginDownload(receipt.downloadUrl, location.origin);
    state.payment.receiptUrl = receipt.receiptUrl ? sameOriginDownload(receipt.receiptUrl, location.origin) : null;
    state.purchase.remainingRevisions = receipt.remainingRevisions;
    state.purchase.revisionPreviewId = receipt.revisionPreviewId;
    state.purchase.revisionDownloadUrl = receipt.downloadUrl; state.purchase.revisionReceiptUrl = receipt.receiptUrl;
    state.payment.message = 'Correzione inclusa confermata. Sono disponibili sia questi file sia l’originale.';
    savePurchase(); saveOriginalPurchase(); notify('La versione corretta è pronta da scaricare.');
  } catch (error) {
    state.payment.message = error.message; notify(error.message);
    try { await refreshPurchase(); } catch { /* A failed verification never spends a correction locally. */ }
  }
  finally { state.payment.busy = false; updateButtons(); }
}

const textInputLimits = new Map(TEXT_FIELDS.map(name => [name, installTextInputLimit($(name),
  name === 'leftText' || name === 'rightText' ? MAX_SIDE_GLYPHS : MAX_TEXT_GLYPHS, { onChange: markDirty })]));

$('config-form').addEventListener('submit', (event) => { event.preventDefault(); generate(); });
$('config-form').addEventListener('input', markDirty);
$('config-form').addEventListener('change', markDirty);
$('show-word-advice').addEventListener('click', showWordAdvice);
for (const name of ['close-word-advice', 'confirm-word-advice']) $(name).addEventListener('click', () => $('word-advice').close());
all('input[name="cableExit"]').forEach(radio => radio.addEventListener('change', () => {
  refreshCableCards();
  markDirty();
}));
all('[data-mode]').forEach((button) => button.addEventListener('click', () => { $('projectionMode').value = button.dataset.mode; markDirty(); }));
all('[data-shape]').forEach((button) => button.addEventListener('click', () => { state.shape = button.dataset.shape; markDirty(); }));
all('[data-direction]').forEach((button) => button.addEventListener('click', () => {
  const oldFlat = state.direction === 'left' ? 'rightText' : 'leftText';
  const newFlat = button.dataset.direction === 'left' ? 'rightText' : 'leftText';
  if (oldFlat !== newFlat && $(oldFlat).value && !$(newFlat).value) {
    $(newFlat).value = $(oldFlat).value; $(oldFlat).value = '';
    textInputLimits.get(oldFlat).sync(); textInputLimits.get(newFlat).sync();
  }
  state.direction = button.dataset.direction; markDirty();
}));
$('generate-button').addEventListener('click', generate);
$('reset-config').addEventListener('click', () => { writeParams(INITIAL); markDirty(); notify('Valori iniziali ripristinati.'); });
all('[data-view]').forEach((button) => button.addEventListener('click', () => switchView(button.dataset.view)));
all('[data-camera]').forEach((button) => button.addEventListener('click', () => setCameraView(button.dataset.camera)));
$('fit-view').addEventListener('click', fitView);
$('wall-hint-btn')?.addEventListener('click', () => setCameraView('iso'));
all('[data-wall-style]').forEach((button) => button.addEventListener('click', () => applyWallStyle(button.dataset.wallStyle)));
$('show-internals').addEventListener('click', toggleInternals);
$('toggle-light')?.addEventListener('click', toggleLampLight);
$('toggle-explode')?.addEventListener('click', toggleExplodedView);
$('explode-slider')?.addEventListener('input', onExplodeSliderInput);
all('#opaque-swatches .color-swatch-btn').forEach(btn => btn.addEventListener('click', () => setOpaqueColor(btn.dataset.color, btn.dataset.name)));
$('opaque-custom-color')?.addEventListener('input', (e) => setOpaqueColor(e.target.value, 'Personalizzato'));
all('#trans-swatches .color-swatch-btn').forEach(btn => btn.addEventListener('click', () => setTransColor(btn.dataset.trans, btn.dataset.name)));
all('.finish-btn').forEach(btn => btn.addEventListener('click', () => setOpaqueFinish(btn.dataset.finish)));
$('reset-colors')?.addEventListener('click', resetFilamentColors);
$('show-projections').addEventListener('change', () => { state.projections = $('show-projections').checked; displayModel(); });
$('plate-select').addEventListener('change', () => { state.plate = Number($('plate-select').value); displayModel(); updateButtons(); });
$('download-all').addEventListener('click', downloadAll);
$('digital-content-consent')?.addEventListener('change', () => updateButtons());
$('download-receipt')?.addEventListener('click', downloadReceipt);
$('download-original')?.addEventListener('click', downloadOriginal);
$('use-revision')?.addEventListener('click', showRevisionConfirmation);
$('confirm-revision')?.addEventListener('click', confirmRevision);
$('cancel-revision')?.addEventListener('click', () => $('revision-confirmation')?.close());

$('dl-opaque-stl')?.addEventListener('click', () => {
  downloadSingleStl(state.result?.assembled?.opaque, `${filePrefix()}_opaco_assemblato.stl`);
});
$('dl-trans-stl')?.addEventListener('click', () => {
  downloadSingleStl(state.result?.assembled?.transparent, `${filePrefix()}_trasparente_assemblato.stl`);
});
$('dl-plate-stl')?.addEventListener('click', async () => {
  if (!state.result) return;
  const plates = resultPlates();
  const plate = plates[state.plate] || plates[0];
  if (!plate) return;
  const zip = new window.JSZip();
  if (plate.opaque) zip.file(`piatto_${state.plate + 1}_opaco.stl`, meshToBinarySTL(plate.opaque));
  if (plate.transparent) zip.file(`piatto_${state.plate + 1}_trasparente.stl`, meshToBinarySTL(plate.transparent));
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, `${filePrefix()}_piatto_${state.plate + 1}_STL.zip`);
  notify(`Piatto ${state.plate + 1} scaricato.`);
});
window.addEventListener('lamp:languagechange', () => { refreshControls(); updateButtons(); updateMeasurements(); });
document.fonts.ready.then(() => refreshLocationIcons($('projectionMode').value));

function installMobileLivePreview() {
  if (typeof window.matchMedia !== 'function') return;
  const preview = $('live-word-preview-panel'), host = $('mobile-live-preview');
  if (!preview || !host) return;
  const originalParent = preview.parentElement, nextSibling = preview.nextSibling;
  const media = window.matchMedia('(max-width:730px)');
  const update = () => {
    if (media.matches) {
      if (preview.parentElement !== host) host.append(preview);
    } else if (preview.parentElement !== originalParent) {
      originalParent.insertBefore(preview, nextSibling?.parentNode === originalParent ? nextSibling : null);
    }
  };
  media.addEventListener('change', update);
  update();
}

let initial = INITIAL;
try { const saved = JSON.parse(localStorage.getItem(STORAGE_KEY)); if (saved && typeof saved === 'object') initial = { ...INITIAL, ...saved }; } catch { /* Use safe defaults. */ }
if (SERVER_MODE) {
  $('download-all').closest('.export-card').dataset.checkout = 'server';
}
writeParams(initial); renderInputErrors(validateParams(readParams()), hasWords());
installMobileLivePreview();
initializeViewer();
if (!hasWords()) showStartupDemo();
initializeWorker();
window.__DEBUG = { state, get scene() { return scene; }, get camera() { return camera; }, get modelGroup() { return modelGroup; }, get backdrop() { return backdrop; } };
