import type { Db } from '../db';
import { v1 } from './v1';

/** Ordered by version. Append new ones; never edit one that has shipped. */
const MIGRATIONS: readonly { version: number; sql: string }[] = [v1];

export const SCHEMA_VERSION = MIGRATIONS.at(-1)!.version;

/** Applies pending migrations, tracking the version in PRAGMA user_version. */
export async function migrate(db: Db): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await db.withTransactionAsync(async () => {
      await db.execAsync(m.sql);
      await db.execAsync(`PRAGMA user_version = ${m.version}`);
    });
  }
}
