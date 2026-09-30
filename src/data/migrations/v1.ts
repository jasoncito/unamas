// Initial schema (CLAUDE.md §7, MULTIUSER.md §3). The phone's database belongs to a single user, so there
// is no user_id: the server sets it. Every data table carries the sync columns: updated_at (client clock),
// deleted_at (soft delete) and dirty (1 = not uploaded yet).
export const v1 = {
  version: 1,
  sql: `
CREATE TABLE exercise (
  id TEXT PRIMARY KEY,
  canonical_name TEXT NOT NULL,
  aliases TEXT NOT NULL DEFAULT '[]',
  muscle_groups TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('compound_heavy','compound','isolation','calf')),
  rep_floor INTEGER NOT NULL,
  rep_top INTEGER NOT NULL,
  step_kg REAL NOT NULL,
  load_basis TEXT NOT NULL CHECK (load_basis IN ('per_side','per_dumbbell','total','stack')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE session (
  id TEXT PRIMARY KEY,
  muscle_groups TEXT NOT NULL,
  started_at TEXT,
  ended_at TEXT,
  avg_bpm INTEGER,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE entry (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  exercise_id TEXT REFERENCES exercise(id),
  load_kg REAL,
  reps TEXT,
  raw_text TEXT NOT NULL,
  rir_note TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','pending','ambiguous')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE sync_state (
  table_name TEXT PRIMARY KEY,
  cursor TEXT
);
CREATE INDEX session_ended ON session(ended_at);
CREATE INDEX entry_exercise_created ON entry(exercise_id, created_at);
`,
};
