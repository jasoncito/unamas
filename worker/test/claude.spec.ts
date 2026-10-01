import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { UNCLEAR, type ContextExercise, type ParseRequest, type ParseResponse } from '../../shared/contract';
import { MAX_TOKENS, MODEL, numbersIn, OUTPUT_SCHEMA, parseWithClaude, sanitize } from '../src/claude';

const EXERCISES: ContextExercise[] = [
	{ id: 'laterales_polea', name: 'Elevaciones laterales en polea', aliases: [], muscle_groups: ['hombro'], last: null },
	{ id: 'laterales_pie', name: 'Elevaciones laterales de pie', aliases: [], muscle_groups: ['hombro'], last: null },
];
const REQ: ParseRequest = { text: 'laterales en polea 10, 4 de 11', image: null, context: { muscle_groups: ['hombro'], exercises: EXERCISES } };

const entry = (over: Partial<ParseResponse['entries'][number]> = {}): ParseResponse['entries'][number] => ({
	exercise_id: 'laterales_polea',
	new_exercise: null,
	load_kg: 10,
	reps: [11, 11, 11, 11],
	rir_note: null,
	easy: false,
	...over,
});
const log = (entries = [entry()]): ParseResponse => ({ intent: 'log', entries, ambiguity: null, reply: null });

/** A client whose HTTP goes to `reply`; `sent` collects the request bodies. */
function fakeClient(reply: (body: any) => Response) {
	const sent: any[] = [];
	const client = new Anthropic({
		apiKey: 'test',
		maxRetries: 0,
		fetch: (async (_url: string, init: RequestInit) => {
			const body = JSON.parse(init.body as string);
			sent.push(body);
			return reply(body);
		}) as unknown as typeof fetch,
	});
	return { client, sent };
}

const message = (text: string, stop_reason = 'end_turn') =>
	Response.json({
		id: 'msg_1',
		type: 'message',
		role: 'assistant',
		model: MODEL,
		content: [{ type: 'text', text }],
		stop_reason,
		stop_sequence: null,
		usage: { input_tokens: 1500, output_tokens: 80 },
	});

describe('parseWithClaude', () => {
	it('sends Haiku 4.5, a small max_tokens, the contract as a JSON schema, and the context as JSON', async () => {
		const { client, sent } = fakeClient(() => message(JSON.stringify(log())));
		await expect(parseWithClaude(client, REQ)).resolves.toEqual(log());

		const body = sent[0];
		expect(body.model).toBe('claude-haiku-4-5-20251001');
		expect(body.max_tokens).toBe(MAX_TOKENS);
		expect(body.output_config.format.type).toBe('json_schema');
		expect(body.output_config.format.schema.properties.intent.enum).toContain('ambiguous');
		expect(body.system).toMatch(/exercise_id is copied exactly from context\.exercises/);
		expect(JSON.parse(body.messages[0].content.at(-1).text)).toEqual({ context: REQ.context, text: REQ.text });
	});

	it('logs the token usage (numbers only, not the text)', async () => {
		const logs: string[] = [];
		const spy = vi.spyOn(console, 'log').mockImplementation((line: string) => void logs.push(line));
		const { client } = fakeClient(() => message(JSON.stringify(log())));
		await parseWithClaude(client, REQ);
		spy.mockRestore();
		expect(logs.map((l) => JSON.parse(l))).toEqual([
			{ event: 'claude_usage', model: MODEL, input_tokens: 1500, output_tokens: 80 },
		]);
		expect(logs.join()).not.toContain('laterales');
	});

	it('a photo goes first, as a base64 JPEG image block', async () => {
		const { client, sent } = fakeClient(() => message(JSON.stringify(log())));
		await parseWithClaude(client, { ...REQ, image: 'aGVsbG8=' });
		expect(sent[0].messages[0].content[0]).toEqual({
			type: 'image',
			source: { type: 'base64', media_type: 'image/jpeg', data: 'aGVsbG8=' },
		});
	});

	it('a cut-off answer (max_tokens) is unclear', async () => {
		const { client } = fakeClient(() => message('{"intent":"log","entries":[{"exer', 'max_tokens'));
		await expect(parseWithClaude(client, REQ)).resolves.toEqual(UNCLEAR);
	});

	it('a refusal is unclear even if the text looks valid', async () => {
		const { client } = fakeClient(() => message(JSON.stringify(log()), 'refusal'));
		await expect(parseWithClaude(client, REQ)).resolves.toEqual(UNCLEAR);
	});

	it('an answer that does not match the contract is unclear', async () => {
		const { client } = fakeClient(() => message(JSON.stringify({ intent: 'dance', entries: [] })));
		await expect(parseWithClaude(client, REQ)).resolves.toEqual(UNCLEAR);
	});

	it('API errors propagate so the route answers 502 and the app retries', async () => {
		const { client, sent } = fakeClient(() => Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'x' } }, { status: 529 }));
		await expect(parseWithClaude(client, REQ)).rejects.toBeInstanceOf(Anthropic.APIError);
		expect(sent).toHaveLength(1); // no retries in the Worker: the app retries
	});
});

