/** Shared, dependency-free dimensional rules. Dimensions are millimetres. */
export const FONT_FAMILY = 'Archivo Black';
export const FIXED_MARGIN = 8;
export const MAX_TEXT_GLYPHS = 4;
export const MAX_SIDE_GLYPHS = 2;
// Optical calibration measured on the mounted IKEA KAPPLAKE: 44 mm from the
// luminous point to the wall, with the fixed 50 mm housing resting on it.
// Socket, button and pin geometry remain at their original coordinates.
export const PIN_TIP_Z_MM = 9.379549429452;
export const LAMP_DEPTH_MM = 50;
export const LAMP_HEIGHT_MM = 95;
export const HOUSING_HEIGHT_POLICY_VERSION = 1;
export const SIGN_TRANSPARENT_BORDER_MM = 8;
export const SIGN_TRANSPARENT_SUPPORT_DEPTH_MM = 3;
export const SIGN_TRANSPARENT_BORDER_POLICY_VERSION = 1;
export const SIGN_TEXT_OPAQUE_CLEARANCE_MM = 8;
export const SIGN_TEXT_CLEARANCE_POLICY_VERSION = 1;
export const GUIDE_TRANSPARENT_ABOVE_FLOOR_MM = 2;
export const GUIDE_TRANSPARENT_INWARD_MM = 2;
export const GUIDE_TRANSPARENT_BASE_POLICY_VERSION = 2;
export const CABLE_RETENTION_POLICY_VERSION = 1;
export const CABLE_RETENTION_GAP_MM = 3.1;
export const CABLE_RETENTION_RADIUS_MM = 0.5;
export const CABLE_LETTER_CLEARANCE_POLICY_VERSION = 1;
export const CABLE_LETTER_CLEARANCE_MM = 2;
export const LED_TO_WALL_MM = 44;
export const LED_SOURCE_Z_MM = LAMP_DEPTH_MM - LED_TO_WALL_MM;
export const LED_OFFSET_FROM_PIN_TIP_MM = PIN_TIP_Z_MM - LED_SOURCE_Z_MM;
export const LED_PIN_RADIAL_RELIEF_MM = 0.20;
export const PANEL_GUIDE_CONNECTION_VERSION = 1;
export const SOCKET_CONNECTOR_RAMP_VERSION = 1;
export const BUTTON_COLOR_CLEARANCE_MM = 2;
export const BUTTON_PLACEMENT_POLICY_VERSION = 1;
export const SOCKET_BUTTON_FLUSH_VERSION = 1;
export const DEFAULT_PARAMS = Object.freeze({
  shape: 'rectangle', arrowDirection: 'right', projectionMode: 'top_bottom',
  centerText: 'MO', topText: 'TRI', bottomText: 'NE', leftText: '', rightText: '',
  width: 240, height: LAMP_HEIGHT_MM, housingHeightPolicyVersion: HOUSING_HEIGHT_POLICY_VERSION, depth: LAMP_DEPTH_MM, margin: FIXED_MARGIN,
  panelMode: 'sliding', ledHeight: LED_SOURCE_Z_MM, ledToWallMm: LED_TO_WALL_MM, ledPinRadialReliefMm: LED_PIN_RADIAL_RELIEF_MM, panelGuideConnectionVersion: PANEL_GUIDE_CONNECTION_VERSION, socketConnectorRampVersion: SOCKET_CONNECTOR_RAMP_VERSION, railClearance: 0.2,
  filletRadius: 10,
  pinMode: 'auto', pinAngle: 0, font: FONT_FAMILY,
  buttonColorClearanceMm: BUTTON_COLOR_CLEARANCE_MM, buttonPlacementPolicyVersion: BUTTON_PLACEMENT_POLICY_VERSION, socketButtonFlushVersion: SOCKET_BUTTON_FLUSH_VERSION,
  signTransparentBorderPolicyVersion: SIGN_TRANSPARENT_BORDER_POLICY_VERSION,
  signTextClearancePolicyVersion: SIGN_TEXT_CLEARANCE_POLICY_VERSION,
  guideTransparentBasePolicyVersion: GUIDE_TRANSPARENT_BASE_POLICY_VERSION,
  cableRetentionPolicyVersion: CABLE_RETENTION_POLICY_VERSION,
  cableLetterClearancePolicyVersion: CABLE_LETTER_CLEARANCE_POLICY_VERSION,
  cableExit: 'bottom', // 'bottom' = Option A (standard) | 'right' = Option B (scocca destra, pannelli integri)
});

