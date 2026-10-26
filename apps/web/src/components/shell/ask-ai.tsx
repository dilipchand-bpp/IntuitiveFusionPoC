'use client';
import { Send, Sparkles, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { guideFor, parsePageContext } from '@if/shared';
import { AiBadge } from '@if/ui';
import { api } from '@/lib/api-client';
import { message as problem } from '@/components/contract/b5-shared';
import { appendSpoken, useDictation } from '../voice/use-dictation';
import { VoiceButton, VoiceStatus } from '../voice/voice-button';

interface Reply {
  answer: string;
  bullets: string[];
  actions: Array<{ label: string; href: string }>;
  followUps: string[];
  model: string;
  modelLabel?: string;
  modelSimulated?: boolean;
  footer?: string;
  footerNote?: string;
  /** Numbered steps (how to do something, or what to do about a waiting Copilot run). */
  steps?: string[];
  /** Where the answer came from: "From: page guide", "From: this request", "From: policy". */
  from?: string;
  allowed?: boolean;
}
interface Turn {
  from: 'you' | 'ai';
  text: string;
  reply?: Reply;
}
const KEY = 'if-ask-ai';
/** What Ask is told about the page: the path and, where the path has one, the record's id (the server works the type out again). */
export function askContext(path: string | null, gateId?: string) {
  const c = parsePageContext(path);
  if (!c) return undefined;
  return {
    path: c.path,
    ...(c.entityType ? { entityType: c.entityType, entityId: c.entityId } : {}),
    ...(gateId ? { gateId } : {}),
  };
}

/** Questions that fit the page the person is on, so the first thing they see is useful here. */
export function startersFor(path: string | null, supplier: boolean): string[] {
  const c = parsePageContext(path);
  if (supplier) return ['How do I respond to a tender?', 'What is this page?', 'What can I do here?'];
  const out = ['What is this page?', 'What can I do here?'];
  if (c?.entityType === 'copilot-run') out.unshift('What do I do?');
  else if (c?.entityType) out.push('What is the status and who is it waiting for?');
  out.push('How do I create a request?', 'What needs my attention?');
  return out;
}

/** An event other parts of the app send to open Ask with a question about what is on screen (the Copilot "What do I do?" button). */
export const ASK_EVENT = 'if-ask';
export interface AskEventDetail {
  question: string;
  gateId?: string;
  /** Ask about this page instead of the one on screen (for example the Copilot run a list item belongs to). */
  path?: string;
}

/** The "Ask" button at the bottom right of every page, and the conversation it opens (FR-X01). */
export function AskAi({ csrf, supplier = false }: { csrf: string; supplier?: boolean }) {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [text, setText] = useState('');
  const voice = useDictation((spoken) => setText((cur) => appendSpoken(cur, spoken)));
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

  async function ask(q: string, gateId?: string, asPath?: string) {
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
        body: { message: t, page: path, context: askContext(asPath ?? path, gateId) },
      });
      setTurns((x) => [...x, { from: 'ai', text: r.answer, reply: r }]);
    } catch (e) {
      setError(problem(e));
    } finally {
      setBusy(false);
    }
  }
  const starts = startersFor(path, supplier);
  const pageTitle = guideFor(path)?.title ?? null;
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const onAsk = (e: Event) => {
      const d = (e as CustomEvent<AskEventDetail>).detail;
      if (!d?.question) return;
      setOpen(true);
      void askRef.current(d.question, d.gateId, d.path);
    };
    window.addEventListener(ASK_EVENT, onAsk);
    return () => window.removeEventListener(ASK_EVENT, onAsk);
  }, []);
  const last = [...turns].reverse().find((t) => t.reply)?.reply;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-3 print:hidden">
      {open && (
        <section
          role="dialog"
          aria-label="Ask"
          data-testid="ask-ai-panel"
          className="flex h-[min(34rem,calc(100vh-7rem))] w-[min(26rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
        >
          <header className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold text-text">
            <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md border border-border text-text-muted">
              <Sparkles className="size-4" aria-hidden="true" />
            </span>
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold leading-tight">Ask</h2>
            <AiBadge />
            {turns.length > 0 && (
              <button
                type="button"
                onClick={() => setTurns([])}
                className="min-h-[32px] rounded-md px-2 text-xs font-semibold text-accent underline"
              >
                Clear
              </button>
            )}
            <button
              type="button"
              aria-label="Close assistant"
              onClick={() => setOpen(false)}
              className="flex size-8 items-center justify-center rounded-md text-text hover:bg-surface-alt"
            >
              <X className="size-4" aria-hidden="true" />
            </button>
          </header>
          {pageTitle && (
            <p className="border-b border-border px-4 py-1.5 text-xs text-text-muted" data-testid="ask-page">
              Asking about: <strong className="text-text">{pageTitle}</strong>
            </p>
          )}
          <div
            className="flex-1 space-y-3 overflow-y-auto p-4"
            aria-live="polite"
            tabIndex={0}
            aria-label="Conversation"
          >
            {turns.length === 0 && (
              <p className="text-sm text-text-muted">
                Hello. Ask me what this page is, what you can do here, how to do anything in the portal, what
                a status means, or what to do when the Procurement Copilot is waiting. I answer from the page
                guide and the records you may see. Type or speak your question.
              </p>
            )}
            {turns.map((t, i) =>
              t.from === 'you' ? (
                <p
                  key={i}
                  className="ml-auto max-w-[85%] rounded-lg rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-fg"
                >
                  {t.text}
                </p>
              ) : (
                <div
                  key={i}
                  className="max-w-[92%] rounded-lg rounded-bl-sm bg-surface-alt px-3 py-2 text-sm text-text"
                  data-testid="ai-answer"
                >
                  <p>{t.text}</p>
                  {t.reply?.steps && t.reply.steps.length > 0 && (
                    <ol className="mt-2 list-decimal space-y-1 pl-5" data-testid="ai-steps">
                      {t.reply.steps.map((st, j) => (
                        <li key={j}>{st}</li>
                      ))}
                    </ol>
                  )}
                  {t.reply && t.reply.bullets.length > 0 && (
                    <ul className="mt-2 list-disc space-y-1 pl-5">
                      {t.reply.bullets.map((b, j) => (
                        <li key={j}>{b}</li>
                      ))}
                    </ul>
                  )}
                  {t.reply?.from && (
                    <p className="mt-2 text-xs text-text-muted" data-testid="ai-from">
                      {t.reply.from}
                    </p>
                  )}
                  {t.reply?.footer && (
                    <p
                      className="mt-2 border-t border-border pt-2 text-xs text-text-muted"
                      data-testid="ai-footer"
                    >
                      {t.reply.footer}
                      {t.reply.footerNote && <span className="block">{t.reply.footerNote}</span>}
                      <span className="block">
                        Model: <strong data-testid="ai-model">{t.reply.model}</strong>
                        {t.reply.modelSimulated !== false ? ' (simulated)' : ''}
                      </span>
                    </p>
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
            {!supplier && turns.some((t) => t.from === 'you') && (
              <p className="text-sm">
                <Link
                  href={`/app/copilot?text=${encodeURIComponent(
                    [...turns]
                      .reverse()
                      .find((t) => t.from === 'you')!
                      .text.slice(0, 500),
                  )}`}
                  onClick={() => setOpen(false)}
                  data-testid="run-for-me"
                  className="font-semibold text-accent underline"
                >
                  Run this for me
                </Link>{' '}
                <span className="text-text-muted">(the Procurement Copilot, simulated)</span>
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
            className="flex flex-wrap items-center gap-2 p-3"
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
              placeholder="Type or speak your question…"
              className="min-h-[44px] min-w-0 flex-1 rounded-md border border-border-strong bg-surface px-3 text-sm text-text placeholder:text-text-muted"
            />
            <VoiceButton state={voice.state} onStart={voice.start} onStop={voice.stop} />
            <button
              type="submit"
              aria-label="Send"
              disabled={busy || !text.trim()}
              className="flex size-11 items-center justify-center rounded-md bg-accent text-accent-fg disabled:opacity-50"
            >
              <Send className="size-4" aria-hidden="true" />
            </button>
            <VoiceStatus
              className="basis-full"
              state={voice.state}
              interim={voice.interim}
              error={voice.error}
            />
          </form>
        </section>
      )}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="ask-ai-button"
        className="flex min-h-[44px] items-center gap-2 rounded-full border border-border-strong bg-surface px-4 text-sm font-medium text-text shadow-md hover:bg-surface-alt"
      >
        <Sparkles className="size-4" aria-hidden="true" />
        Ask
      </button>
    </div>
  );
}
