import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';

import { ParseResponse, UNCLEAR, type ContextExercise, type ParseRequest } from '../../shared/contract';
import { nameHasAllWords, normalizeName, phraseToAlias, significantWords } from '../../shared/names';
import { SYSTEM_PROMPT } from './prompt';

/** Pinned snapshot (CLAUDE.md §3): the same phrases keep parsing the same way. */
export const MODEL = 'claude-haiku-4-5-20251001';
export const MAX_TOKENS = 400;
export const TIMEOUT_MS = 15_000;
/**
 * Deterministic: the same phrase parses the same way, and evals can be compared run to run. Haiku 4.5
 * accepts it (only models after Opus 4.6 reject temperature), also with structured outputs. Verified 2 oct 2026.
 */
export const TEMPERATURE = 0;

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
			temperature: TEMPERATURE,
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
			const entries = [];
			for (const raw of response.entries) {
				// A "new" exercise named exactly like one of theirs is that one: never a duplicate.
				const same = raw.exercise_id === null && raw.new_exercise ? exactlyNamed(raw.new_exercise.canonical_name, exercises) : [];
				if (same.length > 1) return whichOf(same);
				const e = same.length === 1 ? { ...raw, exercise_id: same[0].id, new_exercise: null } : raw;
				const identified = e.exercise_id !== null ? known.has(e.exercise_id) : e.new_exercise !== null;
				if (!identified) return UNCLEAR;
				entries.push(e.exercise_id !== null ? { ...e, new_exercise: null } : e);
			}
			// One exercise in the phrase: their own words can settle it, or show it could be another one.
			if (entries.length === 1) {
				const settled = settleByWords(entries[0], exercises, text);
				if (settled === 'ask') return whichOf(rivalsOf(entries[0].exercise_id!, exercises, text, true));
				entries[0] = settled;
			}
			// Exercise known but a number missing: ask for it instead of inventing it (CLAUDE.md §6).
			if (entries.some((e) => e.load_kg === null)) return askFor('¿Con cuánto peso?');
			if (entries.some((e) => e.reps.length === 0)) return askFor('¿Cuántas series y repeticiones?');
			// The load must be a number they said. Claude sometimes adds both sides up ("30 a cada lado" → 60).
			const said = numbersIn(text);
			for (const e of entries) {
				const load = e.load_kg!;
				if (said.includes(load)) continue;
				if (said.includes(load / 2)) e.load_kg = load / 2;
				else return askFor('¿Con cuánto peso?');
			}
			return { intent: 'log', entries, ambiguity: null, reply: null };
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

type Entry = ParseResponse['entries'][number];

/**
 * Nets on which exercise a single-exercise phrase is (decided with Jason, 2 oct 2026):
 * - The phrase, without numbers, is exactly a name or alias of one of their exercises (one they taught
 *   the app by choosing it): that exercise, without asking, whatever Claude picked.
 * - Claude picked X, but the phrase also holds every word of a name or alias of another exercise Y,
 *   and that alias of Y isn't contained in one of X's that fits too: it could be either, so ask
 *   ('ask'). Never merge two histories on a guess ("tríceps en polea con barra en v por detrás de la
 *   cabeza" fits both the barra V pushdown and the tras-nuca one).
 */
function settleByWords(entry: Entry, exercises: readonly ContextExercise[], text: string): Entry | 'ask' {
	const phrase = phraseToAlias(text);
	const exact = phrase ? exercises.filter((e) => [e.name, ...e.aliases].some((n) => normalizeName(n) === phrase)) : [];
	if (exact.length === 1) return { ...entry, exercise_id: exact[0].id, new_exercise: null };
	if (entry.exercise_id === null) return entry;
	return rivalsOf(entry.exercise_id, exercises, text, false).length > 0 ? 'ask' : entry;
}

/**
 * The other exercises the phrase fits as well as `chosenId` (see settleByWords). With `withChosen`,
 * the chosen one first and then its rivals: the options of the question.
 */
export function rivalsOf(chosenId: string, exercises: readonly ContextExercise[], text: string, withChosen: boolean): ContextExercise[] {
	const said = new Set(significantWords(text));
	const fitting = (e: ContextExercise) =>
		[e.name, ...e.aliases].map((n) => significantWords(n)).filter((w) => w.length > 0 && w.every((x) => said.has(x)));
	const chosen = exercises.find((e) => e.id === chosenId);
	if (!chosen) return [];
	const chosenFits = fitting(chosen);
	const within = (small: string[], big: string[]) => small.every((w) => big.includes(w));
	const rivals = exercises.filter(
		(e) => e.id !== chosenId && fitting(e).some((words) => !chosenFits.some((own) => within(words, own))),
	);
	return withChosen ? [chosen, ...rivals] : rivals;
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

/** Their exercises whose name or an alias is exactly this name, once normalized (no fuzzy matching). */
function exactlyNamed(name: string, exercises: readonly ContextExercise[]): ContextExercise[] {
	const key = normalizeName(name);
	return exercises.filter((e) => [e.name, ...e.aliases].some((n) => normalizeName(n) === key));
}

function whichOf(candidates: readonly ContextExercise[]): ParseResponse {
	return {
		intent: 'ambiguous',
		entries: [],
		ambiguity: { question: '¿Cuál de estos?', options: candidates.slice(0, MAX_OPTIONS).map((e) => ({ exercise_id: e.id, label: e.name })) },
		reply: null,
	};
}

/** Every number written in the text: "7,5" and "7.5" are 7.5. */
export function numbersIn(text: string): number[] {
	return [...text.matchAll(/\d+(?:[.,]\d+)?/g)].map((m) => Number(m[0].replace(',', '.')));
}
