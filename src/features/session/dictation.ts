import type { SpeechError, SpeechService } from '@/services/speech';

export interface DictationEvents {
  /** Listening started or stopped: the mic shows it. */
  listening(on: boolean): void;
  /** What's heard so far, into the input. */
  text(text: string): void;
  /** No permission or no recognizer. ("no-speech" is not an error: nothing changes.) */
  failed(e: Exclude<SpeechError, 'no-speech' | 'other'>): void;
}

/**
 * Dictation (CLAUDE.md §8, M7; decided with Jason): tap the mic and talk; what's heard goes into the
 * input to review. Tapping the mic again only stops listening (so does the recognizer, after a pause).
 * Never sends: they send with the button.
 */
export function createDictation(service: SpeechService, events: DictationEvents) {
  let active = false;

  const stopped = () => {
    if (!active) return;
    active = false;
    events.listening(false);
  };

  return {
    get active() {
      return active;
    },
    /** The mic: starts listening, or stops. */
    async toggle(hints: readonly string[]) {
      if (active) return service.stop(); // the recognizer ends → stopped
      active = true;
      events.listening(true);
      const started = await service.start(hints, {
        text(text) {
          if (active) events.text(text);
        },
        end: stopped,
        error(e) {
          if (e === 'permission' || e === 'unavailable') events.failed(e);
        },
      });
      if (!started) stopped();
    },
    /** Leaving the screen: stop listening and drop what's still on its way. */
    cancel() {
      if (!active) return;
      service.abort();
      stopped();
    },
  };
}
