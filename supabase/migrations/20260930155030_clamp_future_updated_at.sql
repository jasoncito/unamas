-- updated_at comes from the phone's clock, so a phone running ahead would always win last write wins
-- (docs/MULTIUSER.md §4). The server accepts at most 5 minutes of skew: anything later becomes now().
-- Clamping happens before the comparison, on inserts and updates alike.
create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.updated_at > now() + interval '5 minutes' then
    new.updated_at := now();
  end if;
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    new := old;
  end if;
  new.server_updated_at := now();
  return new;
end;
$$;
