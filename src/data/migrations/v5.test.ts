import { openMemoryDb } from '../testing/memoryDb';
import { migrate } from './index';
import { v1 } from './v1';
import { v2 } from './v2';
import { v3 } from './v3';
import { v4 } from './v4';

/** A phone still at v4, with the Spanish names it stored before the keys. */
async function phoneAtV4() {
  const db = openMemoryDb();
  for (const m of [v1, v2, v3, v4]) await db.execAsync(m.sql);
  await db.execAsync('PRAGMA user_version = 4');
  const ex = (id: string, groups: string[]) =>
    db.runAsync(
      `INSERT INTO exercise (id, canonical_name, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis, created_at, updated_at, dirty)
       VALUES (?, 'x', ?, 'compound', 8, 12, 2.5, 'total', '2026-09-15T00:00:00Z', '2026-09-15T00:00:00Z', 0)`,
      [id, JSON.stringify(groups)],
    );
  await ex('a', ['pierna', 'glúteo']);
  await ex('b', ['antebrazo']);
  await db.runAsync(
    `INSERT INTO session (id, muscle_groups, started_at, updated_at, dirty) VALUES ('s', '["tríceps","hombro"]', '2026-09-15T18:00:00Z', '2026-09-15T18:00:00Z', 0)`,
    [],
  );
  return db;
}

describe('v5: muscle groups as keys', () => {
  it('Spanish names become keys in the same order, and those rows go up again', async () => {
    const db = await phoneAtV4();
    await migrate(db);
    const rows = await db.getAllAsync<{ id: string; muscle_groups: string; dirty: number; updated_at: string }>(
      'SELECT id, muscle_groups, dirty, updated_at FROM exercise UNION ALL SELECT id, muscle_groups, dirty, updated_at FROM session ORDER BY id',
      [],
    );
    expect(rows.map((r) => [r.id, JSON.parse(r.muscle_groups), r.dirty])).toEqual([
      ['a', ['legs', 'glutes'], 1],
      ['b', ['antebrazo'], 0], // a custom group stays as typed, and the row isn't touched
      ['s', ['triceps', 'shoulders'], 1],
    ]);
    expect(rows[0].updated_at > '2026-09-15').toBe(true);
  });
});
