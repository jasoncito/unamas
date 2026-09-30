-- Last write wins on the server too (docs/MULTIUSER.md §4). Sync uploads before it downloads, so a
-- phone holding an older unsynced edit would overwrite a newer one. A write whose updated_at is
-- older than the stored row's is ignored; server_updated_at still moves forward, so that phone
-- downloads the winning row on its next pull.
create or replace function public.set_server_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.updated_at < old.updated_at then
    new := old;
  end if;
  new.server_updated_at := now();
  return new;
end;
$$;
