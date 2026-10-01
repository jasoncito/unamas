// Muscle groups as language-neutral keys (shared/muscleGroups.ts, decided with Jason on 1 oct 2026):
// the Spanish names stored before become keys, in the same order. Changed rows go up again (dirty),
// so the server and other phones get the keys too. Custom groups stay as they were typed.
export const v5 = {
  version: 5,
  sql: `
UPDATE exercise SET
  muscle_groups = (SELECT json_group_array(g) FROM (SELECT CASE value WHEN 'pecho' THEN 'chest' WHEN 'espalda' THEN 'back' WHEN 'bíceps' THEN 'biceps' WHEN 'tríceps' THEN 'triceps' WHEN 'hombro' THEN 'shoulders' WHEN 'pierna' THEN 'legs' WHEN 'glúteo' THEN 'glutes' WHEN 'pantorrilla' THEN 'calves' ELSE value END AS g FROM json_each(exercise.muscle_groups) ORDER BY key)),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  dirty = 1
WHERE EXISTS (SELECT 1 FROM json_each(exercise.muscle_groups) WHERE value IN ('pecho', 'espalda', 'bíceps', 'tríceps', 'hombro', 'pierna', 'glúteo', 'pantorrilla'));
UPDATE session SET
  muscle_groups = (SELECT json_group_array(g) FROM (SELECT CASE value WHEN 'pecho' THEN 'chest' WHEN 'espalda' THEN 'back' WHEN 'bíceps' THEN 'biceps' WHEN 'tríceps' THEN 'triceps' WHEN 'hombro' THEN 'shoulders' WHEN 'pierna' THEN 'legs' WHEN 'glúteo' THEN 'glutes' WHEN 'pantorrilla' THEN 'calves' ELSE value END AS g FROM json_each(session.muscle_groups) ORDER BY key)),
  updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
  dirty = 1
WHERE EXISTS (SELECT 1 FROM json_each(session.muscle_groups) WHERE value IN ('pecho', 'espalda', 'bíceps', 'tríceps', 'hombro', 'pierna', 'glúteo', 'pantorrilla'));
`,
};
