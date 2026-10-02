'use client';

// Last-resort boundary (replaces the root layout), so it carries its own minimal markup and no theme dependencies.
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem', maxWidth: '32rem', margin: '0 auto' }}
      >
        <main>
          <h1>Something went wrong</h1>
          <p>The application hit an unexpected error. Please try again.</p>
          <button type="button" onClick={reset} style={{ minHeight: 44, padding: '0 1rem' }}>
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
