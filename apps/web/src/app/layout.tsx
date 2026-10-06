import type { ReactNode } from 'react';
import { THEME_INIT_SCRIPT, ToastProvider, light } from '@if/ui';
import { PwaRegister } from '@/components/shell/pwa';
import { getBranding } from '@/lib/branding';
import './globals.css';

export async function generateMetadata() {
  const b = await getBranding();
  return {
    title: { default: `${b.productName} – Procurement Portal`, template: `%s` },
    description: 'Conversational source-to-contract platform (POC)',
    appleWebApp: { capable: true, title: b.productName, statusBarStyle: 'default' as const },
  };
}
export const viewport = { themeColor: light.accent };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const b = await getBranding();
  return (
    <html lang="en" data-palette={b.palette} suppressHydrationWarning>
      <head>
        {/* Applies the stored theme before first paint. TODO(M5): add a CSP nonce when the CSP is introduced. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ToastProvider>{children}</ToastProvider>
        <PwaRegister />
      </body>
    </html>
  );
}
