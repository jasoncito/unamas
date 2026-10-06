import seedJson from '../../dev/seed.json';

import { localDateOf } from '@/domain/dates';

import type { Db } from './db';
import { initDb } from './init';
import { getGroupPlans, getLastExposures } from './repos/entries';
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

/** Each group's exercises, as seed ids. */
const plansOf = async (groups: string[]) => (await getGroupPlans(db, groups)).map((p) => [p.group, p.exerciseIds.map(seedIdOf)]);

describe('getGroupPlans', () => {
  it('hombro + tríceps: the 27 sep session, each group its own exercises in logged order (design/meta.html)', async () => {
    expect(await plansOf(['shoulders', 'triceps'])).toEqual([
      ['shoulders', ['press_hombro_mancuernas', 'laterales_polea', 'laterales_pecho_rodillas']],
      ['triceps', ['pushdown_barra_v', 'triceps_mancuerna_cabeza']],
    ]);
    const [shoulders] = await getGroupPlans(db, ['shoulders']);
    expect([shoulders.lastSessionId, localDateOf(shoulders.lastAt!)]).toEqual([ids.get('s5'), '2026-09-27']);
  });

  it('only exercises of that group: pecho on 17 sep leaves out that day’s biceps and back', async () => {
    expect(await plansOf(['chest'])).toEqual([['chest', ['press_banca_barra', 'press_pecho_maquina']]]);
  });

  it('each group brings its own last session; an exercise already listed under an earlier group is not repeated', async () => {
    expect(await plansOf(['legs', 'glutes'])).toEqual([
      ['legs', ['sentadilla_smith', 'zancadas_barra', 'leg_extension']],
      ['glutes', []],
    ]);
    expect(await plansOf(['calves', 'biceps'])).toEqual([
      ['calves', ['pantorrilla_pie_mancuerna']], // 24 sep
      ['biceps', ['curl_barra_z', 'curl_inclinado_mancuernas', 'curl_martillo_polea', 'preacher_curl_z']], // 17 sep
    ]);
  });

  it('a group with no history: no session, no date, no exercises', async () => {
    expect(await getGroupPlans(db, ['core'])).toEqual([{ group: 'core', lastSessionId: null, lastAt: null, exerciseIds: [] }]);
  });

  it('deleted entries do not count: the list falls back to the previous session', async () => {
    for (const e of ['s5e1', 's5e2', 's5e3', 's5e4', 's5e5']) {
      await db.runAsync("UPDATE entry SET deleted_at = '2026-09-30T00:00:00Z' WHERE id = ?", [ids.get(e)!]);
    }
    expect(await plansOf(['triceps'])).toEqual([['triceps', ['triceps_polea_tras_cabeza', 'pushdown_barra_v']]]); // 16 sep
  });

  it('today’s session is left out: the list comes from the ones before it', async () => {
    const [shoulders] = await getGroupPlans(db, ['shoulders'], ids.get('s5')!);
    expect(localDateOf(shoulders.lastAt!)).toBe('2026-09-17');
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
  it('opens a session with the groups in order and its first entry time, dirty to sync', async () => {
    await createSession(db, 'f0000000-0000-4000-8000-000000000009', ['shoulders', 'triceps'], '2026-09-29T18:00:00.000Z');
    expect(await getOpenSession(db)).toMatchObject({ id: 'f0000000-0000-4000-8000-000000000009', muscleGroups: ['shoulders', 'triceps'], startedAt: '2026-09-29T18:00:00.000Z' });
    const row = await db.getFirstAsync<{ dirty: number }>('SELECT dirty FROM session WHERE id = ?', ['f0000000-0000-4000-8000-000000000009']);
    expect(row!.dirty).toBe(1);
  });
});
