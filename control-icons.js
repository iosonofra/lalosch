// Front-view diagrams: projection labels follow the nearest straight edge,
// rather than the centre of the road sign including its pointed end.
import { LAMP_HEIGHT_MM, SIGN_TRANSPARENT_BORDER_MM, SIGN_TEXT_OPAQUE_CLEARANCE_MM } from './rules.js';

const MODES = ['top_bottom', 'sides', 'combined'];
const LABELS = {
  it: { top: 'SOPRA', bottom: 'SOTTO', left: 'S', right: 'D' },
  en: { top: 'ABOVE', bottom: 'BELOW', left: 'L', right: 'R' },
};
const FULL_LABELS = {
  it: { top: 'Scritta sopra', bottom: 'Scritta sotto', left: 'Scritta sul lato sinistro', right: 'Scritta sul lato destro' },
  en: { top: 'Word above', bottom: 'Word below', left: 'Word on the left', right: 'Word on the right' },
};

export function availableProjectionSides(shape, direction) {
  return shape === 'arrow' ? [direction === 'left' ? 'right' : 'left'] : ['left', 'right'];
}

export function projectionSides(mode, shape, direction) {
  const sides = availableProjectionSides(shape, direction);
  return mode === 'sides' ? sides : mode === 'combined' ? ['top', 'bottom', ...sides] : ['top', 'bottom'];
}

export function projectionModeLabel(mode, shape, direction, language = 'it') {
  const labels = FULL_LABELS[language === 'en' ? 'en' : 'it'];
  return projectionSides(mode, shape, direction).map(side => labels[side]).join(', ');
}

function number(value) { return Number(value.toFixed(3)); }

function signPoints(x, y, width, height, direction) {
  return [[.05, 0], [.75, 0], [1, .5], [.75, 1], [.05, 1], [0, .88], [0, .12]]
    .map(([px, py]) => [x + width * (direction === 'left' ? 1 - px : px), y + height * py]);
}

function pathData(points) {
  return points.map(([x, y], index) => `${index ? 'L' : 'M'}${number(x)} ${number(y)}`).join('') + 'Z';
}

function insetSign(points, distance) {
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);
  const lines = points.map((point, index) => {
    const next = points[(index + 1) % points.length];
    const dx = next[0] - point[0], dy = next[1] - point[1], length = Math.hypot(dx, dy);
    const sign = Math.sign(area);
    return { point: [point[0] - sign * dy / length * distance, point[1] + sign * dx / length * distance], dx, dy };
  });
  return lines.map((line, index) => {
    const previous = lines[(index + lines.length - 1) % lines.length];
    const determinant = previous.dx * line.dy - previous.dy * line.dx;
    const fraction = ((line.point[0] - previous.point[0]) * line.dy - (line.point[1] - previous.point[1]) * line.dx) / determinant;
    return [previous.point[0] + previous.dx * fraction, previous.point[1] + previous.dy * fraction];
  });
}

function sign(x, y, width, height, shape, direction) {
  if (shape !== 'arrow') return `<rect class="control-sign" x="${x}" y="${y}" width="${width}" height="${height}" rx="3"/>`;
  return `<path class="control-sign" d="${pathData(signPoints(x, y, width, height, direction))}"/>`;
}

function straightEdgeCentre(shape, direction, x, width) {
  return number(x + width * (shape !== 'arrow' ? .5 : direction === 'left' ? .6 : .4));
}

export function projectionModeIcon({ mode, shape, direction }) {
  const body = sign(24, 16, 34, 20, shape, direction);
  const centreX = straightEdgeCentre(shape, direction, 24, 34);
  const slots = projectionSides(MODES.includes(mode) ? mode : 'top_bottom', shape, direction).map(side => {
    const horizontal = side === 'top' || side === 'bottom';
    const count = horizontal ? 4 : 2;
    const rowWidth = count * 4 + (count - 1) * 2;
    const start = horizontal ? centreX - rowWidth / 2 : side === 'left' ? 22 - rowWidth : 60;
    const y = horizontal ? side === 'top' ? 9 : 38 : 23.5;
    return `<g data-location-side="${side}">${Array.from({ length: count }, (_, index) => `<rect class="projection-letter-slot" x="${number(start + index * 6)}" y="${y}" width="4" height="5" rx=".6"/>`).join('')}</g>`;
  }).join('');
  return `${body}${slots}`;
}

