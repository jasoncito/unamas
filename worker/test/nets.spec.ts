import { describe, expect, it } from 'vitest';

import seed from '../../dev/seed.json';
import type { ContextExercise, ParseResponse } from '../../shared/contract';
import { namesIt, sanitize } from '../src/claude';

// Free simulation of the word nets (claude.ts: settleByWords) on the 32 seed phrases: if Claude answers
// each one right, which would the nets turn into a question? Same context the eval sends.
const dateOf = new Map(seed.sessions.map((s) => [s.id, s.date]));
function contextOn(date: string): ContextExercise[] {
	return seed.exercises.map((x) => {
		const last = seed.entries.filter((e) => e.exercise_id === x.id && dateOf.get(e.session_id)! < date).at(-1);
		return {
			id: x.id,
			name: x.canonical_name,
			aliases: x.aliases,
			muscle_groups: x.muscle_groups,
			last: last ? { date: dateOf.get(last.session_id)!, load_kg: last.load_kg, reps: last.reps } : null,
		};
	});
}
const right = (exercise_id: string, load_kg: number, reps: number[]): ParseResponse => ({
	intent: 'log',
	entries: [{ exercise_id, new_exercise: null, load_kg, reps, rir_note: null, easy: false }],
	ambiguity: null,
	reply: null,
});

describe('word nets on the 32 seed phrases', () => {
	const results = seed.entries
		.filter((e) => e.load_kg !== null)
		.map((e) => {
			const ctx = contextOn(dateOf.get(e.session_id)!);
			const out = sanitize(right(e.exercise_id, e.load_kg!, e.reps), ctx, e.raw_text);
			return { id: e.id, text: e.raw_text, intent: out.intent, exercise: out.entries[0]?.exercise_id, options: out.ambiguity?.options.map((o) => o.exercise_id) };
		});

	it('a right answer stays right (✅ → ⚠️ only where listed)', () => {
		const changed = results.filter((r) => r.intent !== 'log' || r.exercise !== seed.entries.find((e) => e.id === r.id)!.exercise_id);
		console.log(`[nets] ${results.length} phrases with a load; changed: ${changed.length}`);
		for (const c of changed) console.log(`[nets] ${c.id} → ${c.intent} ${JSON.stringify(c.options)} · "${c.text}"`);
		expect(changed.map((c) => c.id)).toEqual(CHANGED);
	});
});

/** Filled in from the simulation, after looking at each one. */
// s2e4 fits both triceps exercises word for word ("barra en v" and "por detrás de la cabeza"): even a
// right answer becomes a question, with the right one among the options (⚠️, one tap).
const CHANGED: string[] = ['s2e4'];

describe('s2e4, Claude’s actual answer in the eval of 2 oct 2026', () => {
	it('barra V picked, but "por detrás de la cabeza" fits tras nuca too: asks, with both', () => {
		const ctx = contextOn('2026-09-17');
		const out = sanitize(right('pushdown_barra_v', 25, [10, 10, 10, 10]), ctx, 'tríceps en polea con barra en v por detrás de la cabeza, 25 kilos, 4 de 10');
		expect(out.intent).toBe('ambiguous');
		expect(out.ambiguity!.options.map((o) => o.exercise_id)).toEqual(['pushdown_barra_v', 'triceps_polea_tras_cabeza']);
	});
});

describe('rule 1: a rival whose fitting alias is inside the chosen one’s does not count', () => {
	const ctx: ContextExercise[] = [
		{ id: 'polea', name: 'Laterales en polea', aliases: ['laterales en polea'], muscle_groups: ['shoulders'], last: null },
		{ id: 'cualquiera', name: 'Laterales', aliases: ['laterales'], muscle_groups: ['shoulders'], last: null },
	];
	// "en la polea": not exactly an alias, so rule 2 stays out of it.
	it('"laterales en la polea" fits both, but "laterales" is inside "laterales en polea": logged, no question', () => {
		const out = sanitize(right('polea', 7.5, [11, 11, 11, 11]), ctx, 'laterales en la polea 7,5 4 de 11');
		expect(out).toMatchObject({ intent: 'log', entries: [{ exercise_id: 'polea' }] });
	});
	it('the other way round (chose the short one) it asks', () => {
		const out = sanitize(right('cualquiera', 7.5, [11, 11, 11, 11]), ctx, 'laterales en la polea 7,5 4 de 11');
		expect(out.intent).toBe('ambiguous');
		expect(out.ambiguity!.options.map((o) => o.exercise_id)).toEqual(['cualquiera', 'polea']);
	});
});

describe('rule 2: the phrase is exactly a learned alias', () => {
	const ctx: ContextExercise[] = [
		{ id: 'barra_v', name: 'Tríceps en polea, barra V', aliases: ['tríceps polea barra v'], muscle_groups: ['triceps'], last: null },
		{ id: 'nuca', name: 'Tríceps en polea tras nuca', aliases: ['triceps en polea con barra en v por detras de la cabeza'], muscle_groups: ['triceps'], last: null },
	];
	const text = 'tríceps en polea con barra en v por detrás de la cabeza, 25 kilos, 4 de 10';
	it('that exercise, without asking, even if Claude picked the other', () => {
		const out = sanitize(right('barra_v', 25, [10, 10, 10, 10]), ctx, text);
		expect(out).toMatchObject({ intent: 'log', entries: [{ exercise_id: 'nuca', load_kg: 25 }] });
	});
	it('also when Claude thought it was new', () => {
		const out = sanitize(
			{ ...right('x', 25, [10, 10, 10, 10]), entries: [{ exercise_id: null, new_exercise: { canonical_name: 'Tríceps overhead', muscle_groups: ['triceps'], kind: 'isolation', load_basis: 'stack' }, load_kg: 25, reps: [10, 10, 10, 10], rir_note: null, easy: false }] },
			ctx,
			text,
		);
		expect(out).toMatchObject({ intent: 'log', entries: [{ exercise_id: 'nuca', new_exercise: null }] });
	});
});

describe('two exercises in one message: the nets stay out', () => {
	it('"press 24 4 de 9 y laterales en polea 7,5 4 de 11" logs both', () => {
		const ctx = contextOn('2026-09-28');
		const both: ParseResponse = {
			intent: 'log',
			entries: [
				{ exercise_id: 'press_hombro_mancuernas', new_exercise: null, load_kg: 24, reps: [9, 9, 9, 9], rir_note: null, easy: false },
				{ exercise_id: 'laterales_polea', new_exercise: null, load_kg: 7.5, reps: [11, 11, 11, 11], rir_note: null, easy: false },
			],
			ambiguity: null,
			reply: null,
		};
		expect(sanitize(both, ctx, 'press de hombros 24 4 de 9 y laterales en polea 7,5 4 de 11').intent).toBe('log');
	});
});

describe('the option net never drops the right exercise of a seed phrase', () => {
	it('if Claude asks "which one?" and offers the right one, it stays (⚠️ never turns ❌)', () => {
		const dropped = seed.entries.filter((e) => {
			const ex = contextOn(dateOf.get(e.session_id)!).find((x) => x.id === e.exercise_id)!;
			return !namesIt(ex, e.raw_text);
		});
		for (const d of dropped) console.log(`[nets] would drop ${d.exercise_id} for ${d.id}: "${d.raw_text}"`);
		expect(dropped.map((d) => d.id)).toEqual([]);
	});
});
