import { useEffect, useRef, useState } from 'react';

import { takeMachinePhoto } from '@/services/image';
import { speech } from '@/services/speech';
import { copy } from '@/ui/copy';

import { createDictation } from './dictation';

interface Options {
  /** Sends what's in the input, with the attached photo. */
  send(text: string, photo: string | null): void;
  /** What's heard while dictating goes into the input. */
  setText(text: string): void;
  /** Their exercise names, so the recognizer gets them right. */
  hints: readonly string[];
}

/**
 * The input's extras (M7, design/photo.html): the photo of a machine attached until it's sent (the ×
 * removes it), and dictation into the input, to review before sending. `notice` says why the mic or the
 * camera can't work (no permission), until the next try.
 */
export function useComposer({ send, setText, hints }: Options) {
  const [photo, setPhoto] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const latest = useRef({ setText, hints });
  latest.current = { setText, hints };

  const dictation = useRef(
    createDictation(speech, {
      listening: setListening,
      text: (t) => latest.current.setText(t),
      failed: (e) => setNotice(e === 'permission' ? copy.session.micPermission : copy.session.micUnavailable),
    }),
  ).current;

  // Leaving the screen stops listening without sending.
  useEffect(() => () => dictation.cancel(), [dictation]);

  return {
    photo,
    listening,
    notice,
    /** The camera button: take (or retake) the machine's photo. */
    takePhoto: async () => {
      setNotice(null);
      const result = await takeMachinePhoto();
      if (result && 'error' in result) setNotice(copy.session.cameraPermission);
      else if (result) setPhoto(result.uri);
    },
    removePhoto: () => setPhoto(null),
    /** "Deshacer": the photo of the undone message, back in the input. */
    restorePhoto: (uri: string | null) => setPhoto(uri),
    /** The mic: start dictating, or stop. */
    toggleMic: () => {
      setNotice(null);
      void dictation.toggle(latest.current.hints);
    },
    /** The send button (or return): text and photo together. */
    submit: (text: string) => {
      if (!text.trim() && !photo) return;
      send(text, photo);
      setPhoto(null);
    },
  };
}
