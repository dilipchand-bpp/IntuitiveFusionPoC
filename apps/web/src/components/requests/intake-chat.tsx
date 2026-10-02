'use client';
import { Mic, Send } from 'lucide-react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { AiBadge, Button } from '@if/ui';
import { ApiError, api } from '@/lib/api-client';
import { DraftPanel } from './draft-panel';
import type { ChatMsg, RequestView } from './types';

interface Conversation {
  id: string;
  contextId?: string;
  messages: ChatMsg[];
}
interface Reply extends ChatMsg {
  requestId: string;
  request: RequestView;
}

/** Conversational intake: the user describes the need, the (simulated) assistant drafts and asks follow-ups. */
export function IntakeChat({ csrf, requestId }: { csrf: string; requestId?: string }) {
  const [convId, setConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [view, setView] = useState<RequestView | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const started = useRef(false);

  const start = useCallback(async () => {
    try {
      const c = await api<Conversation>('/assistant/conversations', {
        method: 'POST',
        csrf,
        body: { purpose: 'INTAKE', ...(requestId ? { contextId: requestId } : {}) },
      });
      setConvId(c.id);
      setMessages(c.messages);
      if (requestId) setView(await api<RequestView>(`/requests/${requestId}`));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not start the assistant.');
    }
  }, [csrf, requestId]);

  useEffect(() => {
    if (started.current) return; // React strict mode runs effects twice in development
    started.current = true;
    void start();
  }, [start]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || !convId || busy) return;
    setBusy(true);
    setError(null);
    setMessages((m) => [...m, { id: `local-${m.length}`, role: 'USER', text: t }]);
    setText('');
    try {
      const r = await api<Reply>(`/assistant/conversations/${convId}/messages`, {
        method: 'POST',
        csrf,
        body: { text: t },
      });
      setMessages((m) => [...m, { id: r.id, role: 'ASSISTANT', text: r.text }]);
      setView(r.request);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) void send(e);
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <section
        aria-labelledby="chat-h"
        className="flex min-h-[28rem] min-w-0 flex-col rounded-md border border-border bg-surface"
      >
        <header className="flex items-center gap-2 border-b border-border px-4 py-3">
          <h2 id="chat-h" className="font-heading text-lg font-semibold">
            Procurement assistant
          </h2>
          <span className="ml-auto">
            <AiBadge />
          </span>
        </header>
        <div
          ref={logRef}
          role="log"
          aria-live="polite"
          aria-label="Conversation"
          className="flex max-h-[28rem] flex-1 flex-col gap-3 overflow-y-auto p-4"
        >
          {messages.length === 0 && !error && (
            <p className="text-sm text-text-muted">Starting the assistant…</p>
          )}
          {messages.map((m) => (
            <p
              key={m.id}
              data-role={m.role}
              className={
                m.role === 'USER'
                  ? 'ml-auto max-w-[85%] whitespace-pre-wrap break-words rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm text-primary-fg'
                  : 'max-w-[90%] whitespace-pre-wrap break-words rounded-lg rounded-bl-sm bg-surface-alt px-3 py-2 text-sm text-text'
              }
            >
              <span className="sr-only">{m.role === 'USER' ? 'You said: ' : 'Assistant said: '}</span>
              {m.text}
            </p>
          ))}
          {busy && (
            <p role="status" className="text-sm text-text-muted">
              The assistant is working…
            </p>
          )}
        </div>
        {error && (
          <p
            role="alert"
            className="mx-4 mb-2 rounded-sm border border-error bg-error-bg p-2 text-sm font-medium text-error"
          >
            {error}
          </p>
        )}
        <form
          data-ready={convId ? 'true' : 'false'}
          onSubmit={send}
          className="flex flex-wrap items-end gap-2 border-t border-border p-3"
          aria-label="Message the assistant"
        >
          <label htmlFor="chat-input" className="sr-only">
            Describe what you need or answer the question
          </label>
          <textarea
            id="chat-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            maxLength={4000}
            placeholder="Describe what you need, for example: Run an RFx for facilities cleaning, three-year term, about $1.2M"
            className="min-h-[44px] min-w-0 basis-full resize-none sm:flex-1 sm:basis-0 rounded-sm border border-border-strong bg-surface px-3 py-2 text-sm text-text placeholder:text-text-muted"
          />
          <Button
            type="button"
            variant="secondary"
            size="icon"
            disabled
            aria-label="Voice input (coming soon)"
            title="Voice input is coming soon"
          >
            <Mic className="size-5" aria-hidden="true" />
          </Button>
          <Button type="submit" disabled={!convId || !text.trim()} loading={busy} aria-label="Send message">
            <Send className="size-4" aria-hidden="true" />
            Send
          </Button>
        </form>
      </section>

      <aside aria-label="Request draft" className="min-w-0 rounded-md border border-border bg-surface p-4">
        {view ? (
          <>
            <DraftPanel view={view} />
            <div className="mt-5 flex flex-wrap gap-2">
              <Button asChild variant="accent">
                <Link href={`/app/requests/${view.id}`} className="text-accent-fg no-underline">
                  Review and submit
                </Link>
              </Button>
            </div>
          </>
        ) : (
          <div>
            <h2 className="font-heading text-lg font-semibold">Your request draft</h2>
            <p className="mt-1 text-sm text-text-muted">
              As you describe your need, the draft appears here. You can change any field before submitting.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}
