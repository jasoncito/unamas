import type { Db } from './db';

// Sync between the phone's SQLite and Supabase (docs/MULTIUSER.md §4). Pure data logic: the server
// is behind RemoteStore, so tests run two phones against a fake one.

export type Table = 'exercise' | 'session' | 'entry';

/** A row as the server returns it: the local columns plus server_updated_at, exactly as Postgres wrote it. */
export type RemoteRow = Record<string, unknown> & { id: string; updated_at: string; server_updated_at: string };

/** Keyset position: rows strictly after (server_updated_at, id). */
export interface PullAfter {
  at: string;
  /** Empty on the first page: then every row with server_updated_at >= at. */
  id: string;
}

export interface RemoteStore {
  /** Upsert by id. user_id is never sent: the server sets it. Throws on any error. */
  upsert(table: Table, rows: Record<string, unknown>[]): Promise<void>;
  /** Up to `limit` rows after `after`, ordered by (server_updated_at, id). Throws on any error. */
  pull(table: Table, after: PullAfter, limit: number): Promise<RemoteRow[]>;
}

/**
 * How far back each pull re-reads before the cursor. server_updated_at comes from now(), which is the
 * start of the writing transaction, not its commit: a transaction that started earlier but committed
 * later leaves a row older than a cursor that already moved past it. Sync upserts take milliseconds,
 * so a minute covers them; re-applying a row is harmless. See MULTIUSER.md §4.
 */
export const CURSOR_MARGIN_MS = 60_000;
export const PULL_PAGE_SIZE = 500;
export const PUSH_BATCH_SIZE = 500;

interface TableSpec {
  columns: readonly string[];
  /** Stored as JSON text in SQLite, jsonb on the server. */
  json: readonly string[];
  /** Timestamps: normalized to ISO with Z when they come down. */
  times: readonly string[];
}

export const TABLES: Record<Table, TableSpec> = {
  exercise: {
    columns: [
      'id', 'canonical_name', 'aliases', 'muscle_groups', 'kind', 'rep_floor', 'rep_top', 'step_kg', 'load_basis',
      'created_at', 'updated_at', 'deleted_at',
    ],
    json: ['aliases', 'muscle_groups'],
    times: ['created_at', 'updated_at', 'deleted_at'],
  },
  session: {
    columns: ['id', 'muscle_groups', 'started_at', 'ended_at', 'avg_bpm', 'updated_at', 'deleted_at'],
    json: ['muscle_groups'],
    times: ['started_at', 'ended_at', 'updated_at', 'deleted_at'],
  },
  entry: {
    columns: [
      'id', 'session_id', 'exercise_id', 'load_kg', 'reps', 'raw_text', 'rir_note', 'status', 'created_at',
      'updated_at', 'deleted_at',
    ],
    json: ['reps'],
    times: ['created_at', 'updated_at', 'deleted_at'],
  },
};

/** Parents before children, for uploading and applying. Pulls read in the reverse order. */
const PARENTS_FIRST: readonly Table[] = ['exercise', 'session', 'entry'];

export interface SyncOptions {
  /** False while an account switch is pending (MULTIUSER.md §2): nothing is uploaded then. */
  canUpload?: () => Promise<boolean>;
  /** Rows per pull page (tests use small pages to exercise pagination against a real server). */
  pageSize?: number;
}

export interface SyncResult {
  pushed: number;
  pulled: number;
}

/** Uploads what's dirty, then downloads what changed. Throws if the server can't be reached. */
export async function sync(db: Db, remote: RemoteStore, opts: SyncOptions = {}): Promise<SyncResult> {
  const pushed = (await (opts.canUpload?.() ?? true)) ? await push(db, remote) : 0;
  const pulled = await pull(db, remote, opts.pageSize ?? PULL_PAGE_SIZE);
  return { pushed, pulled };
}

async function push(db: Db, remote: RemoteStore): Promise<number> {
  let pushed = 0;
  for (const table of PARENTS_FIRST) {
    const { columns, json } = TABLES[table];
    // Pending or ambiguous entries stay on the phone until they resolve.
    const onlyResolved = table === 'entry' ? " AND status = 'ok'" : '';
    const rows = await db.getAllAsync<Record<string, unknown>>(
      `SELECT ${columns.join(', ')} FROM ${table} WHERE dirty = 1${onlyResolved}`,
      [],
    );
    for (let i = 0; i < rows.length; i += PUSH_BATCH_SIZE) {
      const batch = rows.slice(i, i + PUSH_BATCH_SIZE);
      await remote.upsert(
        table,
        batch.map((row) => {
          const out = { ...row };
          for (const c of json) out[c] = out[c] == null ? null : JSON.parse(out[c] as string);
          return out;
        }),
      );
      // Clean only what didn't change while uploading; an edit made meanwhile goes up next time.
      await db.withTransactionAsync(async () => {
        for (const row of batch) {
          await db.runAsync(`UPDATE ${table} SET dirty = 0 WHERE id = ? AND updated_at = ?`, [
            row.id as string,
            row.updated_at as string,
          ]);
        }
      });
      pushed += batch.length;
    }
  }
  return pushed;
}

