import { getLocales } from 'expo-localization';
import { ExpoSpeechRecognitionModule } from 'expo-speech-recognition';

/** Fallbacks when the phone isn't in a Spanish the recognizer knows (the app is in Spanish). */
const SPANISH_FALLBACKS = ['es-419', 'es-US', 'es-MX', 'es-ES'];

const norm = (tag: string) => tag.replace('_', '-').toLowerCase();

/**
 * The recognizer's language (decided with Jason: the phone's). The first of the phone's languages that
 * is Spanish and supported; else Latin American Spanish, or any Spanish the recognizer has.
 */
export function chooseSpeechLocale(phone: readonly string[], supported: readonly string[]): string {
  const byNorm = new Map(supported.map((s) => [norm(s), s]));
  for (const tag of phone) {
    if (norm(tag).startsWith('es') && byNorm.has(norm(tag))) return byNorm.get(norm(tag))!;
  }
  for (const tag of SPANISH_FALLBACKS) if (byNorm.has(norm(tag))) return byNorm.get(norm(tag))!;
  return supported.find((s) => norm(s).startsWith('es')) ?? 'es-419';
}

export type SpeechError = 'permission' | 'no-speech' | 'unavailable' | 'other';

/** What dictation needs from the recognizer; tests pass a fake. */
export interface SpeechService {
  /** Starts listening. False if it can't (no permission, no recognizer). */
  start(
    hints: readonly string[],
    on: { text(text: string, final: boolean): void; end(): void; error(e: SpeechError): void },
  ): Promise<boolean>;
  /** Stops and delivers what was heard. */
  stop(): void;
  /** Stops and drops it. */
  abort(): void;
}

let locale: string | null = null;

export const speech: SpeechService = {
  async start(hints, on) {
    if (!ExpoSpeechRecognitionModule.isRecognitionAvailable()) {
      on.error('unavailable');
      return false;
    }
    const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
    if (!permission.granted) {
      on.error('permission');
      return false;
    }
    locale ??= chooseSpeechLocale(
      getLocales().map((l) => l.languageTag),
      (await ExpoSpeechRecognitionModule.getSupportedLocales({})).locales,
    );

    const subs = [
      ExpoSpeechRecognitionModule.addListener('result', (e) => on.text(e.results[0]?.transcript ?? '', e.isFinal)),
      ExpoSpeechRecognitionModule.addListener('error', (e) => {
        on.error(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'permission' : e.error === 'no-speech' ? 'no-speech' : 'other');
      }),
      ExpoSpeechRecognitionModule.addListener('end', () => {
        subs.forEach((s) => s.remove());
        on.end();
      }),
    ];
    ExpoSpeechRecognitionModule.start({
      lang: locale,
      interimResults: true,
      continuous: false,
      addsPunctuation: false,
      // Their exercise names, so "jalón" or "Smith" come out right.
      contextualStrings: hints.slice(0, 100),
      iosTaskHint: 'dictation',
    });
    return true;
  },
  stop: () => ExpoSpeechRecognitionModule.stop(),
  abort: () => ExpoSpeechRecognitionModule.abort(),
};
