import type { ExerciseKind, LoadBasis } from '@/domain/types';
import { normalizeName } from '@/domain/names';

import type { Db } from './db';
import { nowIso } from './ids';

/** An exercise row as the server returns it (jsonb columns already parsed). */
export interface RemoteExercise {
  id: string;
  canonical_name: string;
  aliases: string[];
  muscle_groups: string[];
  kind: ExerciseKind;
  rep_floor: number;
  rep_top: number;
  step_kg: number;
  load_basis: LoadBasis;
  created_at: string;
  deleted_at: string | null;
}

/**
 * Plan B, step 4 (MULTIUSER.md §2): joins local exercises to the account's exercises with the exact
 * same normalized canonical_name. Matching local exercises are replaced by the server's (keeping both
 * alias lists) and their entries move to the server id. The rest stay as they are. Returns local → server id.
 */
export async function mergeRemoteExercises(db: Db, remote: readonly RemoteExercise[]): Promise<Map<string, string>> {
  // Oldest live server exercise per normalized name.
  const byName = new Map<string, RemoteExercise>();
  for (const r of [...remote].filter((r) => !r.deleted_at).sort((a, b) => a.created_at.localeCompare(b.created_at))) {
    const key = normalizeName(r.canonical_name);
    if (!byName.has(key)) byName.set(key, r);
  }

  const locals = await db.getAllAsync<{ id: string; canonical_name: string; aliases: string }>(
    'SELECT id, canonical_name, aliases FROM exercise WHERE deleted_at IS NULL',
    [],
  );
  const merged = new Map<string, string>();

  await db.withTransactionAsync(async () => {
    for (const local of locals) {
      const r = byName.get(normalizeName(local.canonical_name));
      if (!r || r.id === local.id) continue;
      const now = nowIso();
      const aliases = unique([
        ...r.aliases,
        ...JSON.parse(local.aliases),
        ...(local.canonical_name === r.canonical_name ? [] : [local.canonical_name]),
      ]);

      const existing = await db.getFirstAsync<{ aliases: string }>('SELECT aliases FROM exercise WHERE id = ?', [r.id]);
      if (existing) {
        // A second local duplicate of the same exercise: add its aliases to the row already merged.
        await db.runAsync('UPDATE exercise SET aliases = ?, updated_at = ? WHERE id = ?', [
          JSON.stringify(unique([...JSON.parse(existing.aliases), ...aliases])),
          now,
          r.id,
        ]);
      } else {
        await db.runAsync(
          `INSERT INTO exercise (id, canonical_name, aliases, muscle_groups, kind, rep_floor, rep_top, step_kg,
             load_basis, created_at, updated_at, dirty)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
          [
            r.id,
            r.canonical_name,
            JSON.stringify(aliases),
            JSON.stringify(r.muscle_groups),
            r.kind,
            r.rep_floor,
            r.rep_top,
            r.step_kg,
            r.load_basis,
            r.created_at,
            now,
          ],
        );
      }
      await db.runAsync('UPDATE entry SET exercise_id = ?, updated_at = ?, dirty = 1 WHERE exercise_id = ?', [
        r.id,
        now,
        local.id,
      ]);
      await db.runAsync('DELETE FROM exercise WHERE id = ?', [local.id]);
      merged.set(local.id, r.id);
    }
  });
  return merged;
}

/** Plan B, step 5: everything goes up again to the new account, which is pulled from scratch. */
export async function markEverythingForUpload(db: Db): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const table of ['exercise', 'session', 'entry']) {
      await db.runAsync(`UPDATE ${table} SET dirty = 1`, []);
    }
    await db.runAsync('DELETE FROM sync_state', []);
  });
}

function unique(xs: string[]): string[] {
  return [...new Set(xs)];
}
