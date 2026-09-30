// End-to-end check of POST /account/delete against the deployed Worker, with a throwaway anonymous
// user. Only the publishable key is used here: the Worker deletes with its own secret.
//   npm run test:account-delete -- seed <state-file>    create the user and one exercise, session, entry
//   npm run test:account-delete -- delete <state-file>  call the Worker, check the session is gone
// Check the rows with SQL between the phases (supabase db query --linked).
import { createClient } from '@supabase/supabase-js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

const WORKER = 'https://unamas-api.jsoncito.workers.dev';
const [phase, stateFile] = process.argv.slice(2);
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const key = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
assert.ok(url && key, 'EXPO_PUBLIC_SUPABASE_* not set');
assert.ok(stateFile, 'usage: seed|delete <state-file>');
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

if (phase === 'seed') {
	const supa = client();
	const { data, error } = await supa.auth.signInAnonymously();
	assert.ifError(error);
	const now = new Date().toISOString();
	const [exerciseId, sessionId, entryId] = [randomUUID(), randomUUID(), randomUUID()];
	// Same shape sync uploads: no user_id (the server sets it). Parents first.
	const rows = [
		['exercise', { id: exerciseId, canonical_name: 'Prueba de borrado', aliases: [], muscle_groups: ['core'], kind: 'isolation', rep_floor: 10, rep_top: 15, step_kg: 1, load_basis: 'total', created_at: now, updated_at: now }],
		['session', { id: sessionId, muscle_groups: ['core'], started_at: now, updated_at: now }],
		['entry', { id: entryId, session_id: sessionId, exercise_id: exerciseId, load_kg: 5, reps: [10, 10], raw_text: 'prueba de borrado 5 2 de 10', created_at: now, updated_at: now }],
	] as const;
	for (const [table, row] of rows) {
		const { error: e } = await supa.from(table).upsert(row, { onConflict: 'id' });
		assert.ifError(e);
	}
	fs.writeFileSync(stateFile, JSON.stringify({ userId: data.user!.id, token: data.session!.access_token }), { mode: 0o600 });
	console.log(`seeded user ${data.user!.id}: exercise ${exerciseId}, session ${sessionId}, entry ${entryId}`);
} else if (phase === 'delete') {
	const { userId, token } = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
	const del = () => fetch(`${WORKER}/account/delete`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } });

	const first = await del();
	console.log(`POST /account/delete → ${first.status} ${await first.text()}`);
	assert.equal(first.status, 200);

	// The Auth server no longer knows this user, so the session is dead.
	const { error } = await client().auth.getUser(token);
	console.log(`getUser with the old token → ${error ? `error: ${error.message}` : 'still valid!'}`);
	assert.ok(error, 'the session should be gone');

	// Idempotent: a retried delete (plan B) still answers 200.
	const again = await del();
	console.log(`second POST /account/delete → ${again.status} ${await again.text()}`);
	assert.equal(again.status, 200);
	fs.rmSync(stateFile);
	console.log(`user ${userId} deleted`);
} else {
	throw new Error('usage: seed|delete <state-file>');
}
