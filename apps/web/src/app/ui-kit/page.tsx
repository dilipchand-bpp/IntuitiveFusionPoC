import { notFound } from 'next/navigation';
import { Gallery } from './gallery';

export const metadata = { title: 'UI kit – Intuitive Fusion' };

// The gallery is a development/test aid. It is not exposed in production builds unless explicitly enabled.
export default function UiKitPage() {
  if (process.env.NODE_ENV === 'production' && process.env.NEXT_PUBLIC_UI_KIT !== 'true') notFound();
  return <Gallery />;
}
