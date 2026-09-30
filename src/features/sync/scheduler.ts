export interface SyncScheduler {
  /** Sync now. If one is running, it runs once more when it ends (so nothing written meanwhile waits). */
  now(): Promise<void>;
  /** Sync a few seconds from now; calls in between collapse into one (after each saved entry). */
  soon(): void;
  dispose(): void;
}

/**
 * Decides when `run` (a sync) happens: never two at once, never blocking the caller, errors
 * swallowed (no signal is normal; the next trigger retries). MULTIUSER.md §4 "Cuándo".
 */
export function createSyncScheduler(
  run: () => Promise<void>,
  { debounceMs = 3000, onError }: { debounceMs?: number; onError?: (e: unknown) => void } = {},
): SyncScheduler {
  let running: Promise<void> | null = null;
  let again = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const now = (): Promise<void> => {
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      do {
        again = false;
        try {
          await run();
        } catch (e) {
          onError?.(e);
        }
      } while (again);
    })().finally(() => {
      running = null;
    });
    return running;
  };

  return {
    now,
    soon() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void now();
      }, debounceMs);
    },
    dispose() {
      if (timer) clearTimeout(timer);
    },
  };
}