async function pull(db: Db, remote: RemoteStore, pageSize: number): Promise<number> {
  // Children first: an entry that was readable already had its session and exercise committed,
  // so reading the parents afterwards brings them too.
  const fetched = new Map<Table, RemoteRow[]>();
  const cursors = new Map<Table, string | null>();
  for (const table of [...PARENTS_FIRST].reverse()) {
    const cursor = await getCursor(db, table);
    cursors.set(table, cursor);
    const rows: RemoteRow[] = [];
    let after: PullAfter = { at: cursor ? withMargin(cursor) : EPOCH, id: '' };
    for (;;) {
      const page = await remote.pull(table, after, pageSize);
      rows.push(...page);
      if (page.length < pageSize) break;
      const last = page[page.length - 1];
      after = { at: last.server_updated_at, id: last.id };
    }
    fetched.set(table, rows);
  }

  let pulled = 0;
  await db.withTransactionAsync(async () => {
    for (const table of PARENTS_FIRST) {
      const rows = fetched.get(table)!;
      for (const row of rows) pulled += (await applyRemoteRow(db, table, row)) ? 1 : 0;
      const newest = rows.reduce<string | null>((max, r) => laterOf(max, r.server_updated_at), cursors.get(table)!);
      if (newest !== cursors.get(table)) {
        await db.runAsync(
          'INSERT INTO sync_state (table_name, cursor) VALUES (?, ?) ON CONFLICT (table_name) DO UPDATE SET cursor = excluded.cursor',
          [table, newest],
        );
      }
    }
  });
  return pulled;
}

/** Last-write-wins by updated_at; a dirty local row that is newer stays (it will upload). */
async function applyRemoteRow(db: Db, table: Table, row: RemoteRow): Promise<boolean> {
  const local = await db.getFirstAsync<{ dirty: number; updated_at: string }>(
    `SELECT dirty, updated_at FROM ${table} WHERE id = ?`,
    [row.id],
  );
  if (local && local.dirty === 1 && timeKey(local.updated_at) > timeKey(row.updated_at)) return false;

  const { columns, json, times } = TABLES[table];
  const values = columns.map((c) => {
    const v = row[c];
    if (v == null) return null;
    if (json.includes(c)) return JSON.stringify(v);
    if (times.includes(c)) return new Date(v as string).toISOString();
    return v as string | number;
  });
  await db.runAsync(
    `INSERT INTO ${table} (${columns.join(', ')}, dirty) VALUES (${columns.map(() => '?').join(', ')}, 0)
     ON CONFLICT (id) DO UPDATE SET ${columns
       .filter((c) => c !== 'id')
       .map((c) => `${c} = excluded.${c}`)
       .join(', ')}, dirty = 0`,
    values,
  );
  return true;
}

async function getCursor(db: Db, table: Table): Promise<string | null> {
  const row = await db.getFirstAsync<{ cursor: string | null }>('SELECT cursor FROM sync_state WHERE table_name = ?', [
    table,
  ]);
  return row?.cursor ?? null;
}

const EPOCH = '1970-01-01T00:00:00.000Z';

function withMargin(cursor: string): string {
  return new Date(Math.floor(timeKey(cursor) / 1000) - CURSOR_MARGIN_MS).toISOString();
}

function laterOf(a: string | null, b: string): string {
  return a === null || timeKey(b) > timeKey(a) ? b : a;
}

/**
 * Microseconds since the epoch. Postgres keeps microseconds and JS Dates only milliseconds, so
 * comparing Dates would treat 18:00:00.123456 and 18:00:00.123 as equal.
 */
export function timeKey(ts: string): number {
  const m = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(ts);
  if (!m) return Date.parse(ts) * 1000;
  const [, base, fraction = '', zone] = m;
  const micros = (fraction + '000000').slice(0, 6);
  return Date.parse(`${base}.${micros.slice(0, 3)}${zone || 'Z'}`) * 1000 + Number(micros.slice(3));
}

/** Rows that still have to go up (any status: pending entries count too). Sign-out refuses while > 0. */
export async function countUnsynced(db: Db): Promise<number> {
  const row = await db.getFirstAsync<{ n: number }>(
    `SELECT (SELECT count(*) FROM exercise WHERE dirty = 1)
          + (SELECT count(*) FROM session WHERE dirty = 1)
          + (SELECT count(*) FROM entry WHERE dirty = 1) AS n`,
    [],
  );
  return row!.n;
}

/** Empties the phone's data and sync cursors (sign-out, account deletion). */
export async function wipeLocalData(db: Db): Promise<void> {
  await db.withTransactionAsync(async () => {
    for (const table of ['entry', 'session', 'exercise', 'sync_state']) {
      await db.runAsync(`DELETE FROM ${table}`, []);
    }
  });
}
