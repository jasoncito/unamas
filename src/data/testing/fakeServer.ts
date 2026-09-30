import { TABLES, type PullAfter, type RemoteRow, type RemoteStore, type Table } from '../sync';

/**
 * In-memory stand-in for Supabase with one user's rows, for sync tests. Mimics what matters: a
 * server-set server_updated_at with microseconds and "+00:00" like Postgres, timestamps reformatted
 * the same way, foreign keys, the last-write-wins guard, keyset pagination, and an offline switch.
 */
export class FakeServer {
  readonly rows: Record<Table, Map<string, RemoteRow>> = { exercise: new Map(), session: new Map(), entry: new Map() };
  offline = false;
  /** Called with each upsert batch before it is stored (to simulate edits made during an upload). */
  onUpsert: ((table: Table) => Promise<void>) | null = null;
  /** Called before each pull page is read (to simulate another phone writing between reads). */
  onPull: ((table: Table) => Promise<void>) | null = null;
  private clockMicros = Date.parse('2026-09-29T18:00:00Z') * 1000;

  /** Microseconds the clock advances per written row. Small values put many rows in the same millisecond. */
  constructor(private readonly tickMicros = 1_000_000) {}

  /** The server clock, as Postgres would print it. */
  now(): string {
    this.clockMicros += this.tickMicros;
    return pgTime(this.clockMicros);
  }

  /** A row whose transaction started at `serverUpdatedAt` but only commits now (MULTIUSER.md §4). */
  commitLate(table: Table, row: Record<string, unknown>, serverUpdatedAt: string): void {
    this.rows[table].set(row.id as string, { ...normalize(table, row), server_updated_at: serverUpdatedAt } as RemoteRow);
  }

  store(): RemoteStore {
    return {
      upsert: async (table, rows) => {
        this.failIfOffline();
        await this.onUpsert?.(table);
        for (const row of rows) {
          this.checkForeignKeys(table, row);
          // Same guard as the last_write_wins migration: an older write keeps the stored row.
          const stored = this.rows[table].get(row.id as string);
          const stale = stored && micros(row.updated_at as string) < micros(stored.updated_at);
          const kept = stale ? stored : normalize(table, row);
          this.rows[table].set(row.id as string, { ...kept, server_updated_at: this.now() } as RemoteRow);
        }
      },
      pull: async (table, after, limit) => {
        this.failIfOffline();
        await this.onPull?.(table);
        return [...this.rows[table].values()]
          .filter((r) => isAfter(r, after))
          .sort((a, b) => micros(a.server_updated_at) - micros(b.server_updated_at) || a.id.localeCompare(b.id))
          .slice(0, limit)
          .map((r) => structuredClone(r));
      },
    };
  }

  private failIfOffline() {
    if (this.offline) throw new TypeError('Network request failed');
  }

  private checkForeignKeys(table: Table, row: Record<string, unknown>) {
    if (table !== 'entry') return;
    if (!this.rows.session.has(row.session_id as string)) throw new Error('violates foreign key: session');
    if (row.exercise_id && !this.rows.exercise.has(row.exercise_id as string)) {
      throw new Error('violates foreign key: exercise');
    }
  }
}

function isAfter(r: RemoteRow, after: PullAfter): boolean {
  const [t, at] = [micros(r.server_updated_at), micros(after.at)];
  return after.id === '' ? t >= at : t > at || (t === at && r.id > after.id);
}

/** Timestamps come back from Postgres as "2026-09-29T18:00:00.123456+00:00". */
function normalize(table: Table, row: Record<string, unknown>): Record<string, unknown> {
  const out = structuredClone(row);
  for (const c of TABLES[table].times) {
    if (out[c] != null) out[c] = pgTime(micros(out[c] as string));
  }
  return out;
}

function pgTime(micros: number): string {
  const ms = Math.floor(micros / 1000);
  const extra = String(micros % 1000).padStart(3, '0');
  return new Date(ms).toISOString().replace('Z', `${extra}+00:00`);
}

/** Microseconds since the epoch, like Postgres compares them. Deliberately not sync.ts's timeKey. */
function micros(ts: string): number {
  const [, base, fraction = '', zone] = /^(.*T\d{2}:\d{2}:\d{2})(?:\.(\d+))?(.*)$/.exec(ts)!;
  const f = (fraction + '000000').slice(0, 6);
  return Date.parse(`${base}${zone || 'Z'}`) * 1000 + Number(f);
}