describe('OUTPUT_SCHEMA', () => {
	const walk = (node: unknown, visit: (n: Record<string, unknown>) => void): void => {
		if (Array.isArray(node)) node.forEach((n) => walk(n, visit));
		else if (node && typeof node === 'object') {
			visit(node as Record<string, unknown>);
			Object.values(node).forEach((v) => walk(v, visit));
		}
	};

	it('keeps the enums, so Claude has to pick a valid value', () => {
		const entry = (OUTPUT_SCHEMA.properties as any).entries.items.properties;
		expect((OUTPUT_SCHEMA.properties as any).intent.enum).toEqual(['log', 'ambiguous', 'end_session', 'question', 'unclear']);
		expect(entry.new_exercise.anyOf[0].properties.kind.enum).toEqual(['compound_heavy', 'compound', 'isolation', 'calf']);
	});

	it('field names are never mistaken for keywords', () => {
		// "reps" is an array of z.int(), whose minimum/maximum must go; the property itself must stay.
		const entry = (OUTPUT_SCHEMA.properties as any).entries.items;
		expect(Object.keys(entry.properties)).toEqual(['exercise_id', 'new_exercise', 'load_kg', 'reps', 'rir_note', 'easy']);
		expect(entry.properties.reps.items).toEqual({ type: 'integer' });
	});

	it('has only what structured outputs support: closed objects, no numeric or length bounds', () => {
		walk(OUTPUT_SCHEMA, (n) => {
			for (const k of ['minimum', 'maximum', 'minLength', 'maxLength', '$schema']) expect(n).not.toHaveProperty(k);
			if (n.type === 'object') expect(n.additionalProperties).toBe(false);
		});
	});
});

describe('completing "which one?" options', () => {
	const LATERALES: ContextExercise[] = [
		{ id: 'laterales_pie', name: 'Elevaciones laterales de pie con mancuernas', aliases: ['laterales de pie'], muscle_groups: ['hombro'], last: null },
		{ id: 'laterales_polea', name: 'Elevaciones laterales en polea', aliases: ['laterales en polea'], muscle_groups: ['hombro'], last: null },
		{ id: 'laterales_rodillas', name: 'Elevaciones laterales con pecho en rodillas', aliases: ['pájaros'], muscle_groups: ['hombro'], last: null },
		{ id: 'face_pull', name: 'Face pull en polea alta', aliases: ['jalones polea deltoide posterior'], muscle_groups: ['hombro'], last: null },
		{ id: 'press', name: 'Press de hombro con mancuernas', aliases: [], muscle_groups: ['hombro'], last: null },
	];
	const asked = (ids: string[]): ParseResponse => ({
		intent: 'ambiguous',
		entries: [],
		ambiguity: { question: '¿Cuáles laterales?', options: ids.map((id) => ({ exercise_id: id, label: id })) },
		reply: null,
	});
	const ids = (r: ParseResponse) => r.ambiguity!.options.map((o) => o.exercise_id);

	it('adds the one Claude left out, after Claude’s own', () => {
		const res = sanitize(asked(['laterales_pie', 'laterales_polea']), LATERALES, 'laterales con 10, 4 de 11');
		expect(ids(res)).toEqual(['laterales_pie', 'laterales_polea', 'laterales_rodillas']);
		expect(res.ambiguity!.options[2].label).toBe('Elevaciones laterales con pecho en rodillas');
	});

	it('needs every significant word: "laterales en polea" only fits the polea one', () => {
		const res = sanitize(asked(['laterales_pie']), LATERALES, 'laterales en polea 10 4 de 11');
		expect(ids(res)).toEqual(['laterales_pie', 'laterales_polea']);
	});

	it('singular/plural and accents: "lateral" and "pájaro" match "laterales" and "pájaros"', () => {
		expect(ids(sanitize(asked(['press']), LATERALES, 'lateral 10 4 de 11'))).toEqual(['press', 'laterales_pie', 'laterales_polea', 'laterales_rodillas']);
		expect(ids(sanitize(asked(['press']), LATERALES, 'pajaro con 8'))).toEqual(['press', 'laterales_rodillas']);
	});

	it('ignores empty words: "laterales de polea" fits "Elevaciones laterales en polea"', () => {
		expect(ids(sanitize(asked(['press']), LATERALES, 'laterales de la polea 10'))).toEqual(['press', 'laterales_polea']);
	});

	it('uses aliases too', () => {
		expect(ids(sanitize(asked(['press']), LATERALES, 'jalon polea deltoide posterior 25'))).toEqual(['press', 'face_pull']);
	});

	it("never removes Claude's options, even ones the words don't fit", () => {
		expect(ids(sanitize(asked(['press', 'face_pull']), LATERALES, 'laterales 10'))).toEqual([
			'press', 'face_pull', 'laterales_pie', 'laterales_polea', 'laterales_rodillas',
		]);
	});

	it('at most 5 in total, and never trims Claude below its own count', () => {
		const many: ContextExercise[] = Array.from({ length: 8 }, (_, i) => ({ id: `lat${i}`, name: `Laterales variante ${i}`, aliases: [], muscle_groups: [], last: null }));
		expect(ids(sanitize(asked(['lat0', 'lat1']), many, 'laterales 10'))).toHaveLength(5);
		expect(ids(sanitize(asked(['lat0', 'lat1', 'lat2', 'lat3', 'lat4', 'lat5']), many, 'laterales 10'))).toHaveLength(6);
	});

	it('a "how much weight?" question (no options) stays as it is', () => {
		const res = sanitize({ ...asked([]), ambiguity: { question: '¿Con cuánto peso?', options: [] } }, LATERALES, 'laterales 4 de 11');
		expect(res.ambiguity!.options).toEqual([]);
	});

	it('a phrase with no significant words adds nothing', () => {
		expect(ids(sanitize(asked(['press']), LATERALES, 'con 10, 4 de 11'))).toEqual(['press']);
	});
});

