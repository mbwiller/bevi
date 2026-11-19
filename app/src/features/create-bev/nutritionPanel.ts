/**
 * Reads a Nutrition Facts panel out of recognised text, on the device.
 *
 * The text comes from `textRecognition.ts` -- Apple's Vision framework, the
 * engine behind Live Text. Nothing here touches the network and nothing leaves
 * the phone.
 *
 * Written against the real output of eight label photos taken through this app
 * (`__tests__/visionFixtures.json`), not against an idea of what OCR looks
 * like. Four things those photos taught, each of which shapes the code below:
 *
 *   1. Vision keeps a nutrient and its amount on ONE line -- "Sodium 140mg",
 *      "Total Carbohydrate 1g". The hard "which number belongs to which label"
 *      problem mostly does not arise, so the nutrient rules are line-local.
 *   2. It misreads WORDS confidently. "Serving size" came back as "Selving
 *      size" and "Protein 0g" as "Protein Og", both at confidence 1.00. So
 *      confidence does not flag a character substitution, exact matching is
 *      the wrong tool, and every phrase here is matched by edit distance.
 *   3. It misreads UNITS. "Total Carbohydrate 0g" came back as "0mg". Those
 *      four nutrients are always grams on a US panel, so an implausible unit
 *      is an OCR error, not a measurement -- and quietly dividing by 1000
 *      would turn a misread "46g" into a believable, wrong "0.05g".
 *   4. Panels abbreviate: "Total Carb. <1g".
 *
 * The governing rule is that being wrong is worse than being blank. A value
 * the label does not clearly state stays null and shows as "Not listed"; a
 * basis that cannot be pinned down fails the whole reading rather than risk
 * pairing per-serving numbers with a per-container basis.
 */

export interface RecognisedLine {
  text: string;
  /** 0-1. Low means Vision knows it struggled; it does NOT catch a confident misread. */
  confidence: number;
  /** Normalised, origin bottom-left, as Vision reports them. */
  x: number;
  y: number;
}

export interface NutritionPanel {
  basis: string;
  calories: number | null;
  fatGrams: number | null;
  carbohydrateGrams: number | null;
  sugarGrams: number | null;
  proteinGrams: number | null;
  sodiumMg: number | null;
}

/** Below this Vision is telling us it could not read the region. */
const MIN_CONFIDENCE = 0.5;
/** Two lines are on the same row within this much of normalised height. */
const ROW_TOLERANCE = 0.012;
const MAX_AMOUNT = 1_000_000;
const MAX_BASIS = 220;

/**
 * Levenshtein over two short words. Two rolling rows rather than a matrix:
 * under `noUncheckedIndexedAccess` every cell of a matrix reads as
 * `number | undefined`, and a wall of non-null assertions would hide a real
 * out-of-range mistake among the noise.
 */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitute = (previous[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1);
      current.push(Math.min((current[j - 1] ?? 0) + 1, (previous[j] ?? 0) + 1, substitute));
    }
    previous = current;
  }
  return previous[b.length] ?? 0;
}

/** How many substitutions to forgive in a word: more for longer ones, none for tiny ones. */
const tolerance = (word: string): number => (word.length >= 7 ? 2 : word.length >= 4 ? 1 : 0);

const words = (text: string): string[] =>
  text.toLowerCase().replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);

/** Does `candidate` begin with `phrase`, allowing OCR's character slips? */
function startsWithPhrase(candidate: string[], phrase: string[]): boolean {
  if (candidate.length < phrase.length) return false;
  // The length guard above puts every `i` in range.
  return phrase.every((word, i) => distance(candidate[i] ?? '', word) <= tolerance(word));
}

/**
 * The amount after a nutrient's name. `O` is read as a zero only where a digit
 * belongs -- a real can gave us "Protein Og".
 */
function amountAfter(text: string, nameWords: number): { value: number; unit: string } | null {
  const match = /[A-Za-z]+|[^A-Za-z]+/g;
  // Walk past the name's words, then read what is left of the original string.
  let seen = 0;
  let index = 0;
  for (let m = match.exec(text); m; m = match.exec(text)) {
    if (/[A-Za-z]/.test(m[0])) {
      seen++;
      if (seen === nameWords) { index = m.index + m[0].length; break; }
    }
  }
  const rest = text.slice(index).replace(/^[\s.:-]+/, '').replace(/\bO(?=[0-9]*\s*(?:mg|mcg|g|kcal)\b)/gi, '0').trim();
  // "<1g" and "less than 1g" state a bound, not a value.
  if (/^(?:<|less than)/i.test(rest)) return null;
  const amount = /^([0-9]+(?:[.,][0-9]+)?)\s*(mg|mcg|g|kcal)?\b/i.exec(rest);
  if (!amount) return null;
  const value = Number((amount[1] ?? '').replace(',', '.'));
  if (!Number.isFinite(value) || value < 0 || value > MAX_AMOUNT) return null;
  return { value, unit: (amount[2] ?? '').toLowerCase() };
}

/** Grams, or nothing: see note 3 at the top. */
const asGrams = (value: number, unit: string): number | null => (unit === 'g' || unit === '' ? value : null);
/** Sodium is printed in mg; grams and micrograms convert, anything else refuses. */
const asMilligrams = (value: number, unit: string): number | null =>
  unit === 'mg' ? value : unit === 'g' ? value * 1000 : unit === 'mcg' ? value / 1000 : null;

interface Rule {
  key: keyof Omit<NutritionPanel, 'basis' | 'calories'>;
  /** Accepted spellings, longest first so "total carbohydrate" wins over "carbohydrate". */
  names: string[][];
  /** Lines that look like the nutrient but are a different row. */
  reject?: string[][];
  milligrams?: boolean;
}

