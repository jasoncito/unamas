import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';

import { UNCLEAR, type ContextExercise, type ParseRequest, type ParseResponse } from '../../shared/contract';
import { MAX_TOKENS, MODEL, OUTPUT_SCHEMA, parseWithClaude, sanitize } from '../src/claude';

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

describe('sanitize', () => {
	it('keeps a valid log', () => {
		expect(sanitize(log(), EXERCISES)).toEqual(log());
	});

	it('an id that is not one of the user’s exercises is unclear (never invented)', () => {
		expect(sanitize(log([entry({ exercise_id: 'laterales_maquina' })]), EXERCISES)).toEqual(UNCLEAR);
	});

	it('a new exercise needs new_exercise', () => {
		expect(sanitize(log([entry({ exercise_id: null })]), EXERCISES)).toEqual(UNCLEAR);
		const newOne = entry({
			exercise_id: null,
			new_exercise: { canonical_name: 'Remo al mentón', muscle_groups: ['hombro'], kind: 'compound', load_basis: 'total' },
		});
		expect(sanitize(log([newOne]), EXERCISES)).toEqual(log([newOne]));
	});

	it('a known id drops a stray new_exercise', () => {
		const both = entry({ new_exercise: { canonical_name: 'x', muscle_groups: [], kind: 'compound', load_basis: 'total' } });
		expect(sanitize(log([both]), EXERCISES).entries[0].new_exercise).toBeNull();
	});

	it('a log with the exercise but no load asks for the load (never invents it)', () => {
		expect(sanitize(log([entry({ load_kg: null })]), EXERCISES)).toEqual({
			intent: 'ambiguous',
			entries: [],
			ambiguity: { question: '¿Con cuánto peso?', options: [] },
			reply: null,
		});
	});

	it('a log with the exercise but no reps asks for them', () => {
		expect(sanitize(log([entry({ reps: [] })]), EXERCISES).ambiguity?.question).toBe('¿Cuántas series y repeticiones?');
	});

	it('an unidentified exercise is still unclear, even without a load', () => {
		expect(sanitize(log([entry({ exercise_id: 'invented', load_kg: null })]), EXERCISES)).toEqual(UNCLEAR);
		expect(sanitize(log([]), EXERCISES)).toEqual(UNCLEAR);
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
		);
		expect(res).toEqual({
			intent: 'ambiguous',
			entries: [],
			ambiguity: { question: '¿Cuáles laterales?', options: [{ exercise_id: 'laterales_polea', label: 'En polea' }] },
			reply: null,
		});
	});

	it('ambiguous without a question is unclear', () => {
		expect(sanitize({ intent: 'ambiguous', entries: [], ambiguity: null, reply: null }, EXERCISES)).toEqual(UNCLEAR);
	});

	it('end_session and question carry no entries', () => {
		expect(sanitize({ ...log(), intent: 'end_session' }, EXERCISES)).toEqual({ intent: 'end_session', entries: [], ambiguity: null, reply: null });
		expect(sanitize({ intent: 'question', entries: [entry()], ambiguity: null, reply: 'Hola' }, EXERCISES)).toEqual({
			intent: 'question',
			entries: [],
			ambiguity: null,
			reply: 'Hola',
		});
	});
});
