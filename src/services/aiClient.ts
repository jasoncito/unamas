import { ensureSession } from './auth';
import { AiUnavailableError, workerAi, type AiService } from './ai';
import { supabase } from './supabase';

const apiUrl = process.env.EXPO_PUBLIC_API_URL;

/**
 * The app's /parse, with the Supabase session's access token (creating the anonymous account the
 * first time). Without EXPO_PUBLIC_API_URL or Supabase every message stays pending, as with no signal.
 */
export const ai: AiService =
  apiUrl && supabase
    ? workerAi(apiUrl.replace(/\/$/, ''), async () => {
        const client = supabase!;
        if (!(await ensureSession(client.auth))) return null;
        const { data } = await client.auth.getSession();
        return data.session?.access_token ?? null;
      })
    : {
        parse: async () => {
          throw new AiUnavailableError('EXPO_PUBLIC_API_URL or Supabase not configured');
        },
      };
