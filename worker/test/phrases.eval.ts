// The 32 real phrases from dev/seed.json against the real Claude API (CLAUDE.md §6, "Tests del worker").
// Costs about $0.08 per run, so it's not part of `npm test`: run it with `npm run eval` (needs
// ANTHROPIC_API_KEY in .dev.vars).
import Anthropic from '@anthropic-ai/sdk';
import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

import seed from '../../dev/seed.json';
import type { ContextExercise, ParseRequest, ParseResponse } from '../../shared/contract';
import { parseWithClaude } from '../src/claude';

// Real cost of the run: every response's usage, priced at Haiku 4.5 rates ($1 / $5 per million tokens).
const usage = { calls: 0, input: 0, output: 0 };
/** Claude's raw answer to the last call, shown when a test fails (before the Worker's checks). */
let lastRaw = '';
const client = new Anthropic({
	apiKey: env.ANTHROPIC_API_KEY,
	fetch: async (url, init) => {
		const res = await fetch(url, init);
		const body = (await res.clone().json().catch(() => null)) as {
			usage?: { input_tokens: number; output_tokens: number };
			content?: { type: string; text?: string }[];
		} | null;
		lastRaw = body?.content?.find((b) => b.type === 'text')?.text ?? '';
		if (body?.usage) {
			usage.calls++;
			usage.input += body.usage.input_tokens;
			usage.output += body.usage.output_tokens;
			// Printed after every call (an afterAll summary can get lost): the last line is the run's total.
			console.log(`[eval cost] ${costLine()}`);
		}
		return res;
	},
});

function costLine(): string {
	const dollars = (usage.input * 1 + usage.output * 5) / 1_000_000;
	return `${usage.calls} calls · ${usage.input} input + ${usage.output} output tokens · $${dollars.toFixed(4)}`;
}
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

const parse = (text: string, date = '2026-09-28', groups = ['shoulders']) =>
	parseWithClaude(client, { text, image: null, context: contextOn(date, groups) });

/**
 * ✅ right: logged exactly as in the seed (or, with no load in the phrase, asked for it).
 * ⚠️ safe: asked which exercise, and the right one is among the options: one tap, no wrong data.
 * ❌ wrong: logged something else, or asked without offering the right exercise.
 */
type Verdict = '✅' | '⚠️' | '❌';
const tally: Record<Verdict, number> = { '✅': 0, '⚠️': 0, '❌': 0 };

function grade(expected: { exercise_id: string; load_kg: number | null; reps: number[] }, res: ParseResponse): Verdict {
	if (expected.load_kg === null) {
		const asksLoad = res.intent === 'ambiguous' && /peso|kilo|kg|carga|cu[aá]nto/i.test(res.ambiguity?.question ?? '');
		return asksLoad ? '✅' : '❌';
	}
	if (res.intent === 'log') {
		const [e, ...rest] = res.entries;
		const exact = rest.length === 0 && e.exercise_id === expected.exercise_id && e.load_kg === expected.load_kg &&
			JSON.stringify(e.reps) === JSON.stringify(expected.reps);
		return exact ? '✅' : '❌';
	}
	if (res.intent === 'ambiguous' && res.ambiguity?.options.some((o) => o.exercise_id === expected.exercise_id)) return '⚠️';
	return '❌';
}

describe('the 32 seed phrases', () => {
	const cases = seed.entries.map((e) => {
		const session = seed.sessions.find((s) => s.id === e.session_id)!;
		return { ...e, date: session.date, groups: session.muscle_groups };
	});

	it.each(cases)('$id: "$raw_text"', async (c) => {
		const res = await parse(c.raw_text, c.date, c.groups);
		const verdict = grade(c, res);
		tally[verdict]++;
		console.log(`[eval result] ${c.id} ${verdict} · ✅ ${tally['✅']} · ⚠️ ${tally['⚠️']} · ❌ ${tally['❌']}`);
		expect(verdict, `raw: ${lastRaw}`).not.toBe('❌');
	});
});

describe('beyond the seed', () => {
	it('"laterales con 10, 4 de 11" with three laterales asks which one', async () => {
		const res = await parse('laterales con 10, 4 de 11');
		expect(res.intent, `raw: ${lastRaw}`).toBe('ambiguous');
		expect(res.ambiguity!.options.map((o) => o.exercise_id).sort()).toEqual(
			['laterales_pecho_rodillas', 'laterales_pie_mancuernas', 'laterales_polea'],
		);
	});

	it('an exercise they never did becomes a new exercise', async () => {
		const res = await parse('remo al mentón con barra 15 kilos 3 de 12');
		expect(res.intent, `raw: ${lastRaw}`).toBe('log');
		const [e] = res.entries;
		expect(e.exercise_id).toBeNull();
		expect(e.new_exercise?.muscle_groups).toContain('shoulders');
		expect(e.new_exercise!.canonical_name.length, e.new_exercise!.canonical_name).toBeLessThanOrEqual(32); // short name rule
		expect([e.load_kg, e.reps]).toEqual([15, [12, 12, 12]]);
	});

	it('"listo, terminamos por hoy" is end_session (the app shows the stop tip, it does not end)', async () => {
		expect((await parse('listo, terminamos por hoy')).intent).toBe('end_session');
	});

	it('"fácil" sets easy and keeps the note', async () => {
		// "press de hombro" alone would be ambiguous: this user also has "Press de hombro en máquina".
		const res = await parse('press de hombro con mancuernas 24 4 de 12, fácil');
		expect(res.entries[0]).toMatchObject({ exercise_id: 'press_hombro_mancuernas', easy: true });
		expect(res.entries[0].rir_note).toMatch(/f[aá]cil/i);
	});
});