export function normalizeText(value) {
  return String(value ?? '').normalize('NFC').toUpperCase().normalize('NFC')
    .replace(/\s+/gu, ' ').trim();
}

/** Spaces and punctuation do not count as letters; accented letters count once. */
export function countLetters(value) {
  return (normalizeText(value).match(/[\p{L}0-9]/gu) ?? []).length;
}

/** Every visible glyph occupies space; custom text is validated separately. */
export function countProjectionGlyphs(value) {
  return (normalizeText(value).match(/[^\s\p{M}]/gu) ?? []).length;
}

// Hashes in the startup illustration are decorative placeholders, never custom
// printable text. The server uses this same rule before invoking the CAD engine.
const supportedText = /^[\p{Script=Latin}\p{M}0-9 !?]*$/u;

/** Counter-clockwise outline, centred on its bounding box. Arrow tip is H/2 long. */
export function createOutline({ shape = 'rectangle', arrowDirection = 'right', width, height }) {
  const w = Number(width), h = Number(height);
  if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return [];
  if (shape !== 'arrow') return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const points = [[-w / 2, -h / 2], [w / 2 - h / 2, -h / 2], [w / 2, 0],
    [w / 2 - h / 2, h / 2], [-w / 2, h / 2]];
  return arrowDirection === 'left' ? points.map(([x, y]) => [-x, y]).reverse() : points;
}

export const makeOutline = createOutline;

const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

