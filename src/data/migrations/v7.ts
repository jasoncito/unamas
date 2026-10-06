// Drafts (per-exercise flow, 6 oct 2026): "Empezar con X" saves the entry with the chosen load and no
// reps, status 'draft', until "Guardar". SQLite can't change a CHECK, so the table is rebuilt with the
// same columns. Drafts never sync: only status 'ok' uploads (sync.ts), and they stay dirty = 0 until saved.
export const v7 = {
  version: 7,
  sql: `
CREATE TABLE entry_v7 (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES session(id),
  exercise_id TEXT REFERENCES exercise(id),
  load_kg REAL,
  reps TEXT,
  raw_text TEXT NOT NULL,
  rir_note TEXT,
  status TEXT NOT NULL DEFAULT 'ok' CHECK (status IN ('ok','pending','ambiguous','draft')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  dirty INTEGER NOT NULL DEFAULT 1,
  easy INTEGER NOT NULL DEFAULT 0,
  ambiguity TEXT,
  image_uri TEXT
);
INSERT INTO entry_v7 (id, session_id, exercise_id, load_kg, reps, raw_text, rir_note, status, created_at, updated_at,
                      deleted_at, dirty, easy, ambiguity, image_uri)
  SELECT id, session_id, exercise_id, load_kg, reps, raw_text, rir_note, status, created_at, updated_at,
         deleted_at, dirty, easy, ambiguity, image_uri FROM entry;
DROP TABLE entry;
ALTER TABLE entry_v7 RENAME TO entry;
CREATE INDEX entry_exercise_created ON entry(exercise_id, created_at);
`,
};
