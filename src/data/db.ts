/** Values the repos bind to SQL parameters. */
export type SqlValue = string | number | null;

/**
 * The slice of expo-sqlite's SQLiteDatabase the data layer uses. Keeping it this small lets
 * tests run the same repos against an in-memory SQLite (see testing/memoryDb.ts).
 */
export interface Db {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: SqlValue[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: SqlValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}
