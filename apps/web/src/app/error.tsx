'use client';
import { Button } from '@if/ui';

// Route-level error boundary. The message is generic on purpose: no stack traces or internals reach the browser.
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-4 px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-wide text-text-muted">Error 500</p>
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <p className="text-text-muted">
        We could not complete that. Your work has not been lost. Please try again.
      </p>
      <Button onClick={reset} className="w-fit">
        Try again
      </Button>
    </main>
  );
}
