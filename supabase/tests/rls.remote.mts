// M2b acceptance check against a real Supabase project: two real anonymous users can't read or write
// each other's rows. Needs EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY (from
// .env.local). Run with: npm run test:db:remote. Each run leaves two anonymous users behind.
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { before, describe, it } from 'node:test';

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const T = new Date().toISOString();

/** Denied by RLS or by missing grants: Postgres 42501 with the expected reason. */
function assertDenied(error: { code: string; message: string } | null, reason: RegExp) {
  assert.ok(error, 'expected an error');
  assert.equal(error.code, '42501');
  assert.match(error.message, reason);
}

const client = () => createClient(url!, key!, { auth: { persistSession: false, autoRefreshToken: false } });

const exercise = (id: string, name = 'Press de hombro') => ({
  id,
  canonical_name: name,
  muscle_groups: ['hombro'],
  kind: 'compound',
  rep_floor: 8,
  rep_top: 12,
  step_kg: 2,
  load_basis: 'per_dumbbell',
  created_at: T,
  updated_at: T,
});

describe('RLS on the real project', { skip: !url || !key ? 'EXPO_PUBLIC_SUPABASE_* not set' : false }, () => {
  let a: SupabaseClient;
  let b: SupabaseClient;
  let aId: string;
  let bId: string;
  const exA = randomUUID();

  before(async () => {
    a = client();
    b = client();
    const [ra, rb] = await Promise.all([a.auth.signInAnonymously(), b.auth.signInAnonymously()]);
    assert.ifError(ra.error);
    assert.ifError(rb.error);
    aId = ra.data.user!.id;
    bId = rb.data.user!.id;
    const { error } = await a.from('exercise').upsert(exercise(exA), { onConflict: 'id' });
    assert.ifError(error);
  });

  it('user_id is set by the server', async () => {
    const { data, error } = await a.from('exercise').select('user_id').eq('id', exA);
    assert.ifError(error);
    assert.deepEqual(data, [{ user_id: aId }]);
  });

  it("B can't see A's rows", async () => {
    const { data, error } = await b.from('exercise').select('id').eq('id', exA);
    assert.ifError(error);
    assert.deepEqual(data, []);
  });

  it("B can't update A's rows", async () => {
    const { data } = await b.from('exercise').update({ canonical_name: 'hacked' }).eq('id', exA).select();
    assert.deepEqual(data ?? [], []);
    const { data: check } = await a.from('exercise').select('canonical_name').eq('id', exA);
    assert.deepEqual(check, [{ canonical_name: 'Press de hombro' }]);
  });

  it("B can't overwrite A's row with an upsert on the same id", async () => {
    const { error } = await b.from('exercise').upsert(exercise(exA, 'hacked'), { onConflict: 'id' });
    assertDenied(error, /row-level security/);
  });

  it("B can't write rows with A's user_id", async () => {
    assert.notEqual(aId, bId);
    const { error } = await b.from('exercise').insert({ ...exercise(randomUUID()), user_id: aId });
    assertDenied(error, /row-level security/);
  });

  it("clients can't hard-delete", async () => {
    const { error } = await a.from('exercise').delete().eq('id', exA);
    assertDenied(error, /permission denied/);
  });

  it('a phone clock more than 5 minutes ahead is replaced by the server time', async () => {
    const ahead = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString();
    const { error } = await a.from('exercise').update({ updated_at: ahead }).eq('id', exA);
    assert.ifError(error);
    const { data } = await a.from('exercise').select('updated_at').eq('id', exA);
    const drift = Math.abs(Date.parse(data![0].updated_at) - Date.now()) / 1000;
    assert.ok(drift < 120, `updated_at should be about now, is ${drift} s off`);
  });

  it('without a session nothing is readable', async () => {
    for (const table of ['exercise', 'session', 'entry']) {
      const { error } = await client().from(table).select('id');
      assertDenied(error, /permission denied/);
    }
  });
});
