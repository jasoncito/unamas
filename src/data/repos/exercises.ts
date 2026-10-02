import { normalizeName } from '@/domain/names';
import type { ExerciseConfig, ExerciseKind, LoadBasis } from '@/domain/types';

import type { Db } from '../db';
import { nowIso } from '../ids';

export interface Exercise extends ExerciseConfig {
  id: string;
  canonicalName: string;
  aliases: string[];
  muscleGroups: string[];
  loadBasis: LoadBasis;
  createdAt: string;
}

interface ExerciseRow {
  id: string;
  canonical_name: string;
  aliases: string;
  muscle_groups: string;
  kind: ExerciseKind;
  rep_floor: number;
  rep_top: number;
  step_kg: number;
  load_basis: LoadBasis;
  created_at: string;
}

function fromRow(r: ExerciseRow): Exercise {
  return {
    id: r.id,
    canonicalName: r.canonical_name,
    aliases: JSON.parse(r.aliases),
    muscleGroups: JSON.parse(r.muscle_groups),
    kind: r.kind,
    repFloor: r.rep_floor,
    repTop: r.rep_top,
    stepKg: r.step_kg,
    loadBasis: r.load_basis,
    createdAt: r.created_at,
  };
}

export async function getAllExercises(db: Db): Promise<Exercise[]> {
  const rows = await db.getAllAsync<ExerciseRow>(
    'SELECT * FROM exercise WHERE deleted_at IS NULL ORDER BY canonical_name',
    [],
  );
  return rows.map(fromRow);
}

export async function getExercise(db: Db, id: string): Promise<Exercise | null> {
  const row = await db.getFirstAsync<ExerciseRow>('SELECT * FROM exercise WHERE id = ? AND deleted_at IS NULL', [id]);
  return row && fromRow(row);
}

/** New exercise, marked dirty so sync uploads it. */
export async function insertExercise(db: Db, x: Exercise): Promise<void> {
  await db.runAsync(
    `INSERT INTO exercise (id, canonical_name, aliases, muscle_groups, kind, rep_floor, rep_top, step_kg,
       load_basis, created_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      x.id,
      x.canonicalName,
      JSON.stringify(x.aliases),
      JSON.stringify(x.muscleGroups),
      x.kind,
      x.repFloor,
      x.repTop,
      x.stepKg,
      x.loadBasis,
      x.createdAt,
      nowIso(),
    ],
  );
}

export type AddAliasResult = 'added' | 'already_known' | 'taken_by_other' | 'no_exercise';

/**
 * Adds an alias to an exercise (compared normalized), marked dirty so it syncs. Never adds one that
 * is already the name or an alias of another exercise: an alias must point to a single exercise.
 */
export async function addExerciseAlias(db: Db, exerciseId: string, alias: string): Promise<AddAliasResult> {
  const key = normalizeName(alias);
  const all = await getAllExercises(db);
  const target = all.find((e) => e.id === exerciseId);
  if (!target) return 'no_exercise';

  const names = (e: Exercise) => [e.canonicalName, ...e.aliases].map(normalizeName);
  if (names(target).includes(key)) return 'already_known';
  if (all.some((e) => e.id !== exerciseId && names(e).includes(key))) return 'taken_by_other';

  await db.runAsync('UPDATE exercise SET aliases = ?, updated_at = ?, dirty = 1 WHERE id = ?', [
    JSON.stringify([...target.aliases, key]),
    nowIso(),
    exerciseId,
  ]);
  return 'added';
}

/** Undo of a learned alias: takes it out again (compared normalized), marked dirty so it syncs. */
export async function removeExerciseAlias(db: Db, exerciseId: string, alias: string): Promise<void> {
  const target = await getExercise(db, exerciseId);
  if (!target) return;
  const key = normalizeName(alias);
  const kept = target.aliases.filter((a) => normalizeName(a) !== key);
  if (kept.length === target.aliases.length) return;
  await db.runAsync('UPDATE exercise SET aliases = ?, updated_at = ?, dirty = 1 WHERE id = ?', [JSON.stringify(kept), nowIso(), exerciseId]);
}

/**
 * Undo of the entry that created an exercise: the exercise goes too, unless something else uses it.
 * Soft delete (it may have synced). True if it went.
 */
export async function deleteExerciseIfUnused(db: Db, exerciseId: string): Promise<boolean> {
  const used = await db.getFirstAsync<{ n: number }>('SELECT count(*) AS n FROM entry WHERE exercise_id = ? AND deleted_at IS NULL', [exerciseId]);
  if (used && used.n > 0) return false;
  const now = nowIso();
  await db.runAsync('UPDATE exercise SET deleted_at = ?, updated_at = ?, dirty = 1 WHERE id = ? AND deleted_at IS NULL', [now, now, exerciseId]);
  return true;
}