const RULES: Rule[] = [
  {
    key: 'fatGrams',
    names: [['total', 'fat'], ['tot', 'fat'], ['fat']],
    // "Saturated Fat 1.5g" and "Trans Fat 0g" are not Total Fat.
    reject: [['saturated', 'fat'], ['sat', 'fat'], ['trans', 'fat']],
  },
  {
    key: 'carbohydrateGrams',
    // "Total Carb." is what a real can in the fixtures prints.
    names: [['total', 'carbohydrate'], ['total', 'carbohydrates'], ['total', 'carb'], ['total', 'carbs'], ['carbohydrate']],
  },
  {
    key: 'sugarGrams',
    names: [['total', 'sugars'], ['total', 'sugar'], ['sugars']],
    // "Includes 46g Added Sugars" is a subset of Total Sugars, not the figure.
    reject: [['includes'], ['added', 'sugars']],
  },
  { key: 'proteinGrams', names: [['protein']] },
  { key: 'sodiumMg', names: [['sodium']], milligrams: true },
];

/**
 * Calories. On a dual-column panel the row carries TWO numbers -- per serving
 * and per container -- and taking the wrong one doubles every figure while
 * looking entirely plausible. The per-serving column is always the left one.
 */
function caloriesFrom(lines: RecognisedLine[]): number | null {
  const label = lines.find((l) => startsWithPhrase(words(l.text), ['calories']));
  if (!label) return null;

  const inline = amountAfter(label.text, 1);
  if (inline) return inline.value;

  const sameRow = lines
    .filter((l) => l !== label && Math.abs(l.y - label.y) <= ROW_TOLERANCE && l.x > label.x)
    .filter((l) => !l.text.includes('%'))
    .map((l) => ({ x: l.x, amount: amountAfter(l.text, 0) }))
    .filter((c): c is { x: number; amount: { value: number; unit: string } } => c.amount !== null)
    .sort((a, b) => a.x - b.x);

  return sameRow[0]?.amount.value ?? null;
}

/** Whatever follows the "serving size" words on a line, the phrase removed. */
function afterServingPhrase(text: string): string {
  const pattern = /[A-Za-z]+/g;
  const found: { word: string; end: number }[] = [];
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    found.push({ word: m[0].toLowerCase(), end: m.index + m[0].length });
  }
  for (let i = 0; i + 1 < found.length; i++) {
    const name = found[i];
    const next = found[i + 1];
    if (!name || !next) continue;
    if (distance(name.word, 'serving') <= 2 && distance(next.word, 'size') <= 1) {
      return text.slice(next.end).replace(/^[\s:.-]+/, '').trim();
    }
  }
  return '';
}

const looksLikeServingSize = (text: string): boolean => {
  const w = words(text);
  return w.some((word, i) =>
    distance(word, 'serving') <= 2 && i + 1 < w.length && distance(w[i + 1] ?? '', 'size') <= 1);
};

/**
 * One of the contract's two exact `basis` strings, or null -- which fails the
 * whole reading. A snapshot whose basis is a guess is worse than no snapshot,
 * because every number in it is then attached to the wrong quantity.
 */
function basisFrom(lines: RecognisedLine[]): string | null {
  const row = lines.find((l) => looksLikeServingSize(l.text));
  if (row) {
    const inline = afterServingPhrase(row.text);
    const beside = lines
      .filter((l) => l !== row && Math.abs(l.y - row.y) <= ROW_TOLERANCE && l.x > row.x)
      .sort((a, b) => a.x - b.x)[0]?.text.trim();
    // A serving size states an amount, so the first candidate with a digit is
    // the real one; anything else is a leftover word.
    const size = [inline, beside].find((c) => c && /[0-9]/.test(c) && c.length <= MAX_BASIS);
    return size ? `Per serving (${size.trim()})` : null;
  }
  if (lines.some((l) => /per\s*100\s*(?:g|ml)/i.test(l.text))) {
    return 'Per 100 g / 100 ml (as listed)';
  }
  return null;
}

/**
 * null means "no panel worth standing behind": no basis, or not one amount it
 * could read. Never a half-read object.
 */
export function parseNutritionPanel(recognised: RecognisedLine[]): NutritionPanel | null {
  const lines = recognised
    .filter((l) => l.confidence >= MIN_CONFIDENCE)
    .map((l) => ({ ...l, text: l.text.replace(/\s+/g, ' ').trim() }))
    .filter((l) => l.text.length > 0);

  const basis = basisFrom(lines);
  if (!basis) return null;

  const panel: NutritionPanel = {
    basis,
    calories: caloriesFrom(lines),
    fatGrams: null, carbohydrateGrams: null, sugarGrams: null, proteinGrams: null, sodiumMg: null,
  };

  for (const line of lines) {
    const w = words(line.text);
    for (const rule of RULES) {
      if (panel[rule.key] !== null) continue;
      if (rule.reject?.some((phrase) => startsWithPhrase(w, phrase))) continue;
      const name = rule.names.find((phrase) => startsWithPhrase(w, phrase));
      if (!name) continue;
      const amount = amountAfter(line.text, name.length);
      if (!amount) continue;
      const value = rule.milligrams ? asMilligrams(amount.value, amount.unit) : asGrams(amount.value, amount.unit);
      if (value === null) continue;
      panel[rule.key] = Number(value.toFixed(2));
    }
  }

  const stated = [panel.calories, panel.fatGrams, panel.carbohydrateGrams, panel.sugarGrams, panel.proteinGrams, panel.sodiumMg];
  return stated.some((v) => v !== null) ? panel : null;
}
