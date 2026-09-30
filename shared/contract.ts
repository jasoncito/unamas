import { z } from 'zod';

// POST /parse contract (CLAUDE.md §6), shared by the app and the Worker. The Worker validates the
// request with it and hands ParseResponse to Claude as the structured-output schema; the app validates
// the response with it and treats anything that doesn't match as `unclear`.

const MUSCLE_GROUP = z.string().min(1).max(40);

// ─── Request ────────────────────────────────────────────────────────────────────────────────────

export const ContextExercise = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(120),
  aliases: z.array(z.string().max(120)).max(20),
  muscle_groups: z.array(MUSCLE_GROUP).max(10),
  last: z
    .object({
      date: z.iso.date(),
      load_kg: z.number().nullable(),
      reps: z.array(z.int()).max(20),
    })
    .nullable(),
});
export type ContextExercise = z.infer<typeof ContextExercise>;

/** ~1 MB JPEG as base64 (the app resizes photos before sending). */
export const MAX_IMAGE_BASE64_CHARS = 1_400_000;

export const ParseRequest = z.object({
  text: z.string().max(1000),
  image: z.base64().max(MAX_IMAGE_BASE64_CHARS).nullable(),
  context: z.object({
    muscle_groups: z.array(MUSCLE_GROUP).max(10),
    exercises: z.array(ContextExercise).max(300),
  }),
});
export type ParseRequest = z.infer<typeof ParseRequest>;

// ─── Response (also the structured-output schema) ───────────────────────────────────────────────
// Only what structured outputs support: no min/max, every object closed, null through .nullable().

export const INTENTS = ['log', 'ambiguous', 'end_session', 'question', 'unclear'] as const;

export const NewExercise = z.object({
  canonical_name: z.string(),
  muscle_groups: z.array(z.string()),
  kind: z.enum(['compound_heavy', 'compound', 'isolation', 'calf']),
  load_basis: z.enum(['per_side', 'per_dumbbell', 'total', 'stack']),
});

export const ParsedEntry = z.object({
  /** Only ids from context.exercises; null when it's a new exercise. */
  exercise_id: z.string().nullable(),
  new_exercise: NewExercise.nullable(),
  load_kg: z.number().nullable(),
  /** One item per set: "4 de 9" → [9, 9, 9, 9]. */
  reps: z.array(z.int()),
  /** What the user said about effort, verbatim ("me sobraron 3", "al fallo"), or null. */
  rir_note: z.string().nullable(),
  /** "fácil" or 3+ reps in reserve: lets the engine skip confirm mode (PROGRESSION.md §6). */
  easy: z.boolean(),
});
export type ParsedEntry = z.infer<typeof ParsedEntry>;

export const Ambiguity = z.object({
  question: z.string(),
  options: z.array(z.object({ exercise_id: z.string(), label: z.string() })),
});

export const ParseResponse = z.object({
  intent: z.enum(INTENTS),
  entries: z.array(ParsedEntry),
  ambiguity: Ambiguity.nullable(),
  reply: z.string().nullable(),
});
export type ParseResponse = z.infer<typeof ParseResponse>;

export const UNCLEAR: ParseResponse = { intent: 'unclear', entries: [], ambiguity: null, reply: null };