describe('duplicate net: a "new" exercise named like an existing one is that one', () => {
	const CTX: ContextExercise[] = [
		{ id: 'banca', name: 'Press de banca con barra', aliases: ['press banca', 'Press de banca plano con barra'], muscle_groups: ['pecho'], last: null },
		{ id: 'pecho_maq', name: 'Press de pecho en máquina', aliases: [], muscle_groups: ['pecho'], last: null },
	];
	const asNew = (canonical_name: string, load_kg = 20) =>
		log([entry({ exercise_id: null, load_kg, new_exercise: { canonical_name, muscle_groups: ['pecho'], kind: 'compound', load_basis: 'per_side' } })]);

	it('eval s3e6: exactly the name of an existing exercise → that exercise', () => {
		const res = sanitize(asNew('Press de pecho en máquina', 25), CTX, 'máquina de pecho, 25 kilos a cada lado, 3 de 10');
		expect(res.entries[0]).toMatchObject({ exercise_id: 'pecho_maq', new_exercise: null });
	});

	it('eval s3e1: exactly one of its aliases (case and accents aside) → that exercise', () => {
		const res = sanitize(asNew('press de BANCA plano con barra'), CTX, 'press banca plano con barra 20 kilos a cada lado, 4 de 12');
		expect(res.entries[0]).toMatchObject({ exercise_id: 'banca', new_exercise: null });
	});

	it('only exact matches: a merely similar name stays a new exercise', () => {
		const res = sanitize(asNew('Press de banca inclinado'), CTX, 'press de banca inclinado 20, 4 de 12');
		expect(res.entries[0]).toMatchObject({ exercise_id: null, new_exercise: { canonical_name: 'Press de banca inclinado' } });
	});

	it('a name shared by two exercises → asks which one', () => {
		const both: ContextExercise[] = [...CTX, { id: 'otro', name: 'Otro press', aliases: ['press de pecho en maquina'], muscle_groups: ['pecho'], last: null }];
		const res = sanitize(asNew('Press de pecho en máquina'), both, 'press de pecho en máquina 20, 3 de 10');
		expect(res.intent).toBe('ambiguous');
		expect(res.ambiguity!.options.map((o) => o.exercise_id)).toEqual(['pecho_maq', 'otro']);
	});
});

