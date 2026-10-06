'use client';
import { Bot, Send, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api-client';
import { message as problem } from '@/components/contract/b5-shared';

interface Reply {
  answer: string;
  bullets: string[];
  actions: Array<{ label: string; href: string }>;
  followUps: string[];
  model: string;
}
interface Turn {
  from: 'you' | 'ai';
  text: string;
  reply?: Reply;
}
const KEY = 'if-ask-ai';
const START = [
  'What needs my attention?',
  'How does the workflow work?',
  'Who can approve a plan?',
  'Anything I should fix?',
];

/** The "Ask AI" button at the bottom right of every page, and the conversation it opens (FR-X01). */
export function AskAi({ csrf, supplier = false }: { csrf: string; supplier?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(KEY);
      if (saved) setTurns(JSON.parse(saved) as Turn[]);
    } catch {
      /* a private window can refuse storage; the chat still works */
    }
  }, []);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(turns.slice(-30)));
    } catch {
      /* ignore */
    }
    end.current?.scrollIntoView?.({ block: 'end' });
  }, [turns, open]);
  useEffect(() => {
    if (!open) return;
    input.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  async function ask(q: string) {
    const t = q.trim();
    if (!t || busy) return;
    setText('');
    setError(null);
    setTurns((x) => [...x, { from: 'you', text: t }]);
    setBusy(true);
    try {
      const r = await api<Reply>('/assistant/chat', {
        method: 'POST',
        csrf,
        body: { message: t, page: path },
      });
      setTurns((x) => [...x, { from: 'ai', text: r.answer, reply: r }]);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  const starts = supplier
    ? ['How do I respond to a tender?', 'What is a conflict of interest?', 'What can I do here?']
    : START;
  const last = [...turns].reverse().find((t) => t.reply)?.reply;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <section
          role="dialog"
          aria-label="Ask AI assistant"
          data-testid="ask-ai-panel"
          className="flex h-[min(34rem,calc(100vh-7rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-xl"
        >
          <header className="flex items-center gap-2 bg-brand-gradient px-4 py-3 text-white">
            <Bot className="size-5" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-bold leading-tight">Ask AI</h2>
              <p className="text-xs opacity-90">Simulated assistant · answers from the portal's own rules</p>
            </div>
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => setTurns([])}
                className="min-h-[32px] rounded-md px-2 text-xs font-semibold text-white underline"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
              className="flex size-8 items-center justify-center rounded-md hover:bg-white/20"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>
          <div
            className="flex-1 space-y-3 overflow-y-auto p-4"
            aria-live="polite"
            tabIndex={0}
            aria-label="Conversation"
          >
            {turns.length === 0 && (
              <p className="text-sm text-text-muted">
                Hello. Ask me how the portal works, who can approve what, what needs your attention, or what
                you should fix. I can also take you to a page.
              </p>
            )}
            {turns.map((t, i) =>
              t.from === 'you' ? (
                <p
                  key={i}
                  className="ml-auto max-w-[85%] rounded-lg bg-accent px-3 py-2 text-sm text-accent-fg"
                >
                  {t.text}
                </p>
              ) : (
                <div
                  key={i}
                  className="max-w-[92%] rounded-lg border border-border bg-surface-alt px-3 py-2 text-sm"
                  data-testid="ai-answer"
                >
                  <p>{t.text}</p>
                  {t.reply && t.reply.bullets.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {t.reply.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {t.reply && t.reply.actions.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-2">
                      {t.reply.actions.slice(0, 6).map((a) => (
                        <Link
                          key={a.href + a.label}
                          href={a.href}
                          onClick={() => setOpen(false)}
                          className="rounded-full border border-accent px-3 py-1 text-xs font-semibold text-accent no-underline hover:bg-accent/10"
                        >
                          {a.label}
                        </Link>
                      ))}
                    </p>
                  )}
                </div>
              ),
            )}
            {busy && <p className="text-sm text-text-muted">Thinking…</p>}
            {error && (
              <p role="alert" className="text-sm font-medium text-error">
                {error}
              </p>
            )}
            <div ref={end} />
          </div>
          <div className="flex flex-wrap gap-2 border-t border-border px-4 pt-3">
            {(last?.followUps?.length ? last.followUps : starts).slice(0, 4).map((s) => (
              <button
                key={s}
                type="button"
                disabled={busy}
                onClick={() => void ask(s)}
                className="rounded-full border border-border-strong px-3 py-1 text-xs font-semibold text-text hover:bg-surface-alt disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void ask(text);
            }}
          >
            <label className="sr-only" htmlFor="ask-ai-input">
              Your question
            </label>
            <input
              id="ask-ai-input"
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={500}
              placeholder="Ask about the portal…"
              className="min-h-[44px] min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-sm"
            />
            <button
              type="submit"
              aria-label="Send"
              disabled={busy || !text.trim()}
              className="flex size-11 items-center justify-center rounded-md bg-brand-gradient text-white disabled:opacity-50"
            >
              <Send className="size-4" aria-hidden="true" />
            </button>
          </form>
        </section>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="ask-ai-button"
        className="flex min-h-[48px] items-center gap-2 rounded-full bg-brand-gradient px-5 text-sm font-bold text-white shadow-lg hover:brightness-110"
      >
        <Bot className="size-5" aria-hidden="true" />
        Ask AI
      </button>
    </div>
  );
}
