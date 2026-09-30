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
