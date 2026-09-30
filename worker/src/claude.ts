import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { ParseResponse, UNCLEAR, type ContextExercise, type ParseRequest } from '../../shared/contract';
import { nameHasAllWords, significantWords } from '../../shared/names';
import { SYSTEM_PROMPT } from './prompt';

/** Pinned snapshot (CLAUDE.md §3): the same phrases keep parsing the same way. */
export const MODEL = 'claude-haiku-4-5-20251001';
export const MAX_TOKENS = 400;
export const TIMEOUT_MS = 15_000;

/**
 * Text (and optional photo) → structured workout data, via structured outputs. API and network errors
 * propagate (the route answers 502 and the app retries later); an answer that doesn't fit the contract
 * or the user's exercises becomes `unclear`.
 */
export async function parseWithClaude(client: Anthropic, request: ParseRequest): Promise<ParseResponse> {
	const content: Anthropic.ContentBlockParam[] = [];
	if (request.image) {
		content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: request.image } });
	}
	content.push({ type: 'text', text: JSON.stringify({ context: request.context, text: request.text }) });

	// API, network and timeout errors propagate: the app keeps the entry pending and retries.
	// No retries here: a retry could blow past the 15 s the app waits.
	const message = await client.messages.create(
		{
			model: MODEL,
			max_tokens: MAX_TOKENS,
			system: SYSTEM_PROMPT,
			messages: [{ role: 'user', content }],
			output_config: { format: { type: 'json_schema', schema: OUTPUT_SCHEMA } },
		},
		{ timeout: TIMEOUT_MS, maxRetries: 0 },
	);
	// Token usage per call, for cost tracking in the Worker's logs (numbers only, never the user's text).
	console.log(
		JSON.stringify({ event: 'claude_usage', model: MODEL, input_tokens: message.usage.input_tokens, output_tokens: message.usage.output_tokens }),
	);
	if (message.stop_reason !== 'end_turn') return UNCLEAR;

	const text = message.content.find((b) => b.type === 'text')?.text;
	let parsed: ReturnType<typeof ParseResponse.safeParse>;
	try {
		parsed = ParseResponse.safeParse(JSON.parse(text ?? ''));
	} catch {
		return UNCLEAR;
	}
	return parsed.success ? sanitize(parsed.data, request.context.exercises, request.text) : UNCLEAR;
}

/**
 * The contract as a structured-output schema. Built here rather than with the SDK's zodOutputFormat
 * helper, which moves `enum` into the description: keeping it makes Claude pick a valid intent, kind
 * and load_basis. Drops only what structured outputs don't support (numeric and length bounds).
 */
const UNSUPPORTED_KEYS = new Set(['$schema', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'pattern']);
export const OUTPUT_SCHEMA = toStructuredOutputSchema(z.toJSONSchema(ParseResponse) as Record<string, unknown>);

/** Drops unsupported keywords from a schema node and its subschemas; property names are left alone. */
function toStructuredOutputSchema(schema: Record<string, unknown>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(schema)) {
		if (UNSUPPORTED_KEYS.has(key)) continue;
		if (key === 'properties') {
			out[key] = Object.fromEntries(
				Object.entries(value as Record<string, Record<string, unknown>>).map(([name, sub]) => [name, toStructuredOutputSchema(sub)]),
			);
		} else if (key === 'items' || key === 'additionalProperties') {
			out[key] = typeof value === 'object' && value !== null ? toStructuredOutputSchema(value as Record<string, unknown>) : value;
		} else if (key === 'anyOf' || key === 'allOf') {
			out[key] = (value as Record<string, unknown>[]).map(toStructuredOutputSchema);
		} else {
			out[key] = value;
		}
	}
	return out;
}

/**
 * Structured outputs guarantee the shape, not the meaning. Keeps only what's consistent with the
 * user's exercises; anything that would make the app invent data becomes `unclear`.
 */
export function sanitize(response: ParseResponse, exercises: readonly ContextExercise[], text: string): ParseResponse {
	const known = new Set(exercises.map((e) => e.id));

	switch (response.intent) {
		case 'log': {
			if (response.entries.length === 0) return UNCLEAR;
			for (const e of response.entries) {
				const identified = e.exercise_id !== null ? known.has(e.exercise_id) : e.new_exercise !== null;
				if (!identified) return UNCLEAR;
			}
			// Exercise known but a number missing: ask for it instead of inventing it (CLAUDE.md §6).
			if (response.entries.some((e) => e.load_kg === null)) return askFor('¿Con cuánto peso?');
			if (response.entries.some((e) => e.reps.length === 0)) return askFor('¿Cuántas series y repeticiones?');
			return {
				intent: 'log',
				entries: response.entries.map((e) => (e.exercise_id !== null ? { ...e, new_exercise: null } : e)),
				ambiguity: null,
				reply: null,
			};
		}
		case 'ambiguous': {
			if (!response.ambiguity?.question) return UNCLEAR;
			const options = response.ambiguity.options.filter((o) => known.has(o.exercise_id));
			// "Which one?" (not "how much weight?"): make sure every exercise the words fit is offered.
			if (options.length > 0) options.push(...missingCandidates(options, exercises, text));
			return { intent: 'ambiguous', entries: [], ambiguity: { question: response.ambiguity.question, options }, reply: null };
		}
		case 'end_session':
			return { intent: 'end_session', entries: [], ambiguity: null, reply: null };
		case 'question':
		case 'unclear':
			return { intent: response.intent, entries: [], ambiguity: null, reply: response.reply };
	}
}

function askFor(question: string): ParseResponse {
	return { intent: 'ambiguous', entries: [], ambiguity: { question, options: [] }, reply: null };
}

/** At most this many options in a "which one?" question; Claude's own options are never removed. */
export const MAX_OPTIONS = 5;

/**
 * Exercises whose name or an alias contains every significant word of the phrase and that Claude
 * didn't offer (it sometimes lists only some). Only adds, up to MAX_OPTIONS in total.
 */
function missingCandidates(
	offered: readonly { exercise_id: string }[],
	exercises: readonly ContextExercise[],
	text: string,
): { exercise_id: string; label: string }[] {
	const words = significantWords(text);
	const taken = new Set(offered.map((o) => o.exercise_id));
	return exercises
		.filter((e) => !taken.has(e.id) && nameHasAllWords([e.name, ...e.aliases], words))
		.slice(0, Math.max(0, MAX_OPTIONS - offered.length))
		.map((e) => ({ exercise_id: e.id, label: e.name }));
}
