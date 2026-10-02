'use client';
import { Mic, Square } from 'lucide-react';
import { Button } from '@if/ui';
import type { DictationState } from './use-dictation';

/** Microphone toggle. Disabled with an explanation where the browser has no speech recognition. */
export function VoiceButton({
  state,
  onStart,
  onStop,
}: {
  state: DictationState;
  onStart: () => void;
  onStop: () => void;
}) {
  if (state === 'unsupported') {
    return (
      <Button
        type="button"
        variant="secondary"
        size="icon"
        disabled
        aria-label="Voice input is not available in this browser"
        title="Voice input needs Chrome or Edge. You can type instead."
      >
        <Mic className="size-5" aria-hidden="true" />
      </Button>
    );
  }
  const listening = state === 'listening';
  return (
    <Button
      type="button"
      variant={listening ? 'primary' : 'secondary'}
      size="icon"
      aria-pressed={listening}
      aria-label={listening ? 'Stop voice input' : 'Start voice input'}
      title={listening ? 'Stop listening' : 'Speak instead of typing'}
      onClick={listening ? onStop : onStart}
    >
      {listening ? (
        <Square className="size-4" aria-hidden="true" />
      ) : (
        <Mic className="size-5" aria-hidden="true" />
      )}
    </Button>
  );
}

/** Live status line under a text box: what is being heard, or why dictation failed. */
export function VoiceStatus({
  state,
  interim,
  error,
  className = '',
}: {
  state: DictationState;
  interim: string;
  error: string | null;
  className?: string;
}) {
  return (
    <p
      role="status"
      aria-live="polite"
      className={`text-sm empty:sr-only ${className} ${error ? 'font-medium text-error' : 'text-text-muted'}`}
    >
      {error ?? (state === 'listening' ? (interim ? `Hearing: ${interim}` : 'Listening… speak now.') : '')}
    </p>
  );
}
