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
    assert.ok(error, 'expected an error');
  });

  it("B can't write rows with A's user_id", async () => {
    const { error } = await b.from('exercise').insert({ ...exercise(randomUUID()), user_id: aId });
    assert.ok(error, 'expected an error');
    assert.notEqual(aId, bId);
  });

  it("clients can't hard-delete", async () => {
    const { error } = await a.from('exercise').delete().eq('id', exA);
    assert.ok(error, 'expected an error');
  });

  it('without a session nothing is readable', async () => {
    const { error } = await client().from('exercise').select('id');
    assert.ok(error, 'expected an error');
  });
});