export function projectionFieldIcon({ side, shape, direction, language = 'it' }) {
  const body = sign(17, 16, 62, 30, shape, direction);
  const label = LABELS[language === 'en' ? 'en' : 'it'][side];
  if (!label) return body;
  const centreX = straightEdgeCentre(shape, direction, 17, 62);
  const position = side === 'top' ? `x="${centreX}" y="14" text-anchor="middle"`
    : side === 'bottom' ? `x="${centreX}" y="48" text-anchor="middle" dominant-baseline="hanging"`
      : side === 'left' ? 'x="15" y="31" text-anchor="end" dominant-baseline="central"'
        : 'x="81" y="31" text-anchor="start" dominant-baseline="central"';
  return `${body}<text class="projection-position-name" data-location-side="${side}" ${position}>${label}</text>`;
}

const WORD_KEYS = { center: 'centerText', top: 'topText', bottom: 'bottomText', left: 'leftText', right: 'rightText' };
const escapeText = text => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);

// A lightweight composition sketch. It only reads the form; no CAD generation,
// projection calculation or downloadable geometry is needed while typing.
export function liveLampIcon({ mode, shape, direction, words = {}, wordWidths = {} }) {
  const sides = projectionSides(mode, shape, direction);
  const textBySide = Object.fromEntries(['center', ...sides].map(side => [side,
    String(words[WORD_KEYS[side]] ?? '').trim().toUpperCase().slice(0, 64)]));
  const placeholders = !Object.values(textBySide).some(Boolean);
  if (placeholders) for (const side of Object.keys(textBySide)) textBySide[side] = side === 'left' || side === 'right' ? '##' : '####';
  const centreX = straightEdgeCentre(shape, direction, 84, 152);
  const straightWidth = shape === 'arrow' ? 106.4 : 152;
  const textSideInset = shape === 'arrow' ? (SIGN_TRANSPARENT_BORDER_MM + SIGN_TEXT_OPAQUE_CLEARANCE_MM) * 54 / LAMP_HEIGHT_MM : 6;
  const fontSize = Math.min(38, ...Object.entries(textBySide).filter(([, text]) => text).map(([side, text]) => {
    const widthAtOne = !placeholders && Number(wordWidths[side]) > 0 ? wordWidths[side] : [...text].length * .9;
    return (side === 'left' || side === 'right' ? 77 : straightWidth - 2 * textSideInset) / widthAtOne;
  }));
  const text = Object.entries(textBySide).filter(([, value]) => value).map(([side, value]) => {
    const position = side === 'center' ? `x="${centreX}" y="81" text-anchor="middle" dominant-baseline="central"`
      : side === 'top' ? `x="${centreX}" y="50" text-anchor="middle"`
        : side === 'bottom' ? `x="${centreX}" y="112" text-anchor="middle" dominant-baseline="hanging"`
          : side === 'left' ? 'x="80" y="81" text-anchor="end" dominant-baseline="central"'
            : 'x="240" y="81" text-anchor="start" dominant-baseline="central"';
    return `<text data-live-word="${side}" class="live-lamp-word ${side === 'center' ? 'live-central-word' : 'live-projected-word'}" ${position} font-size="${number(fontSize)}">${escapeText(value)}</text>`;
  }).join('');
  let rim = '';
  if (shape === 'arrow') {
    const outer = signPoints(84, 54, 152, 54, direction);
    const inner = insetSign(outer, SIGN_TRANSPARENT_BORDER_MM * 54 / LAMP_HEIGHT_MM);
    rim = `<path class="live-lamp-rim" data-transparent-border-mm="${SIGN_TRANSPARENT_BORDER_MM}" fill-rule="evenodd" d="${pathData(outer)}${pathData(inner)}"/>`;
  }
  return `<g data-placeholder="${placeholders}">${sign(84, 54, 152, 54, shape, direction)}${rim}${text}</g>`;
}
