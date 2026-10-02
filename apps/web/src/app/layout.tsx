import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT, ToastProvider } from '@if/ui';
import './globals.css';

export const metadata = {
  title: 'Intuitive Fusion – Procurement Portal',
  description: 'Conversational source-to-contract platform (POC)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint. TODO(M5): add a CSP nonce when the CSP is introduced. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
