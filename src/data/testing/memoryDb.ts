import type { Db, SqlValue } from '../db';

/** In-memory SQLite (node:sqlite, Node ≥ 22) behind the same Db interface. Tests only. */
export function openMemoryDb(): Db {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { DatabaseSync } = require('node:sqlite');
  // node:sqlite turns foreign keys on by default; SQLite (and expo-sqlite) don't. Match the app.
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  const plain = <T>(row: unknown) => (row ? ({ ...(row as object) } as T) : null);

  return {
    async execAsync(sql: string) {
      db.exec(sql);
    },
    async runAsync(sql: string, params: SqlValue[]) {
      return db.prepare(sql).run(...params);
    },
    async getAllAsync<T>(sql: string, params: SqlValue[]) {
      return db.prepare(sql).all(...params).map((r: unknown) => plain<T>(r)!);
    },
    async getFirstAsync<T>(sql: string, params: SqlValue[]) {
      return plain<T>(db.prepare(sql).get(...params));
    },
    async withTransactionAsync(task: () => Promise<void>) {
      db.exec('BEGIN');
      try {
        await task();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}
