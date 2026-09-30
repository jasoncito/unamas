/**
 * Current user. Until M2b there is no Supabase session, so every local row belongs to a fixed
 * provisional id. M2b replaces this with the anonymous session's user id (MULTIUSER.md §2).
 */
export const PROVISIONAL_USER_ID = '00000000-0000-4000-8000-000000000000';

export function useUserId(): string {
  return PROVISIONAL_USER_ID;
}
