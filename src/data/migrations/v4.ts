// The photo sent with an entry (a machine they can't name), as a file in the app's documents: kept so
// it can go again with a retry or with their answer to a doubt. Local only, like `ambiguity` (v3).
export const v4 = {
  version: 4,
  sql: `ALTER TABLE entry ADD COLUMN image_uri TEXT;`,
};