function convexHull(points) {
  const sorted = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique = sorted.filter((p, i) => !i || p[0] !== sorted[i - 1][0] || p[1] !== sorted[i - 1][1]);
  if (unique.length < 3) return unique;
  const lower = [], upper = [];
  for (const p of unique) {
    while (lower.length > 1 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop();
    lower.push(p);
  }
  for (const p of unique.slice().reverse()) {
    while (upper.length > 1 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop();
    upper.push(p);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function boundsAt(points, angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  let minXp, maxXp, minYp, maxYp;
  for (const p of points) {
    const x = p[0] * c - p[1] * s, y = p[0] * s + p[1] * c;
    if (x < minX) { minX = x; minXp = p; }
    if (x > maxX) { maxX = x; maxXp = p; }
    if (y < minY) { minY = y; minYp = p; }
    if (y > maxY) { maxY = y; maxYp = p; }
  }
  return { minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY,
    minXp, maxXp, minYp, maxYp };
}

/**
 * Minimum enclosing square over every in-plane rotation of the actual footprint.
 * The diagonal allowance is converted literally to a square inset:
 * usableSide = bedSize - diagonalAllowance / sqrt(2).
 * Include every protrusion in outline. Disconnected pieces need their own check
 * and the final arranged plate must be checked again as one combined footprint.
 */
export function findBedPlacement(outline, { bedSize = 256, diagonalAllowance = 10 } = {}) {
  if (!(Number.isFinite(bedSize) && bedSize > 0 && Number.isFinite(diagonalAllowance)
    && diagonalAllowance >= 0 && diagonalAllowance < bedSize * Math.SQRT2)) {
    throw new RangeError('Dimensioni del piatto o tolleranza diagonale non valide.');
  }
  const usableBedSize = bedSize - diagonalAllowance / Math.SQRT2;
  const inset = (bedSize - usableBedSize) / 2;
  const base = { bedSize, diagonalAllowance, usableBedSize, usableDiagonal: bedSize * Math.SQRT2 - diagonalAllowance, inset };
  if (!Array.isArray(outline) || outline.length < 3) {
    return { ...base, fits: false, valid: false, error: 'Contorno incompleto.' };
  }
  const points = outline.map(p => Array.isArray(p) ? [p[0], p[1]] : [p?.x, p?.y]);
  if (points.some(p => !p.every(Number.isFinite))) {
    return { ...base, fits: false, valid: false, error: 'Il contorno contiene coordinate non finite.' };
  }
  const hull = convexHull(points);
  if (hull.length < 3) return { ...base, fits: false, valid: false, error: 'Il contorno non ha superficie.' };

  // Support vertices only change when a hull edge becomes horizontal/vertical.
  // Between changes, each span is a*cos(theta)+b*sin(theta). Its positive
  // segment is concave, so minima of max(spanX,spanY) occur at an interval end
  // or where the two spans cross. This avoids missing narrow fits by sampling.
  const quarter = Math.PI / 2;
  const breaks = [0, quarter];
  for (let i = 0; i < hull.length; i++) {
    const p = hull[i], q = hull[(i + 1) % hull.length];
    let a = (-Math.atan2(q[1] - p[1], q[0] - p[0])) % quarter;
    if (a < 0) a += quarter;
    if (a > 1e-12 && a < quarter - 1e-12) breaks.push(a);
  }
  breaks.sort((a, b) => a - b);
  const uniqueBreaks = breaks.filter((a, i) => !i || a - breaks[i - 1] > 1e-11);
  const candidates = uniqueBreaks.slice();
  for (let i = 0; i < uniqueBreaks.length - 1; i++) {
    const lo = uniqueBreaks[i], hi = uniqueBreaks[i + 1];
    const b = boundsAt(hull, (lo + hi) / 2);
    const dx = [b.maxXp[0] - b.minXp[0], b.maxXp[1] - b.minXp[1]];
    const dy = [b.maxYp[0] - b.minYp[0], b.maxYp[1] - b.minYp[1]];
    const a = dx[0] - dy[1], c = -dx[1] - dy[0];
    if (Math.abs(a) + Math.abs(c) < 1e-12) continue;
    const root = Math.atan2(-a, c);
    for (let k = -1; k <= 1; k++) {
      const theta = root + k * Math.PI;
      if (theta > lo + 1e-12 && theta < hi - 1e-12) candidates.push(theta);
    }
  }
  let best;
  for (const angle of candidates) {
    const bounds = boundsAt(hull, angle);
    const span = Math.max(bounds.width, bounds.height);
    if (!best || span < best.span - 1e-9 || (Math.abs(span - best.span) <= 1e-9 && angle < best.angle)) {
      best = { angle, bounds, span };
    }
  }
  const { angle, bounds, span } = best;
  const translateX = bedSize / 2 - (bounds.minX + bounds.maxX) / 2;
  const translateY = bedSize / 2 - (bounds.minY + bounds.maxY) / 2;
  const c = Math.cos(angle), s = Math.sin(angle);
  return { ...base, valid: true, fits: span <= usableBedSize + 1e-7,
    angle: angle * 180 / Math.PI, angleDegrees: angle * 180 / Math.PI, angleRadians: angle,
    width: bounds.width, height: bounds.height, spanX: bounds.width, spanY: bounds.height,
    maxSpan: span, scaleToFit: usableBedSize / span,
    translation: [translateX, translateY], clearanceX: (bedSize - bounds.width) / 2,
    clearanceY: (bedSize - bounds.height) / 2,
    placedOutline: points.map(([x, y]) => [x * c - y * s + translateX, x * s + y * c + translateY]),
  };
}

/** Normalize input and enforce fixed design policies without scaling the hardware. */
export function validateParams(input = {}) {
  const errors = [], warnings = [];
  const error = (code, field, message) => errors.push({ code, field, message });
  const warn = (code, field, message) => warnings.push({ code, field, message });
  const params = { ...DEFAULT_PARAMS, ...input };
  params.height = LAMP_HEIGHT_MM;
  params.housingHeightPolicyVersion = HOUSING_HEIGHT_POLICY_VERSION;
  params.signTransparentBorderPolicyVersion = SIGN_TRANSPARENT_BORDER_POLICY_VERSION;
  params.signTextClearancePolicyVersion = SIGN_TEXT_CLEARANCE_POLICY_VERSION;
  params.guideTransparentBasePolicyVersion = GUIDE_TRANSPARENT_BASE_POLICY_VERSION;
  params.cableRetentionPolicyVersion = CABLE_RETENTION_POLICY_VERSION;
  params.cableLetterClearancePolicyVersion = CABLE_LETTER_CLEARANCE_POLICY_VERSION;
  params.ledPinRadialReliefMm = LED_PIN_RADIAL_RELIEF_MM;
  params.panelGuideConnectionVersion = PANEL_GUIDE_CONNECTION_VERSION;
  params.socketConnectorRampVersion = SOCKET_CONNECTOR_RAMP_VERSION;
  params.buttonColorClearanceMm = BUTTON_COLOR_CLEARANCE_MM;
  params.buttonPlacementPolicyVersion = BUTTON_PLACEMENT_POLICY_VERSION;
  params.socketButtonFlushVersion = SOCKET_BUTTON_FLUSH_VERSION;
  params.ledToWallMm = LED_TO_WALL_MM;
  params.ledHeight = LED_SOURCE_Z_MM;
  const modes = { flat_side: 'sides', top_bottom_and_flat_side: 'combined' };
  params.projectionMode = modes[params.projectionMode] ?? params.projectionMode;
  if (['sliding_removable', 'glued'].includes(params.panelMode)) params.panelMode = 'sliding';
  const enums = { shape: ['rectangle', 'arrow'], arrowDirection: ['left', 'right'],
    projectionMode: ['top_bottom', 'sides', 'combined'], panelMode: ['sliding'], pinMode: ['auto', 'manual'],
    cableExit: ['bottom', 'right'] };
  for (const [field, allowed] of Object.entries(enums)) {
    if (!allowed.includes(params[field])) {
      error('INVALID_OPTION', field, `Valore non riconosciuto per ${field}.`);
      params[field] = DEFAULT_PARAMS[field];
    }
  }
  for (const field of ['width', 'height', 'depth', 'ledHeight', 'railClearance', 'pinAngle', 'filletRadius']) {
    const raw = params[field];
    const number = typeof raw === 'string' && raw.trim() !== '' ? Number(raw.replace(',', '.')) : raw;
    if (typeof number !== 'number' || !Number.isFinite(number)) {
      error('INVALID_NUMBER', field, `Inserisci un numero valido per ${field}.`);
      params[field] = DEFAULT_PARAMS[field];
    } else params[field] = number;
  }
  if (input.margin !== undefined && Number(input.margin) !== FIXED_MARGIN) {
    error('FIXED_MARGIN', 'margin', 'La distanza dal bordo è fissata a 8 mm.');
  }
  params.margin = FIXED_MARGIN;
  if (![0, 5, 10].includes(params.filletRadius)) error('FILLET_RADIUS', 'filletRadius', 'Scegli raccordi da 0, 5 o 10 mm.');
  if ((input.font && input.font !== FONT_FAMILY) || (input.fontFamily && input.fontFamily !== FONT_FAMILY)) {
    error('FIXED_FONT', 'font', 'Il font previsto è Archivo Black.');
  }
  params.font = FONT_FAMILY;
  params.fontFamily = FONT_FAMILY;
  if (input.sideText !== undefined && input.leftText === undefined && input.rightText === undefined) {
    params[params.arrowDirection === 'right' ? 'leftText' : 'rightText'] = input.sideText;
  }
  for (const field of ['centerText', 'topText', 'bottomText', 'leftText', 'rightText']) {
    params[field] = normalizeText(params[field]);
  }
  if (countProjectionGlyphs(params.centerText) < 2) {
    error('CENTER_REQUIRED', 'centerText', 'Inserisci almeno due caratteri per la scritta centrale.');
  }
  for (const field of ['centerText', 'topText', 'bottomText', 'leftText', 'rightText']) {
    if (!supportedText.test(params[field])) {
      error('UNSUPPORTED_TEXT', field, 'Usa lettere latine, anche accentate, numeri, spazi, ! e ?. Gli altri simboli non sono disponibili.');
    }
    if (params[field].length > 200) error('TEXT_TOO_LONG', field, 'Il testo supera la lunghezza gestibile.');
  }
  if (countProjectionGlyphs(params.centerText) > MAX_TEXT_GLYPHS) {
    error(params.shape === 'arrow' ? 'ARROW_CENTER_LIMIT' : 'CENTER_TEXT_LIMIT', 'centerText',
      'La scritta centrale ammette al massimo 4 caratteri.');
  }
  if (params.projectionMode !== 'sides') {
    for (const field of ['topText', 'bottomText']) {
      if (countProjectionGlyphs(params[field]) > MAX_TEXT_GLYPHS) error('PANEL_TEXT_LIMIT', field, 'Ogni pannello ammette al massimo 4 caratteri.');
    }
  }
  if (params.shape === 'arrow' && params.projectionMode !== 'top_bottom') {
    const flatField = params.arrowDirection === 'right' ? 'leftText' : 'rightText';
    const pointedField = params.arrowDirection === 'right' ? 'rightText' : 'leftText';
    if (params[pointedField]) error('POINTED_SIDE_TEXT', pointedField, 'La punta della freccia non può avere una scritta proiettata.');
    if (countProjectionGlyphs(params[flatField]) > MAX_SIDE_GLYPHS) error('FLAT_SIDE_LIMIT', flatField, 'La parete piatta della freccia ammette al massimo 2 caratteri.');
  }
  if (params.shape === 'rectangle' && params.projectionMode !== 'top_bottom') for (const field of ['leftText', 'rightText']) {
    if (countProjectionGlyphs(params[field]) > MAX_SIDE_GLYPHS) error('PANEL_TEXT_LIMIT', field, 'Ogni pannello laterale ammette al massimo 2 caratteri.');
  }
  if (params.width < 70) error('WIDTH_TOO_SMALL', 'width', 'La larghezza deve essere almeno 70 mm per la sede LED.');
  if (params.height < 56) error('HEIGHT_TOO_SMALL', 'height', 'L’altezza deve essere almeno 56 mm per la sede LED.');
  if (params.depth < 25) error('DEPTH_TOO_SMALL', 'depth', 'La profondità deve essere almeno 25 mm per sede e pannelli.');
  else if (params.depth < 40 || params.depth > 65) warn('DEPTH_REVIEW', 'depth', 'La profondità richiede una verifica specifica della proiezione; il riferimento iniziale è 40–65 mm.');
  if (params.shape === 'rectangle' && Math.max(params.width, params.height) > 250) {
    error('RECTANGLE_LIMIT', 'width', 'Il lato lungo del rettangolo non può superare 250 mm.');
  }
  if (params.shape === 'arrow' && params.width < params.height / 2 + 52.4) {
    error('ARROW_SOCKET_SPACE', 'width', 'La freccia deve lasciare almeno 52,4 mm nella parte rettangolare per contenere la sede LED.');
  }
  if (!(params.ledHeight > 2 && params.ledHeight < params.depth - 2)) {
    error('LED_HEIGHT_OUTSIDE', 'ledHeight', 'Il centro luminoso deve trovarsi oltre il fondo da 2 mm e prima del bordo posteriore.');
  }
  if (!(params.railClearance >= 0.1 && params.railClearance <= 0.6)) {
    error('RAIL_CLEARANCE', 'railClearance', 'Il gioco delle guide deve essere compreso fra 0,1 e 0,6 mm; va calibrato con una stampa di prova.');
  }
  params.pinAngle = ((params.pinAngle % 360) + 360) % 360;
  const outline = createOutline(params);
  const bedPlacement = findBedPlacement(outline);
  if (!bedPlacement.fits) error('BED_FIT', 'width', 'Il contorno completo non entra nel piatto da 256 × 256 mm con la tolleranza diagonale di 10 mm.');
  return { params, errors, warnings, valid: errors.length === 0, outline, bedPlacement,
    letterCounts: Object.fromEntries(['centerText', 'topText', 'bottomText', 'leftText', 'rightText'].map(k => [k, countLetters(params[k])])) };
}
