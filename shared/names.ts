/**
 * Key used to decide that two exercise names are the same exercise: lowercase, no diacritics
 * (so ñ → n), whitespace collapsed and trimmed. Exact match only; never fuzzy (MULTIUSER.md §2).
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Learned aliases ────────────────────────────────────────────────────────────────────────────

const NUMBER = '#';

/** Load, reps and effort phrases: not part of an exercise's name. Matched on normalized text. */
const NON_NAME_PHRASES = [
  'a cada lado', 'por lado', 'cada lado', 'por mancuerna', 'cada mancuerna', 'cada una', 'cada uno',
  'cada brazo', 'cada pierna', 'cada hombro', 'me sobraron', 'me sobro', 'hasta el fallo', 'al fallo',
];
const NON_NAME_WORDS = new Set([
  // units and sets
  'kg', 'k', 'kilo', 'kilos', 'kilogramos', 'lb', 'lbs', 'libra', 'libras', 'serie', 'series', 'rep', 'reps',
  'repeticion', 'repeticiones', 'x', 'facil', 'dificil',
  // numbers as words (dictation)
  'uno', 'una', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce',
  'trece', 'catorce', 'quince', 'dieciseis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veinticinco',
  'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa', 'cien', 'medio', 'media',
]);
/** Little words that only tie a number to the name ("con 25", "4 de 12"). */
const CONNECTORS = new Set(['con', 'de', 'y', 'a', 'en', 'por', 'la', 'el', 'las', 'los', 'un']);

/**
 * The exercise part of what someone said, to keep as an alias once they've told us which exercise they
 * meant: normalized, with loads, reps, units, per-side phrases and effort notes removed.
 * "jalones en la polea arriba para hombro posterior, con 25, 4 de 12" → "jalones en la polea arriba
 * para hombro posterior". Null when nothing name-like is left.
 */
export function phraseToAlias(phrase: string): string | null {
  let text = normalizeName(phrase).replace(/\d+/g, ` ${NUMBER} `); // "7,5" → "# , #": the comma goes below
  for (const p of NON_NAME_PHRASES) text = text.replace(new RegExp(`\\b${p}\\b`, 'g'), ` ${NUMBER} `);
  let tokens = text
    .replace(/[,.;:!?()"'¿¡]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((t) => (t.includes(NUMBER) || NON_NAME_WORDS.has(t) ? NUMBER : t));

  // Drop connectors that introduce a removed number ("con 25", "4 de 12"), until nothing changes.
  // A connector after a number stays: in "12 kilos en banco inclinado", "en banco" is part of the name.
  for (let changed = true; changed; ) {
    changed = false;
    tokens = tokens.filter((t, i) => {
      if (CONNECTORS.has(t) && tokens[i + 1] === NUMBER) {
        changed = true;
        return false;
      }
      return true;
    });
    tokens = tokens.filter((t, i) => t !== NUMBER || tokens[i - 1] !== NUMBER); // collapse runs
  }
  const words = tokens.filter((t) => t !== NUMBER);
  while (words.length && CONNECTORS.has(words[0])) words.shift();
  while (words.length && CONNECTORS.has(words.at(-1)!)) words.pop();

  const alias = words.join(' ');
  return /[a-zñ]{3}/.test(alias) ? alias : null;
}

// ─── Matching exercises by the words of a phrase ────────────────────────────────────────────────

/** Words that don't identify an exercise. */
const STOPWORDS = new Set(['con', 'de', 'del', 'en', 'la', 'el', 'las', 'los', 'y', 'a', 'al', 'por', 'para', 'un', 'una', 'mi', 'mis']);

/** Plural → singular, the same way on both sides: "laterales" → "lateral", "jalones" → "jalon", "poleas" → "polea". */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('es') && !/[aeiou]/.test(word[word.length - 3])) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s')) return word.slice(0, -1);
  return word;
}

/** The words of a phrase that identify an exercise: no numbers, no stopwords, singular, normalized. */
export function significantWords(phrase: string): string[] {
  const alias = phraseToAlias(phrase);
  if (!alias) return [];
  return [...new Set(alias.split(' ').filter((w) => !STOPWORDS.has(w)).map(singular))];
}

/** True if one of the names contains every one of the words (after the same normalization). */
export function nameHasAllWords(names: readonly string[], words: readonly string[]): boolean {
  if (words.length === 0) return false;
  return names.some((name) => {
    const own = new Set(normalizeName(name).split(/[\s,.;:()]+/).filter(Boolean).map(singular));
    return words.every((w) => own.has(w));
  });
}
