import type { SpeechError, SpeechService } from '@/services/speech';
import { chooseSpeechLocale } from '@/services/speech';

import { createDictation } from './dictation';

jest.mock('expo-speech-recognition', () => ({ ExpoSpeechRecognitionModule: {} }));
jest.mock('expo-localization', () => ({ getLocales: () => [] }));

/** A recognizer driven by the test: say(), then the end the real one sends after stop(). */
function fakeSpeech(startOk = true) {
  let on: Parameters<SpeechService['start']>[1] | null = null;
  const calls: string[] = [];
  const service: SpeechService = {
    async start(hints, handlers) {
      calls.push(`start:${hints.join('|')}`);
      on = handlers;
      return startOk;
    },
    stop() {
      calls.push('stop');
      on?.end();
    },
    abort() {
      calls.push('abort');
    },
  };
  return {
    service,
    calls,
    say: (text: string, final = false) => on!.text(text, final),
    fail: (e: SpeechError) => on!.error(e),
    end: () => on!.end(),
  };
}

function setup(startOk = true) {
  const speech = fakeSpeech(startOk);
  const log: string[] = [];
  const d = createDictation(speech.service, {
    listening: (on) => log.push(on ? 'listening' : 'idle'),
    text: (t) => log.push(`text:${t}`),
    done: (t) => log.push(`send:${t}`),
    failed: (e) => log.push(`failed:${e}`),
  });
  return { d, speech, log };
}

describe('dictation', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('what is heard goes into the input, and 1.5 s of silence sends it', async () => {
    const { d, speech, log } = setup();
    await d.toggle(['Press de hombro']);
    speech.say('press de hombro');
    jest.advanceTimersByTime(1000);
    speech.say('press de hombro 24 4 de 9');
    jest.advanceTimersByTime(1499);
    expect(log).not.toContain('send:press de hombro 24 4 de 9');
    jest.advanceTimersByTime(1);
    expect(log).toEqual(['listening', 'text:press de hombro', 'text:press de hombro 24 4 de 9', 'idle', 'send:press de hombro 24 4 de 9']);
    expect(speech.calls).toEqual(['start:Press de hombro', 'stop']);
  });

  it('tapping the mic again sends right away', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.say('laterales 7,5 4 de 11');
    await d.toggle([]);
    expect(log.at(-1)).toBe('send:laterales 7,5 4 de 11');
    expect(d.active).toBe(false);
  });

  it('the recognizer ends on its own (iOS final result): sent once', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.say('remo 40 3 de 10', true);
    speech.end();
    jest.advanceTimersByTime(2000);
    expect(log.filter((l) => l.startsWith('send'))).toEqual(['send:remo 40 3 de 10']);
  });

  it('nothing said: nothing sent', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.fail('no-speech');
    speech.end();
    expect(log).toEqual(['listening', 'idle']);
  });

  it('no permission: it says so and stops listening', async () => {
    const { d, speech, log } = setup(false);
    await d.toggle([]);
    expect(log).toEqual(['listening', 'idle']);
    expect(d.active).toBe(false);
    void speech;
  });

  it('a permission error while listening is reported', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.fail('permission');
    expect(log).toContain('failed:permission');
  });

  it('leaving the screen: stops without sending', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.say('press 24');
    d.cancel();
    jest.advanceTimersByTime(2000);
    expect(log).toEqual(['listening', 'text:press 24', 'idle']);
    expect(speech.calls).toContain('abort');
  });
});

describe('chooseSpeechLocale (decided with Jason: the phone’s language)', () => {
  const ios = ['en-US', 'es-ES', 'es-MX', 'es-US', 'es-CL', 'es-CO', 'es-419'];

  it('the phone’s Spanish, if the recognizer has it', () => {
    expect(chooseSpeechLocale(['es-MX', 'en-US'], ios)).toBe('es-MX');
  });

  it('a Spanish it doesn’t have (es-EC): Latin American Spanish', () => {
    expect(chooseSpeechLocale(['es-EC'], ios)).toBe('es-419');
  });

  it('the phone in English: still Spanish, the app’s language', () => {
    expect(chooseSpeechLocale(['en-US'], ios)).toBe('es-419');
  });

  it('underscores and case don’t matter; without es-419, the next fallback', () => {
    expect(chooseSpeechLocale(['es_us'], ['es-US', 'es-ES'])).toBe('es-US');
    expect(chooseSpeechLocale(['es-EC'], ['es_MX', 'es_ES'])).toBe('es_MX');
  });

  it('a second Spanish in the phone’s list counts', () => {
    expect(chooseSpeechLocale(['en-US', 'es-CL'], ios)).toBe('es-CL');
  });
});
