'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

/** Minimal shape of the browser Web Speech API (not in TypeScript's DOM lib). */
interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

export type DictationState = 'unsupported' | 'idle' | 'listening';

const ERROR_TEXT: Record<string, string> = {
  'not-allowed': 'Microphone access was blocked. Allow the microphone for this site, or type instead.',
  'service-not-allowed': 'Speech recognition is not allowed in this browser. Type instead.',
  'no-speech': 'No speech was heard. Try again, or type instead.',
  'audio-capture': 'No microphone was found. Type instead.',
  network: 'Speech recognition needs an internet connection. Type instead.',
};

function ctor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Speech-to-text using the browser's own recogniser. Spoken words are handed to `onFinal` as text for the
 * person to read and edit; nothing is ever sent automatically. In Chrome and Edge the browser itself sends
 * audio to its vendor's speech service - the portal never receives or stores audio.
 */
export function useDictation(onFinal: (text: string) => void, lang = 'en-AU') {
  const [state, setState] = useState<DictationState>('idle');
  const [interim, setInterim] = useState('');
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const cb = useRef(onFinal);
  cb.current = onFinal;

  // Decided after mount so server and first client render agree.
  useEffect(() => {
    if (!ctor()) setState('unsupported');
    return () => rec.current?.abort();
  }, []);

  const stop = useCallback(() => rec.current?.stop(), []);

  const start = useCallback(() => {
    const C = ctor();
    if (!C) return;
    setError(null);
    setInterim('');
    const r = new C();
    r.lang = lang;
    r.continuous = false;
    r.interimResults = true;
    r.onresult = (e) => {
      let live = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) cb.current(res[0].transcript.trim());
        else live += res[0].transcript;
      }
      setInterim(live);
    };
    r.onerror = (e) => {
      if (e.error !== 'aborted') setError(ERROR_TEXT[e.error] ?? 'Speech recognition stopped. Type instead.');
    };
    r.onend = () => {
      rec.current = null;
      setInterim('');
      setState('idle');
    };
    rec.current = r;
    try {
      r.start();
      setState('listening');
    } catch {
      rec.current = null;
      setError('Speech recognition could not start. Type instead.');
    }
  }, [lang]);

  return { state, interim, error, start, stop };
}

/** Appends spoken text to what is already typed, with one space between. */
export function appendSpoken(current: string, spoken: string): string {
  if (!spoken) return current;
  return current && !/\s$/.test(current) ? `${current} ${spoken}` : `${current}${spoken}`;
}
