/**
 * Per-user client workspace isolation.
 *
 * Browser progress (IndexedDB / localStorage) must never be shared across accounts
 * on the same device. Bind on sign-in; reset in-memory state on switch/sign-out.
 * User-scoped keys are preserved across sessions so deploys and re-logins keep data.
 */

import { PERSIST_KEY, SETTINGS_STORAGE_KEY } from "@/lib/client-persistence";
import {
  purgePersistKeys,
  setIdbPersistUserId,
} from "@/lib/idb-persist-storage";

/** Bases that must be keyed by auth user id. */
export const WORKSPACE_STORAGE_BASES = {
  progress: PERSIST_KEY,
  certifications: "SupraBase.certifications.v1",
  notifications: "SupraBase.notifications.v2",
  hubLibrary: "SupraBase.developer-hub.library",
  settings: SETTINGS_STORAGE_KEY,
  celebratedWeeks: "SupraBase.celebrated-weeks.v1",
} as const;

const LEGACY_UNSCOPED_KEYS = [
  PERSIST_KEY,
  "prathyu-academy-v2",
  "prathyu-academy-v3",
  "SupraBase.certifications.v1",
  "supralearn.certifications.v1",
  "SupraBase.notifications.v2",
  "SupraBase.notifications.v1",
  "SupraBase.developer-hub.library",
  SETTINGS_STORAGE_KEY,
  "prathyu-celebrated-weeks",
] as const;

let activeUserId: string | null = null;
const listeners = new Set<(userId: string | null) => void>();

export function getActiveWorkspaceUserId(): string | null {
  return activeUserId;
}

export function scopedWorkspaceKey(
  base: string,
  userId: string | null = activeUserId
): string | null {
  if (!userId) return null;
  return `${base}:${userId}`;
}

export function subscribeWorkspaceChange(
  listener: (userId: string | null) => void
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(userId: string | null) {
  listeners.forEach((listener) => {
    try {
      listener(userId);
    } catch {
      /* ignore listener errors */
    }
  });
}

/** Delete device-global demo/shared keys so they cannot leak into a new account. */
export async function purgeLegacyUnscopedClientData(): Promise<void> {
  await purgePersistKeys(LEGACY_UNSCOPED_KEYS);
}

export type ClientWorkspaceReset = () => void;

let progressReset: ClientWorkspaceReset | null = null;
let progressRehydrate: (() => Promise<void>) | null = null;

/** Registered by the progress store so logout/switch can wipe in-memory state. */
export function registerProgressWorkspaceReset(reset: ClientWorkspaceReset) {
  progressReset = reset;
}

/** Rehydrate the scoped persist bucket after persistUserId is set. */
export function registerProgressWorkspaceRehydrate(fn: () => Promise<void>) {
  progressRehydrate = fn;
}

/**
 * Bind all client persistence to the authenticated user.
 * Rehydrates that user's bucket; never copies unscoped legacy data.
 * Does not wipe in-memory state on first bind after reload — that would
 * persist an empty snapshot over the user's cache before the server fetch.
 */
export async function bindClientWorkspace(userId: string): Promise<void> {
  if (typeof window === "undefined") return;
  if (!userId) return;

  if (activeUserId === userId) {
    return;
  }

  const previousUserId = activeUserId;

  // Purge shared keys before scoping so they never migrate into a user bucket.
  await purgeLegacyUnscopedClientData();

  activeUserId = userId;
  setIdbPersistUserId(userId);

  if (previousUserId && previousUserId !== userId) {
    progressReset?.();
  }

  await progressRehydrate?.();
  notify(userId);
}

/** Clear in-memory workspace on sign-out. Persisted per-user buckets stay intact. */
export async function clearClientWorkspace(): Promise<void> {
  if (typeof window === "undefined") return;
  activeUserId = null;
  setIdbPersistUserId(null);
  progressReset?.();
  await purgeLegacyUnscopedClientData();
  notify(null);
}
