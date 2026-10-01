-- Muscle groups as language-neutral keys (shared/muscleGroups.ts; decided with Jason, 1 oct 2026).
-- Same mapping and order as the app's SQLite migration v5. updated_at moves forward so the change
-- wins on every phone (last write wins). Custom groups stay as they were typed.
update public.exercise
set muscle_groups = (
      select jsonb_agg(case g when 'pecho' then 'chest' when 'espalda' then 'back' when 'bíceps' then 'biceps' when 'tríceps' then 'triceps' when 'hombro' then 'shoulders' when 'pierna' then 'legs' when 'glúteo' then 'glutes' when 'pantorrilla' then 'calves' else g end order by ord)
      from jsonb_array_elements_text(muscle_groups) with ordinality as t(g, ord)
    ),
    updated_at = now()
where muscle_groups ?| array['pecho', 'espalda', 'bíceps', 'tríceps', 'hombro', 'pierna', 'glúteo', 'pantorrilla'];

update public.session
set muscle_groups = (
      select jsonb_agg(case g when 'pecho' then 'chest' when 'espalda' then 'back' when 'bíceps' then 'biceps' when 'tríceps' then 'triceps' when 'hombro' then 'shoulders' when 'pierna' then 'legs' when 'glúteo' then 'glutes' when 'pantorrilla' then 'calves' else g end order by ord)
      from jsonb_array_elements_text(muscle_groups) with ordinality as t(g, ord)
    ),
    updated_at = now()
where muscle_groups ?| array['pecho', 'espalda', 'bíceps', 'tríceps', 'hombro', 'pierna', 'glúteo', 'pantorrilla'];
