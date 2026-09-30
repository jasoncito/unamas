import { randomUUID } from 'expo-crypto';

/** Every row id is a UUID v4, so two users or two phones never collide (MULTIUSER.md §3). */
export function newId(): string {
  return randomUUID();
}

/** Client timestamp for created_at / updated_at. */
export function nowIso(): string {
  return new Date().toISOString();
}
