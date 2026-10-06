import { openMemoryDb } from '../testing/memoryDb';
import { migrate } from './index';
import { v1 } from './v1';
import { v2 } from './v2';
import { v3 } from './v3';
import { v4 } from './v4';
import { v5 } from './v5';
import { v6 } from './v6';

/** A phone at v6 with one entry of each status it knew. */
async function phoneAtV6() {
  const db = openMemoryDb();
  for (const m of [v1, v2, v3, v4, v5, v6]) await db.execAsync(m.sql);
  await db.execAsync('PRAGMA user_version = 6');
  await db.runAsync(`INSERT INTO session (id, muscle_groups, started_at, updated_at, dirty) VALUES ('s', '["legs"]', '2026-09-29T18:00:00Z', '2026-09-29T18:00:00Z', 0)`, []);
  await db.runAsync(
    `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, rir_note, status, created_at, updated_at, deleted_at, dirty, easy, ambiguity, image_uri)
     VALUES ('a', 's', 'x', 30, '[10,10]', 'sentadilla 30 2 de 10', 'fácil', 'ok', '2026-09-29T18:01:00Z', '2026-09-29T18:02:00Z', NULL, 0, 1, NULL, NULL),
            ('b', 's', NULL, NULL, NULL, 'laterales con 10', NULL, 'ambiguous', '2026-09-29T18:03:00Z', '2026-09-29T18:03:00Z', NULL, 1, 0, '{"question":"¿Cuáles?","options":[]}', 'p.jpg')`,
    [],
  );
  return db;
}

describe('v7: drafts', () => {
  it('keeps every entry and column as it was', async () => {
    const db = await phoneAtV6();
    const before = await db.getAllAsync('SELECT * FROM entry ORDER BY id', []);
    await migrate(db);
    expect(await db.getAllAsync('SELECT * FROM entry ORDER BY id', [])).toEqual(before);
  });

  it('accepts status draft, and still refuses anything else', async () => {
    const db = await phoneAtV6();
    await migrate(db);
    const insert = (status: string) =>
      db.runAsync(`INSERT INTO entry (id, session_id, raw_text, status, created_at, updated_at) VALUES (?, 's', '', ?, 'x', 'x')`, [status, status]);
    await expect(insert('draft')).resolves.toBeDefined();
    await expect(insert('maybe')).rejects.toThrow(/CHECK/);
  });

  it('keeps the index the engine’s history uses', async () => {
    const db = await phoneAtV6();
    await migrate(db);
    const idx = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'entry'", []);
    expect(idx.map((i) => i.name)).toContain('entry_exercise_created');
  });
});
