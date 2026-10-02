import type { ReactNode } from 'react';

export const metadata = {
  title: 'Intuitive Fusion – Procurement Portal',
  description: 'Conversational source-to-contract platform (POC)',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
