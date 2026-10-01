-- "Fácil" / 3+ reps in reserve, as /parse returns it (PROGRESSION.md §6). The phone stores 0/1; sync
-- sends a boolean.
alter table public.entry add column easy boolean not null default false;
