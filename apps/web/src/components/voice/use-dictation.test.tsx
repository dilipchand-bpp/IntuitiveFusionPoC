// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { appendSpoken, useDictation } from './use-dictation';

type Handlers = {
  onresult?: (e: unknown) => void;
  onerror?: (e: { error: string }) => void;
  onend?: () => void;
};
let current: (Handlers & { started: boolean }) | null = null;

function install() {
  class Fake {
    lang = '';
    continuous = true;
    interimResults = false;
    started = false;
    onresult: Handlers['onresult'];
    onerror: Handlers['onerror'];
    onend: Handlers['onend'];
    constructor() {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      current = this;
    }
    start() {
      this.started = true;
    }
    stop() {
      this.onend?.();
    }
    abort() {}
  }
  (window as unknown as Record<string, unknown>).webkitSpeechRecognition = Fake;
}
const result = (text: string, isFinal: boolean) => ({
  resultIndex: 0,
  results: [{ isFinal, 0: { transcript: text } }],
});

afterEach(() => {
  delete (window as unknown as Record<string, unknown>).webkitSpeechRecognition;
  current = null;
});

describe('appendSpoken', () => {
  it('joins with one space and ignores empty speech', () => {
    expect(appendSpoken('', 'hello')).toBe('hello');
    expect(appendSpoken('hello', 'world')).toBe('hello world');
    expect(appendSpoken('hello ', 'world')).toBe('hello world');
    expect(appendSpoken('hello', '')).toBe('hello');
  });
});

describe('useDictation', () => {
  it('reports unsupported browsers', () => {
    const { result } = renderHook(() => useDictation(vi.fn()));
    expect(result.current.state).toBe('unsupported');
  });

  it('shows interim words, delivers only final text, then returns to idle', () => {
    install();
    const onFinal = vi.fn();
    const { result: hook } = renderHook(() => useDictation(onFinal));
    expect(hook.current.state).toBe('idle');
    act(() => hook.current.start());
    expect(hook.current.state).toBe('listening');
    expect(current?.started).toBe(true);
    expect(current).toMatchObject({ lang: 'en-AU', continuous: false, interimResults: true });
    act(() => current!.onresult!(result('catering for', false)));
    expect(hook.current.interim).toBe('catering for');
    expect(onFinal).not.toHaveBeenCalled();
    act(() => current!.onresult!(result('catering for twelve months ', true)));
    expect(onFinal).toHaveBeenCalledWith('catering for twelve months');
    act(() => current!.onend!());
    expect(hook.current.state).toBe('idle');
    expect(hook.current.interim).toBe('');
  });

  it('turns recogniser errors into plain-language messages', () => {
    install();
    const { result: hook } = renderHook(() => useDictation(vi.fn()));
    act(() => hook.current.start());
    act(() => current!.onerror!({ error: 'not-allowed' }));
    expect(hook.current.error).toMatch(/Microphone access was blocked/);
    act(() => hook.current.start());
    expect(hook.current.error).toBeNull(); // cleared on the next attempt
    act(() => current!.onerror!({ error: 'aborted' }));
    expect(hook.current.error).toBeNull(); // a deliberate stop is not an error
  });

  it('stop ends listening', () => {
    install();
    const { result: hook } = renderHook(() => useDictation(vi.fn()));
    act(() => hook.current.start());
    act(() => hook.current.stop());
    expect(hook.current.state).toBe('idle');
  });
});
