// The 32 real phrases from dev/seed.json against the real Claude API (CLAUDE.md §6, "Tests del worker").
// Costs about $0.08 per run, so it's not part of `npm test`: run it with `npm run eval` (needs
// ANTHROPIC_API_KEY in .dev.vars).
import Anthropic from '@anthropic-ai/sdk';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import seed from '../../dev/seed.json';
import type { ContextExercise, ParseRequest } from '../../shared/contract';
import { parseWithClaude } from '../src/claude';

const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
const dateOf = new Map(seed.sessions.map((s) => [s.id, s.date]));

/** Every exercise, with its last time strictly before `date`: what the app would send that day. */
function contextOn(date: string, muscleGroups: string[]): ParseRequest['context'] {
	const exercises: ContextExercise[] = seed.exercises.map((x) => {
		const before = seed.entries.filter((e) => e.exercise_id === x.id && dateOf.get(e.session_id)! < date);
		const last = before.at(-1);
		return {
			id: x.id,
			name: x.canonical_name,
			aliases: x.aliases,
			muscle_groups: x.muscle_groups,
			last: last ? { date: dateOf.get(last.session_id)!, load_kg: last.load_kg, reps: last.reps } : null,
		};
	});
	return { muscle_groups: muscleGroups, exercises };
}

const parse = (text: string, date = '2026-09-28', groups = ['hombro']) =>
	parseWithClaude(client, { text, image: null, context: contextOn(date, groups) });

describe('the 32 seed phrases', () => {
	const cases = seed.entries.map((e) => {
		const session = seed.sessions.find((s) => s.id === e.session_id)!;
		return { ...e, date: session.date, groups: session.muscle_groups };
	});

	it.each(cases)('$id: "$raw_text"', async (c) => {
		const res = await parse(c.raw_text, c.date, c.groups);
		if (c.load_kg === null) {
			// No load in the phrase: ask for it, don't invent it.
			expect(res.intent, JSON.stringify(res)).toBe('ambiguous');
			expect(res.ambiguity?.question, JSON.stringify(res)).toMatch(/peso|kilo|kg|carga|cu[aá]nto/i);
			return;
		}
		expect(res.intent, JSON.stringify(res)).toBe('log');
		expect(res.entries.map((e) => [e.exercise_id, e.load_kg, e.reps])).toEqual([[c.exercise_id, c.load_kg, c.reps]]);
	});
});

describe('beyond the seed', () => {
	it('"laterales con 10, 4 de 11" with three laterales asks which one', async () => {
		const res = await parse('laterales con 10, 4 de 11');
		expect(res.intent, JSON.stringify(res)).toBe('ambiguous');
		expect(res.ambiguity!.options.map((o) => o.exercise_id).sort()).toEqual(
			['laterales_pecho_rodillas', 'laterales_pie_mancuernas', 'laterales_polea'],
		);
	});

	it('an exercise they never did becomes a new exercise', async () => {
		const res = await parse('remo al mentón con barra 15 kilos 3 de 12');
		expect(res.intent, JSON.stringify(res)).toBe('log');
		const [e] = res.entries;
		expect(e.exercise_id).toBeNull();
		expect(e.new_exercise?.muscle_groups).toContain('hombro');
		expect([e.load_kg, e.reps]).toEqual([15, [12, 12, 12]]);
	});

	it('"listo, terminamos por hoy" is end_session (the app shows the stop tip, it does not end)', async () => {
		expect((await parse('listo, terminamos por hoy')).intent).toBe('end_session');
	});

	it('"fácil" sets easy and keeps the note', async () => {
		const res = await parse('press de hombro 24 4 de 12, fácil');
		expect(res.entries[0]).toMatchObject({ exercise_id: 'press_hombro_mancuernas', easy: true });
		expect(res.entries[0].rir_note).toMatch(/f[aá]cil/i);
	});
});
