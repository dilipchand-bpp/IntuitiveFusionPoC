import type { MetadataRoute } from 'next';
import { light } from '@if/ui';

/** Makes the portal installable to a phone's home screen (FR-0825). It opens the mobile home, which sends a signed-out person to sign in. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Intuitive Fusion – Procurement Portal',
    short_name: 'Intuitive Fusion',
    description:
      'Procurement requests, approvals, scoring and contracts on your phone (proof of concept, synthetic data).',
    start_url: '/app/m',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: light.bg,
    theme_color: light.accent,
    categories: ['business', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'New request', url: '/app/requests/new' },
      { name: 'Approvals', url: '/app/approvals' },
    ],
  };
}