describe('load net: the load must be a number they said', () => {
	it('eval s4e1: both sides added up (60 for "30 a cada lado") → the half they said', () => {
		const res = sanitize(log([entry({ load_kg: 60 })]), EXERCISES, 'sentadilla en la smith 4 de 10 30 kilos a cada lado');
		expect(res.entries[0].load_kg).toBe(30);
	});

	it('a load they never said → asks for it', () => {
		const res = sanitize(log([entry({ load_kg: 44 })]), EXERCISES, 'laterales en polea 4 de 11');
		expect(res).toMatchObject({ intent: 'ambiguous', ambiguity: { question: '¿Con cuánto peso?', options: [] } });
	});

	it('decimals with a comma or a dot', () => {
		expect(sanitize(log([entry({ load_kg: 7.5 })]), EXERCISES, 'laterales en polea con 7,5. 4 de 10').entries[0].load_kg).toBe(7.5);
		expect(sanitize(log([entry({ load_kg: 12.5 })]), EXERCISES, 'curl 12.5 kilos 4 de 10').entries[0].load_kg).toBe(12.5);
	});

	it('the load as said is kept as is', () => {
		expect(sanitize(log([entry({ load_kg: 24 })]), EXERCISES, 'press 24 4 de 9').entries[0].load_kg).toBe(24);
	});

	it('numbersIn reads every number', () => {
		expect(numbersIn('7,5 kilos, 4 de 10 y 12.5')).toEqual([7.5, 4, 10, 12.5]);
	});
});

describe('sanitize', () => {
	it('keeps a valid log', () => {
		expect(sanitize(log(), EXERCISES, REQ.text)).toEqual(log());
	});

	it('an id that is not one of the user’s exercises is unclear (never invented)', () => {
		expect(sanitize(log([entry({ exercise_id: 'laterales_maquina' })]), EXERCISES, REQ.text)).toEqual(UNCLEAR);
	});

	it('a new exercise needs new_exercise', () => {
		expect(sanitize(log([entry({ exercise_id: null })]), EXERCISES, REQ.text)).toEqual(UNCLEAR);
		const newOne = entry({
			exercise_id: null,
			new_exercise: { canonical_name: 'Remo al mentón', muscle_groups: ['hombro'], kind: 'compound', load_basis: 'total' },
		});
		expect(sanitize(log([newOne]), EXERCISES, REQ.text)).toEqual(log([newOne]));
	});

	it('a known id drops a stray new_exercise', () => {
		const both = entry({ new_exercise: { canonical_name: 'x', muscle_groups: [], kind: 'compound', load_basis: 'total' } });
		expect(sanitize(log([both]), EXERCISES, REQ.text).entries[0].new_exercise).toBeNull();
	});

	it('a log with the exercise but no load asks for the load (never invents it)', () => {
		expect(sanitize(log([entry({ load_kg: null })]), EXERCISES, REQ.text)).toEqual({
			intent: 'ambiguous',
			entries: [],
			ambiguity: { question: '¿Con cuánto peso?', options: [] },
			reply: null,
		});
	});

	it('a log with the exercise but no reps asks for them', () => {
		expect(sanitize(log([entry({ reps: [] })]), EXERCISES, REQ.text).ambiguity?.question).toBe('¿Cuántas series y repeticiones?');
	});

	it('an unidentified exercise is still unclear, even without a load', () => {
		expect(sanitize(log([entry({ exercise_id: 'invented', load_kg: null })]), EXERCISES, REQ.text)).toEqual(UNCLEAR);
		expect(sanitize(log([]), EXERCISES, REQ.text)).toEqual(UNCLEAR);
	});

	it('ambiguity options keep only real exercises; entries are dropped', () => {
		const res = sanitize(
			{
				intent: 'ambiguous',
				entries: [entry()],
				ambiguity: {
					question: '¿Cuáles laterales?',
					options: [
						{ exercise_id: 'laterales_polea', label: 'En polea' },
						{ exercise_id: 'invented', label: 'Inventado' },
					],
				},
				reply: null,
			},
			EXERCISES,
			REQ.text, // "laterales en polea…": the options can't grow beyond the polea one
		);
		expect(res).toEqual({
			intent: 'ambiguous',
			entries: [],
			ambiguity: { question: '¿Cuáles laterales?', options: [{ exercise_id: 'laterales_polea', label: 'En polea' }] },
			reply: null,
		});
	});

	it('ambiguous without a question is unclear', () => {
		expect(sanitize({ intent: 'ambiguous', entries: [], ambiguity: null, reply: null }, EXERCISES, REQ.text)).toEqual(UNCLEAR);
	});

	it('end_session and question carry no entries', () => {
		expect(sanitize({ ...log(), intent: 'end_session' }, EXERCISES, REQ.text)).toEqual({ intent: 'end_session', entries: [], ambiguity: null, reply: null });
		expect(sanitize({ intent: 'question', entries: [entry()], ambiguity: null, reply: 'Hola' }, EXERCISES, REQ.text)).toEqual({
			intent: 'question',
			entries: [],
			ambiguity: null,
			reply: 'Hola',
		});
	});
});
