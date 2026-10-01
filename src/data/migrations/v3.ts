// The question and options of an entry in doubt, as /parse asked them: an old doubt is shown again
// without calling the AI. Local only: ambiguous entries never upload (sync sends status 'ok' only).
export const v3 = {
  version: 3,
  sql: `ALTER TABLE entry ADD COLUMN ambiguity TEXT;`,
};
