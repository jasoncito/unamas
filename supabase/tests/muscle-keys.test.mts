// The muscle-group-keys migration on real Postgres (PGlite): rows stored with the Spanish names get the
// keys, in order, with a newer updated_at; custom groups stay. Runs with npm run test:db.
import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { it } from 'node:test';

const MIGRATIONS = path.join(import.meta.dirname, '..', 'migrations');
const KEYS = '20261001160000_muscle_group_keys.sql';
const STUB = `
  create schema auth;
  create table auth.users (id uuid primary key);
  create role anon nologin;
  create role authenticated nologin;
  create function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;
`;
const U = 'aaaaaaaa-0000-4000-8000-000000000001';
const T = '2026-09-29T18:00:00Z';

it('Spanish names become keys in the same order; custom groups stay; updated_at moves forward', async () => {
  const db = new PGlite();
  await db.exec(STUB);
  const files = fs.readdirSync(MIGRATIONS).filter((f) => f.endsWith('.sql')).sort();
  assert.ok(files.includes(KEYS));
  for (const f of files.filter((f) => f < KEYS)) await db.exec(fs.readFileSync(path.join(MIGRATIONS, f), 'utf8'));

  await db.query('insert into auth.users (id) values ($1)', [U]);
  const ex = (id: string, groups: string) =>
    db.query(
      `insert into public.exercise (id, user_id, canonical_name, muscle_groups, kind, rep_floor, rep_top, step_kg, load_basis, created_at, updated_at)
       values ($1, $2, 'x', $3::jsonb, 'compound', 8, 12, 2.5, 'total', $4, $4)`,
      [id, U, groups, T],
    );
  await ex('eeeeeeee-0000-4000-8000-00000000000a', '["pierna", "glúteo"]');
  await ex('eeeeeeee-0000-4000-8000-00000000000b', '["antebrazo"]');
  await db.query(`insert into public.session (id, user_id, muscle_groups, updated_at) values ($1, $2, '["tríceps", "hombro"]', $3)`, [
    '55555555-0000-4000-8000-00000000000a',
    U,
    T,
  ]);

  await db.exec(fs.readFileSync(path.join(MIGRATIONS, KEYS), 'utf8'));

  const { rows } = await db.query<{ id: string; muscle_groups: string[]; newer: boolean }>(
    `select id, muscle_groups, updated_at > $1::timestamptz as newer from public.exercise
     union all select id, muscle_groups, updated_at > $1::timestamptz from public.session order by id`,
    [T],
  );
  assert.deepEqual(
    rows.map((r) => [r.muscle_groups, r.newer]),
    [
      [['triceps', 'shoulders'], true],
      [['legs', 'glutes'], true],
      [['antebrazo'], false],
    ],
  );
  await db.close();
});
