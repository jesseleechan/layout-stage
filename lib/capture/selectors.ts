/* "Hide elements": CSS selectors that a capture hides with display:none !important (chat widgets,
   popups, sticky bars). Pure; shared by the dialog, the route and the capture server. Only a selector
   list gets through: nothing that could end the rule or the stylesheet ({ } ; @ < \ and control
   characters anywhere, / outside quotes), and brackets and quotes must balance. The dialog also asks
   the browser's own selector parser; the capture browser gives each selector its own rule, so one it
   doesn't understand can't take the others down with it. */

export const MAX_SELECTORS = 30;
export const MAX_SELECTOR_LENGTH = 200;
/** Most characters the field takes. */
export const MAX_SELECTORS_INPUT = 2000;

export const SELECTORS_HINT = 'CSS selectors, separated by commas or new lines.';

export type SelectorParse = { ok: true; selectors: string[] } | { ok: false; message: string };

/** Splits on new lines, and on commas outside (), [] and quotes (so `:is(.a, .b)` stays whole).
 *  Trims, drops empty entries and repeats. */
export function splitSelectors(input: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote = '';
  let depth = 0;
  const push = () => {
    const s = cur.trim();
    if (s && !out.includes(s)) out.push(s);
    cur = '';
  };
  for (const ch of input) {
    if (ch === '\n' || ch === '\r') {
      push();
      quote = '';
      depth = 0;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = '';
    } else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(' || ch === '[') depth++;
    else if (ch === ')' || ch === ']') depth--;
    else if (ch === ',' && depth <= 0) {
      push();
      depth = 0;
      continue;
    }
    cur += ch;
  }
  push();
  return out;
}

const FORBIDDEN = /[{};@<\\\u0000-\u001f\u007f]/;
/** Outside quoted strings: names (any letter or digit), # . - _ * and the selector punctuation. */
const PLAIN = /^[\p{L}\p{N}\p{M}_\-#.*[\]()=~|^$:>+,\s]$/u;

/** Whether one selector is made of selector syntax only (see the file comment). Not a full parser:
 *  the browser decides whether it actually matches anything. */
export function isSelectorShaped(sel: string): boolean {
  const s = sel.trim();
  if (!s || s.length > MAX_SELECTOR_LENGTH || FORBIDDEN.test(s)) return false;
  let quote = '';
  const stack: string[] = [];
  for (const ch of s) {
    if (quote) {
      if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") {
      if (stack[stack.length - 1] !== '[' && stack[stack.length - 1] !== '(') return false; // strings only in [attr="…"] or :fn("…")
      quote = ch;
    } else if (ch === '(' || ch === '[') stack.push(ch);
    else if (ch === ')' || ch === ']') {
      if (stack.pop() !== (ch === ')' ? '(' : '[')) return false;
    } else if (!PLAIN.test(ch)) return false;
  }
  return !quote && stack.length === 0;
}

const short = (s: string) => (s.length > 40 ? `${s.slice(0, 39)}…` : s);

/** Parses what was typed (or a stored list). Fails with a message for the dialog. */
export function parseSelectors(input: string | readonly string[]): SelectorParse {
  const raw = typeof input === 'string' ? input : input.join('\n');
  if (raw.length > MAX_SELECTORS_INPUT) return { ok: false, message: `Hide elements takes up to ${MAX_SELECTORS_INPUT.toLocaleString('en-US')} characters.` };
  const selectors = splitSelectors(raw);
  if (selectors.length > MAX_SELECTORS) return { ok: false, message: `Hide up to ${MAX_SELECTORS} selectors at a time.` };
  const bad = selectors.find((s) => !isSelectorShaped(s));
  if (bad != null) return { ok: false, message: `“${short(bad)}” isn’t a CSS selector. ${SELECTORS_HINT}` };
  return { ok: true, selectors };
}

/** Lenient: the usable selectors in anything (a stored or posted value), in order, within the caps. */
export function cleanSelectors(raw: unknown): string[] {
  const list = typeof raw === 'string' ? [raw] : Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : [];
  return splitSelectors(list.join('\n').slice(0, MAX_SELECTORS_INPUT))
    .filter(isSelectorShaped)
    .slice(0, MAX_SELECTORS);
}

/** The stylesheet that hides them: one rule per selector. */
export function selectorCss(selectors: readonly string[]): string {
  return selectors
    .filter(isSelectorShaped)
    .map((s) => `${s.trim()} { display: none !important; }`)
    .join('\n');
}

/** How a stored list shows in the field: one per line. */
export const selectorsText = (selectors: readonly string[] | undefined) => (selectors ?? []).join('\n');
