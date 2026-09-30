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

export async function getAllExercises(db: Db, userId: string): Promise<Exercise[]> {
  const rows = await db.getAllAsync<ExerciseRow>(
    'SELECT * FROM exercise WHERE user_id = ? AND deleted_at IS NULL ORDER BY canonical_name',
    [userId],
  );
  return rows.map(fromRow);
}

export async function getExercise(db: Db, userId: string, id: string): Promise<Exercise | null> {
  const row = await db.getFirstAsync<ExerciseRow>(
    'SELECT * FROM exercise WHERE id = ? AND user_id = ? AND deleted_at IS NULL',
    [id, userId],
  );
  return row && fromRow(row);
}

/** New exercise for `userId`, marked dirty so sync uploads it. */
export async function insertExercise(db: Db, userId: string, x: Exercise): Promise<void> {
  await db.runAsync(
    `INSERT INTO exercise (id, user_id, canonical_name, aliases, muscle_groups, kind, rep_floor, rep_top, step_kg,
       load_basis, created_at, updated_at, dirty)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      x.id,
      userId,
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
