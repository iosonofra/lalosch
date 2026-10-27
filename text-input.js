import { countProjectionGlyphs } from './rules.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
const graphemes = value => [...segmenter.segment(String(value ?? ''))].map(part => part.segment);

/** Fit only the newly inserted text; retain an existing selection's neighbours. */
export function fitTextReplacement(value, start, end, insertedText, maxGlyphs) {
  value = String(value ?? '');
  const from = Math.max(0, Math.min(value.length, Number(start) || 0));
  const to = Math.max(from, Math.min(value.length, Number(end) || 0));
  const prefix = value.slice(0, from), suffix = value.slice(to);
  // Restoring an older draft must not silently alter its words. While editing
  // one, allow deletions/replacements to reduce it, but never add more glyphs.
  const ceiling = Math.max(maxGlyphs, countProjectionGlyphs(value));
  let accepted = '';
  for (const part of graphemes(insertedText)) {
    if (countProjectionGlyphs(prefix + accepted + part + suffix) > ceiling) break;
    accepted += part;
  }
  return { value: prefix + accepted + suffix, caret: prefix.length + accepted.length,
    accepted, limited: accepted !== String(insertedText ?? '') };
}

/** Recover the insertion range when a browser omits a cancellable beforeinput. */
export function fitTextMutation(previousValue, value, maxGlyphs) {
  const previous = graphemes(previousValue), current = graphemes(value);
  let prefix = 0, suffix = 0;
  while (prefix < previous.length && prefix < current.length && previous[prefix] === current[prefix]) prefix++;
  while (suffix < previous.length - prefix && suffix < current.length - prefix
    && previous[previous.length - 1 - suffix] === current[current.length - 1 - suffix]) suffix++;
  const start = previous.slice(0, prefix).join('').length;
  const end = String(previousValue ?? '').length - previous.slice(previous.length - suffix).join('').length;
  return fitTextReplacement(previousValue, start, end, current.slice(prefix, current.length - suffix).join(''), maxGlyphs);
}

/** Enforce glyph limits for typing, paste, autofill and completed mobile IME edits. */
export function installTextInputLimit(input, maxGlyphs, { onChange = () => {} } = {}) {
  let previousValue = input.value, composing = false;
  const setValue = result => {
    if (input.value === result.value) return false;
    input.value = result.value;
    input.setSelectionRange(result.caret, result.caret);
    return true;
  };
  const sync = () => { previousValue = input.value; };
  input.addEventListener('focus', sync);
  input.addEventListener('beforeinput', event => {
    if (composing || event.isComposing || event.inputType === 'insertCompositionText') return;
    sync();
    if (!event.cancelable || !event.inputType?.startsWith('insert')) return;
    const inserted = event.data ?? event.dataTransfer?.getData('text/plain');
    if (inserted == null) return; // The input fallback also handles browser paste/autofill.
    const result = fitTextReplacement(input.value, input.selectionStart, input.selectionEnd, inserted, maxGlyphs);
    if (!result.limited) return;
    event.preventDefault();
    const changed = setValue(result);
    sync();
    if (changed) onChange();
  });
  input.addEventListener('input', event => {
    if (composing || event.isComposing) {
      event.stopPropagation();
      return;
    }
    setValue(fitTextMutation(previousValue, input.value, maxGlyphs));
    sync();
  });
  input.addEventListener('compositionstart', () => { sync(); composing = true; });
  input.addEventListener('compositionend', () => {
    composing = false;
    setValue(fitTextMutation(previousValue, input.value, maxGlyphs));
    sync();
    onChange();
  });
  return { sync };
}
