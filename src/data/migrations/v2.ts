// "Fácil" / 3+ reps in reserve, as /parse returns it: lets the engine skip confirm mode (PROGRESSION.md §6).
export const v2 = {
  version: 2,
  sql: `ALTER TABLE entry ADD COLUMN easy INTEGER NOT NULL DEFAULT 0;`,
};
