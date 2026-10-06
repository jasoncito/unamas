import type { Db } from '../db';
import { v1 } from './v1';
import { v2 } from './v2';
import { v3 } from './v3';
import { v4 } from './v4';
import { v5 } from './v5';
import { v6 } from './v6';
import { v7 } from './v7';

/**
 * Ordered by version. Append new ones; never edit one that has shipped.
 * (v1 was rewritten for sync on 29 sep 2026, before any install outside development.)
 */
const MIGRATIONS: readonly { version: number; sql: string }[] = [v1, v2, v3, v4, v5, v6, v7];

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
