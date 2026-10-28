// How people type a search: a few words, any order, any case, accents or
// not ("billing plan" finds "Billing migration plan"). Every word must
// appear somewhere in the fields; no fuzzy matching, so no surprises.
const fold = (text: string) => text.normalize("NFKD").replace(/\p{Mn}/gu, "").toLowerCase();

export function words(query: string): string[] {
  return fold(query).split(/\s+/).filter(Boolean);
}

export function matchesAll(terms: string[], fields: (string | null | undefined)[]): boolean {
  if (!terms.length) return true;
  const haystack = fold(fields.filter(Boolean).join(" \u0000 "));
  return terms.every((term) => haystack.includes(term));
}
