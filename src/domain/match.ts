// Local suggestions while typing (screen 3): fuzzy search over names and aliases, no AI per keystroke.

export interface SearchCandidate {
  id: string;
  name: string;
  aliases: readonly string[];
  muscleGroups: readonly string[];
}

export interface SearchResult {
  id: string;
  /** Part of `name` that matched, as [start, end) in the original string; null if it matched an alias. */
  highlight: [number, number] | null;
}

/**
 * Up to `limit` exercises for what's typed so far: the chosen muscle groups first, then the best match
 * (start of the name > start of a word > anywhere > every word as a prefix, in order), names over aliases.
 */
export function searchExercises(
  query: string,
  candidates: readonly SearchCandidate[],
  preferredGroups: readonly string[],
  limit = 3,
): SearchResult[] {
  const q = normalizeWithMap(query).text;
  if (q.length < 2) return [];

  const scored = candidates.flatMap((c) => {
    const onName = matchScore(q, c.name);
    const scores = [onName ? onName.score + 5 : 0, ...c.aliases.map((a) => matchScore(q, a)?.score ?? 0)];
    const score = Math.max(...scores);
    if (score === 0) return [];
    const preferred = c.muscleGroups.some((g) => preferredGroups.includes(g));
    // Highlight the name whenever it matches, even if an alias matched better.
    return [{ c, preferred, score, highlight: onName?.range ?? null }];
  });

  scored.sort((a, b) => Number(b.preferred) - Number(a.preferred) || b.score - a.score || a.c.name.localeCompare(b.c.name));
  return scored.slice(0, limit).map(({ c, highlight }) => ({ id: c.id, highlight }));
}

function matchScore(q: string, candidate: string): { score: number; range: [number, number] | null } | null {
  const { text, map } = normalizeWithMap(candidate);
  const at = text.indexOf(q);
  if (at >= 0) {
    const range: [number, number] = [map[at], map[at + q.length - 1] + 1];
    if (at === 0) return { score: 100, range };
    return { score: text[at - 1] === ' ' ? 80 : 60, range };
  }
  // Every typed word is the start of a word of the candidate, in order: "pre hom" → "press de hombro".
  const words = text.split(' ');
  let from = 0;
  for (const w of q.split(' ')) {
    const k = words.findIndex((cw, i) => i >= from && cw.startsWith(w));
    if (k < 0) return null;
    from = k + 1;
  }
  return { score: 40, range: null };
}

/**
 * Lowercase, no accents, single spaces, trimmed; `map[i]` is the index in `s` of normalized char i,
 * so a match can be highlighted in the original text.
 */
export function normalizeWithMap(s: string): { text: string; map: number[] } {
  let text = '';
  const map: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (/\s/.test(ch)) {
      if (text.length > 0 && !text.endsWith(' ')) {
        text += ' ';
        map.push(i);
      }
      continue;
    }
    const plain = ch.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
    for (const p of plain) {
      text += p;
      map.push(i);
    }
  }
  if (text.endsWith(' ')) {
    text = text.slice(0, -1);
    map.pop();
  }
  return { text, map };
}
