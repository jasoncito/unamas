import type { SupabaseClient } from '@supabase/supabase-js';

import { TABLES, type RemoteRow, type RemoteStore } from '@/data/sync';

/** RemoteStore over Supabase (PostgREST). RLS limits every query to the signed-in user's rows. */
export function supabaseRemote(client: SupabaseClient): RemoteStore {
  return {
    async upsert(table, rows) {
      const { error } = await client.from(table).upsert(rows, { onConflict: 'id' });
      if (error) throw error;
    },
    async pull(table, after, limit) {
      const columns = [...TABLES[table].columns, 'server_updated_at'].join(',');
      let query = client.from(table).select(columns);
      // The timestamp goes back exactly as the server sent it (microseconds), quoted for the filter syntax.
      query =
        after.id === ''
          ? query.gte('server_updated_at', after.at)
          : query.or(
              `server_updated_at.gt."${after.at}",and(server_updated_at.eq."${after.at}",id.gt.${after.id})`,
            );
      const { data, error } = await query.order('server_updated_at').order('id').limit(limit);
      if (error) throw error;
      return data as unknown as RemoteRow[];
    },
  };
}
