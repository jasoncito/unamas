import seedJson from '../../dev/seed.json';

import { localDateOf } from '@/domain/dates';

import type { Db } from './db';
import { initDb } from './init';
import { getLastExposures, getPlanExerciseIds } from './repos/entries';
import { createSession, getOpenSession } from './repos/sessions';
import { loadSeed, type Seed } from './seed';
import { openMemoryDb } from './testing/memoryDb';

let db: Db;
let ids: Map<string, string>;
const seedIdOf = (uuid: string) => [...ids].find(([, u]) => u === uuid)![0];
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  ids = (await loadSeed(db, seedJson as Seed))!;
});

describe('getPlanExerciseIds', () => {
  it('hombro + tríceps: the 27 sep session, in logged order (design/meta.html)', async () => {
    expect((await getPlanExerciseIds(db, ['hombro', 'tríceps'])).map(seedIdOf)).toEqual([
      'press_hombro_mancuernas',
      'laterales_polea',
      'laterales_pecho_rodillas',
      'pushdown_barra_v',
      'triceps_mancuerna_cabeza',
    ]);
  });

  it('only exercises of the chosen groups: pecho on 17 sep leaves out that day’s biceps and back', async () => {
    expect((await getPlanExerciseIds(db, ['pecho'])).map(seedIdOf)).toEqual(['press_banca_barra', 'press_pecho_maquina']);
  });

  it('each group brings its own last session, in the order chosen, without repeats', async () => {
    expect((await getPlanExerciseIds(db, ['pierna', 'glúteo'])).map(seedIdOf)).toEqual([
      'sentadilla_smith',
      'zancadas_barra',
      'leg_extension',
    ]);
    const mixed = (await getPlanExerciseIds(db, ['pantorrilla', 'bíceps'])).map(seedIdOf);
    expect(mixed[0]).toBe('pantorrilla_pie_mancuerna'); // 24 sep
    expect(mixed.slice(1)).toEqual(['curl_barra_z', 'curl_inclinado_mancuernas', 'curl_martillo_polea', 'preacher_curl_z']); // 17 sep
  });

  it('a group with no history gives no list', async () => {
    expect(await getPlanExerciseIds(db, ['core'])).toEqual([]);
  });

  it('deleted entries do not count: the list falls back to the previous session', async () => {
    for (const e of ['s5e1', 's5e2', 's5e3', 's5e4', 's5e5']) {
      await db.runAsync("UPDATE entry SET deleted_at = '2026-09-30T00:00:00Z' WHERE id = ?", [ids.get(e)!]);
    }
    const list = (await getPlanExerciseIds(db, ['tríceps'])).map(seedIdOf);
    expect(list).toEqual(['triceps_polea_tras_cabeza', 'pushdown_barra_v']); // 16 sep
  });
});

describe('getLastExposures', () => {
  it('the latest logged set of each exercise', async () => {
    const last = await getLastExposures(db);
    const press = last.get(ids.get('press_hombro_mancuernas')!)!;
    expect([localDateOf(press.createdAt), press.loadKg, press.reps]).toEqual(['2026-09-27', 24, [8, 8, 8, 8]]);
  });

  it('skips sets without a load: curl martillo uses 17 sep (15 sep had no load)', async () => {
    const curl = (await getLastExposures(db)).get(ids.get('curl_martillo_polea')!)!;
    expect([localDateOf(curl.createdAt), curl.loadKg]).toEqual(['2026-09-17', 25]);
  });

  it('a newer set without a load does not hide the last one with a load', async () => {
    await db.runAsync(
      `INSERT INTO entry (id, session_id, exercise_id, load_kg, reps, raw_text, created_at, updated_at)
       VALUES ('f0000000-0000-4000-8000-00000000000a', ?, ?, NULL, '[9,9,9,9]', 'press de hombro 4 de 9', ?, ?)`,
      [ids.get('s5')!, ids.get('press_hombro_mancuernas')!, '2026-09-28T18:00:00.000Z', '2026-09-28T18:00:00.000Z'],
    );
    const press = (await getLastExposures(db)).get(ids.get('press_hombro_mancuernas')!)!;
    expect([localDateOf(press.createdAt), press.loadKg]).toEqual(['2026-09-27', 24]);
  });

  it('lumbar never had a load → no entry', async () => {
    expect((await getLastExposures(db)).has(ids.get('lumbar_maquina')!)).toBe(false);
  });
});

describe('createSession', () => {
  it('opens a session with the groups in order, dirty to sync', async () => {
    await createSession(db, 'f0000000-0000-4000-8000-000000000009', ['hombro', 'tríceps']);
    expect(await getOpenSession(db)).toMatchObject({ id: 'f0000000-0000-4000-8000-000000000009', muscleGroups: ['hombro', 'tríceps'], startedAt: null });
    const row = await db.getFirstAsync<{ dirty: number }>('SELECT dirty FROM session WHERE id = ?', ['f0000000-0000-4000-8000-000000000009']);
    expect(row!.dirty).toBe(1);
  });
});
