// Row Level Security of supabase/migrations, on real Postgres (PGlite, WebAssembly) with a stub of
// Supabase's auth schema. No Docker or network needed. Runs with Node's test runner (npm run test:db):
// Jest can't load PGlite's WebAssembly. The same checks against a real project: rls.remote.test.mts.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, it } from 'node:test';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const EX_A = 'eeeeeeee-0000-4000-8000-00000000000a';
const SESSION_A = '55555555-0000-4000-8000-00000000000a';
const T = '2026-09-29T18:00:00Z';

/** What Supabase provides: auth.users, auth.uid() from the JWT, and the anon/authenticated roles. */
const SUPABASE_STUB = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create role anon nologin;
  create role authenticated nologin;
  create function auth.uid() returns uuid language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  grant usage on schema public, auth to anon, authenticated;
  grant execute on function auth.uid() to anon, authenticated;
`;

let db: PGlite;

/** Runs `sql` as a signed-in user (role authenticated + JWT sub), or as the bare anon role. */
async function as<T = Record<string, unknown>>(user: string | 'anon', sql: string, params: unknown[] = []) {
  return db.transaction(async (tx) => {
    if (user === 'anon') {
      await tx.exec('set local role anon');
    } else {
      await tx.exec('set local role authenticated');
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [user]);
    }
    return tx.query<T>(sql, params);
  });
}

const insertExercise = (user: string, id: string, extra = '') =>
  as(
    user,
    `insert into public.exercise (id, canonical_name, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis,
       created_at, updated_at${extra ? ', user_id' : ''})
     values ($1, 'Press de hombro', '["hombro"]', 'compound', 8, 12, 2, 'per_dumbbell', $2, $2${extra ? ', $3' : ''})`,
    extra ? [id, T, extra] : [id, T],
  );

beforeEach(async () => {
  db = new PGlite();
  await db.exec(SUPABASE_STUB);
  for (const f of fs.readdirSync(MIGRATIONS).sort()) {
    await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));
  }
  await db.query('insert into auth.users (id) values ($1), ($2)', [A, B]);
  // User A has an exercise and a session.
  await insertExercise(A, EX_A);
  await as(A, `insert into public.session (id, muscle_groups, updated_at) values ($1, '["hombro"]', $2)`, [
    SESSION_A,
    T,
  ]);
  await as(
    A,
    `insert into public.entry (id, session_id, exercise_id, load_kg, reps, raw_text, created_at, updated_at)
     values ('eeeeeeee-0000-4000-8000-0000000000e0', $1, $2, 24, '[8,8,8,8]', 'press 24 4 de 8', $3, $3)`,
    [SESSION_A, EX_A, T],
  );
});

afterEach(async () => {
  await db.close();
});

describe('user_id', () => {
  it('is set by the server from the session; the client does not send it', async () => {
    const { rows } = await as<{ user_id: string }>(A, 'select user_id from public.exercise where id = $1', [EX_A]);
    assert.deepEqual(rows, [{ user_id: A }]);
  });

  it("cannot be forced to someone else's id", async () => {
    await assert.rejects(insertExercise(B, 'eeeeeeee-0000-4000-8000-00000000000b', A), /row-level security/);
  });

  it("an owner cannot hand a row to someone else", async () => {
    await assert.rejects(as(A, 'update public.exercise set user_id = $1 where id = $2', [B, EX_A]), /row-level security/);
  });
});

describe("another user's rows", () => {
  for (const table of ['exercise', 'session', 'entry']) {
    it(`${table}: invisible to others, visible to the owner`, async () => {
      assert.deepEqual((await as(B, `select * from public.${table}`)).rows, []);
      assert.equal((await as(A, `select * from public.${table}`)).rows.length, 1);
    });
  }

  it('cannot be updated (0 rows, nothing changes)', async () => {
    const res = await as(B, "update public.exercise set canonical_name = 'hacked' where id = $1", [EX_A]);
    assert.equal(res.affectedRows, 0);
    const { rows } = await as<{ canonical_name: string }>(A, 'select canonical_name from public.exercise');
    assert.deepEqual(rows, [{ canonical_name: 'Press de hombro' }]);
  });

  it('cannot be overwritten with an upsert on the same id', async () => {
    await assert.rejects(
      as(
        B,
        `insert into public.exercise (id, canonical_name, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis,
           created_at, updated_at)
         values ($1, 'hacked', '[]', 'compound', 8, 12, 2, 'total', $2, $2)
         on conflict (id) do update set canonical_name = excluded.canonical_name`,
        [EX_A, T],
      ),
      /row-level security/,
    );
    const { rows } = await as<{ canonical_name: string }>(A, 'select canonical_name from public.exercise');
    assert.deepEqual(rows, [{ canonical_name: 'Press de hombro' }]);
  });

  it("cannot be referenced from one's own entries", async () => {
    await assert.rejects(
      as(
        B,
        `insert into public.entry (id, session_id, raw_text, created_at, updated_at)
         values ('eeeeeeee-0000-4000-8000-0000000000e1', $1, 'x', $2, $2)`,
        [SESSION_A, T],
      ),
      /foreign key/,
    );
  });
});

describe('own rows', () => {
  it('can be upserted', async () => {
    await as(
      A,
      `insert into public.exercise (id, canonical_name, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis,
         created_at, updated_at)
       values ($1, 'Press de hombro con mancuernas', '["hombro"]', 'compound', 8, 12, 2, 'per_dumbbell', $2, $2)
       on conflict (id) do update set canonical_name = excluded.canonical_name, updated_at = excluded.updated_at`,
      [EX_A, T],
    );
    const { rows } = await as<{ canonical_name: string }>(A, 'select canonical_name from public.exercise');
    assert.deepEqual(rows, [{ canonical_name: 'Press de hombro con mancuernas' }]);
  });

  it('can reference own sessions and exercises', async () => {
    await as(
      A,
      `insert into public.entry (id, session_id, exercise_id, load_kg, reps, raw_text, created_at, updated_at)
       values ('eeeeeeee-0000-4000-8000-0000000000e2', $1, $2, 24, '[8,8,8,8]', 'press 24 4 de 8', $3, $3)`,
      [SESSION_A, EX_A, T],
    );
    const { rows } = await as(A, 'select id from public.entry');
    assert.equal(rows.length, 2);
  });

  it('cannot be hard-deleted by the client (soft delete is an update)', async () => {
    await assert.rejects(as(A, 'delete from public.exercise where id = $1', [EX_A]), /permission denied/);
  });
});

describe('without a session (anon role)', () => {
  for (const table of ['exercise', 'session', 'entry']) {
    it(`${table} is not readable`, async () => {
      await assert.rejects(as('anon', `select * from public.${table}`), /permission denied/);
    });
  }
});

describe('server_updated_at', () => {
  it('uses the server clock even if the client sends a value', async () => {
    await as(A, "update public.exercise set server_updated_at = '2000-01-01' where id = $1", [EX_A]);
    const { rows } = await as<{ server_updated_at: Date }>(A, 'select server_updated_at from public.exercise');
    assert.ok(rows[0].server_updated_at.getFullYear() > 2000);
  });

  it('moves forward on every update', async () => {
    const read = async () =>
      (await as<{ server_updated_at: Date }>(A, 'select server_updated_at from public.exercise')).rows[0]
        .server_updated_at;
    const before = await read();
    await as(A, "update public.exercise set canonical_name = 'x' where id = $1", [EX_A]);
    assert.ok((await read()).getTime() > before.getTime());
  });
});

describe('last write wins on the server', () => {
  const read = async () =>
    (
      await as<{ canonical_name: string; updated_at: Date; server_updated_at: Date }>(
        A,
        'select canonical_name, updated_at, server_updated_at from public.exercise',
      )
    ).rows[0];

  it('ignores a write older than the stored row, but still bumps server_updated_at', async () => {
    await as(A, "update public.exercise set canonical_name = 'newer', updated_at = '2026-09-29T20:00:00Z' where id = $1", [EX_A]);
    const before = await read();
    await as(A, "update public.exercise set canonical_name = 'stale', updated_at = '2026-09-29T19:00:00Z' where id = $1", [EX_A]);
    const after = await read();
    assert.equal(after.canonical_name, 'newer');
    assert.equal(after.updated_at.toISOString(), '2026-09-29T20:00:00.000Z');
    assert.ok(after.server_updated_at.getTime() > before.server_updated_at.getTime());
  });

  it('applies a newer write, and the same write sent twice', async () => {
    await as(A, "update public.exercise set canonical_name = 'newer', updated_at = '2026-09-29T20:00:00Z' where id = $1", [EX_A]);
    await as(A, "update public.exercise set canonical_name = 'again', updated_at = '2026-09-29T20:00:00Z' where id = $1", [EX_A]);
    assert.equal((await read()).canonical_name, 'again');
  });

  it('works through upsert, which is what sync sends', async () => {
    const upsert = (name: string, at: string) =>
      as(
        A,
        `insert into public.exercise (id, canonical_name, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis,
           created_at, updated_at)
         values ($1, $2, '[]', 'compound', 8, 12, 2, 'total', $3, $3)
         on conflict (id) do update set canonical_name = excluded.canonical_name, updated_at = excluded.updated_at`,
        [EX_A, name, at],
      );
    await upsert('newer', '2026-09-29T20:00:00Z');
    await upsert('stale', '2026-09-29T19:00:00Z');
    assert.equal((await read()).canonical_name, 'newer');
  });
});

describe('account deletion', () => {
  it('deleting the auth user removes all of their rows', async () => {
    await db.query('delete from auth.users where id = $1', [A]);
    for (const t of ['exercise', 'session', 'entry']) {
      const { rows } = await db.query(`select count(*)::int as n from public.${t}`);
      assert.deepEqual([t, rows], [t, [{ n: 0 }]]);
    }
  });
});
