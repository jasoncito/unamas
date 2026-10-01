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
    failed: (e) => log.push(`failed:${e}`),
  });
  return { d, speech, log };
}

describe('dictation (decided with Jason: it never sends by itself)', () => {
  it('what is heard goes into the input; silence does not send or stop it', async () => {
    jest.useFakeTimers();
    const { d, speech, log } = setup();
    await d.toggle(['Press de hombro']);
    speech.say('press de hombro');
    speech.say('press de hombro 24 4 de 9');
    jest.advanceTimersByTime(10_000);
    expect(log).toEqual(['listening', 'text:press de hombro', 'text:press de hombro 24 4 de 9']);
    expect(d.active).toBe(true);
    expect(speech.calls).toEqual(['start:Press de hombro']);
    jest.useRealTimers();
  });

  it('tapping the mic again only stops listening; the text stays to review', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.say('laterales 7,5 4 de 11');
    await d.toggle([]);
    expect(log).toEqual(['listening', 'text:laterales 7,5 4 de 11', 'idle']);
    expect(speech.calls).toEqual(['start:', 'stop']);
    expect(d.active).toBe(false);
  });

  it('the recognizer ends on its own after a pause: it just stops listening', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.say('remo 40 3 de 10', true);
    speech.end();
    expect(log).toEqual(['listening', 'text:remo 40 3 de 10', 'idle']);
    expect(d.active).toBe(false);
  });

  it('nothing said: nothing changes', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.fail('no-speech');
    speech.end();
    expect(log).toEqual(['listening', 'idle']);
  });

  it('it can’t start (no permission): it stops listening', async () => {
    const { d, log } = setup(false);
    await d.toggle([]);
    expect(log).toEqual(['listening', 'idle']);
    expect(d.active).toBe(false);
  });

  it('a permission error while listening is reported', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.fail('permission');
    expect(log).toContain('failed:permission');
  });

  it('leaving the screen: stops without waiting for the recognizer', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    speech.say('press 24');
    d.cancel();
    expect(log).toEqual(['listening', 'text:press 24', 'idle']);
    expect(speech.calls).toContain('abort');
  });

  it('words arriving after it stopped are ignored', async () => {
    const { d, speech, log } = setup();
    await d.toggle([]);
    d.cancel();
    speech.say('tarde');
    expect(log).not.toContain('text:tarde');
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
