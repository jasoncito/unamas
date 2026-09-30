import type { Db } from './db';
import { migrate } from './migrations';
import { loadSeed, type Seed } from './seed';

/** SQLiteProvider's onInit: connection pragmas, migrations and, in development, the seed for `userId`. */
export async function initDb(db: Db, seed: Seed | null, userId: string): Promise<void> {
  // WAL is persisted in the file; foreign_keys has to be turned on for every connection.
  await db.execAsync('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
  await migrate(db);
  if (seed) await loadSeed(db, seed, userId);
}
