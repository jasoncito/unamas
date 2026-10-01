import type { SpeechError, SpeechService } from '@/services/speech';

/** Silence after the last word that ends the dictation and sends it (decided with Jason). */
export const SILENCE_MS = 1500;

export interface DictationEvents {
  /** Listening started or stopped: the mic shows it. */
  listening(on: boolean): void;
  /** What's heard so far, into the input. */
  text(text: string): void;
  /** They stopped talking (or tapped the mic again): send it. */
  done(text: string): void;
  /** No permission or no recognizer. ("no-speech" is not an error: nothing is sent.) */
  failed(e: Exclude<SpeechError, 'no-speech' | 'other'>): void;
}

/**
 * Dictation (CLAUDE.md §8, M7): tap the mic, talk, and it sends itself after SILENCE_MS without new
 * words; tapping again sends right away.
 */
export function createDictation(service: SpeechService, events: DictationEvents, silenceMs = SILENCE_MS) {
  let active = false;
  let heard = '';
  let silence: ReturnType<typeof setTimeout> | undefined;

  const finish = () => {
    clearTimeout(silence);
    if (!active) return;
    active = false;
    events.listening(false);
    const text = heard.trim();
    heard = '';
    if (text) events.done(text);
  };

  return {
    get active() {
      return active;
    },
    /** The mic: starts listening, or stops and sends what was heard. */
    async toggle(hints: readonly string[]) {
      if (active) return service.stop(); // the recognizer ends → finish
      active = true;
      heard = '';
      events.listening(true);
      const started = await service.start(hints, {
        text(text) {
          if (!active) return;
          heard = text;
          events.text(text);
          clearTimeout(silence);
          silence = setTimeout(() => service.stop(), silenceMs);
        },
        end: finish,
        error(e) {
          if (e === 'permission' || e === 'unavailable') events.failed(e);
        },
      });
      if (!started) {
        active = false;
        events.listening(false);
      }
    },
    /** Leaving the screen: stop without sending. */
    cancel() {
      if (!active) return;
      clearTimeout(silence);
      active = false;
      heard = '';
      service.abort();
      events.listening(false);
    },
  };
}
