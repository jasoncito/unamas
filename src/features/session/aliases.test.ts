import seedJson from '../../../dev/seed.json';

import type { Db } from '@/data/db';
import { initDb } from '@/data/init';
import { addExerciseAlias, getExercise } from '@/data/repos/exercises';
import { loadSeed, type Seed } from '@/data/seed';
import { openMemoryDb } from '@/data/testing/memoryDb';

import { learnAliasFromChoice } from './aliases';

let db: Db;
let ids: Map<string, string>;
beforeEach(async () => {
  db = openMemoryDb();
  await initDb(db, null);
  ids = (await loadSeed(db, seedJson as Seed))!;
  await db.runAsync('UPDATE exercise SET dirty = 0', []);
});

const PHRASE = 'jalones en la polea arriba para hombro posterior, con 25, 4 de 12';

describe('learnAliasFromChoice', () => {
  it('the phrase without numbers becomes an alias of the chosen exercise', async () => {
    const facePull = ids.get('face_pull')!;
    await expect(learnAliasFromChoice(db, PHRASE, facePull)).resolves.toBe('added');
    const ex = (await getExercise(db, facePull))!;
    expect(ex.aliases).toContain('jalones en la polea arriba para hombro posterior');
  });

  it('marks the exercise dirty so the alias syncs to other phones', async () => {
    const facePull = ids.get('face_pull')!;
    await learnAliasFromChoice(db, PHRASE, facePull);
    const row = await db.getFirstAsync<{ dirty: number }>('SELECT dirty FROM exercise WHERE id = ?', [facePull]);
    expect(row!.dirty).toBe(1);
  });

  it('the same words again are not added twice', async () => {
    const facePull = ids.get('face_pull')!;
    await learnAliasFromChoice(db, PHRASE, facePull);
    await expect(learnAliasFromChoice(db, 'Jalones en la polea arriba para hombro posterior con 27,5 3 de 10', facePull)).resolves.toBe(
      'already_known',
    );
    expect((await getExercise(db, facePull))!.aliases.filter((a) => a.startsWith('jalones en la polea'))).toHaveLength(1);
  });

  it("words that already name the exercise aren't added (\"laterales en polea\" is an alias of it)", async () => {
    await expect(learnAliasFromChoice(db, 'laterales en polea con 10, 4 de 11', ids.get('laterales_polea')!)).resolves.toBe(
      'already_known',
    );
  });

  it('never gives one exercise an alias that already belongs to another', async () => {
    // "laterales de pie" is an alias of Elevaciones laterales de pie: it can't also point to the polea one.
    const res = await learnAliasFromChoice(db, 'laterales de pie con 10, 4 de 11', ids.get('laterales_polea')!);
    expect(res).toBe('taken_by_other');
    expect((await getExercise(db, ids.get('laterales_polea')!))!.aliases).not.toContain('laterales de pie');
  });

  it('the repo compares aliases normalized (case, accents, spaces)', async () => {
    await expect(addExerciseAlias(db, ids.get('laterales_polea')!, '  Laterales   DE Pie ')).resolves.toBe('taken_by_other');
    await expect(addExerciseAlias(db, ids.get('laterales_polea')!, 'LATERALES EN POLEA')).resolves.toBe('already_known');
  });

  it('a phrase that is only numbers teaches nothing', async () => {
    await expect(learnAliasFromChoice(db, '25, 4 de 12', ids.get('face_pull')!)).resolves.toBe('nothing_to_learn');
  });

  it('a deleted or unknown exercise is not touched', async () => {
    await db.runAsync("UPDATE exercise SET deleted_at = '2026-09-30T00:00:00Z' WHERE id = ?", [ids.get('face_pull')!]);
    await expect(learnAliasFromChoice(db, PHRASE, ids.get('face_pull')!)).resolves.toBe('no_exercise');
  });
});
