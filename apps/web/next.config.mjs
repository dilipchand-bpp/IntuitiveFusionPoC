const API_URL = process.env.API_URL ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
export default {
  // A second build can be kept apart from the running one (NEXT_DIST_DIR), for example while testing next to a live demo.
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  reactStrictMode: true,
  devIndicators: false,
  poweredByHeader: false,
  transpilePackages: ['@if/ui'],
  // Same-origin API access: the browser only ever talks to the web origin, so session cookies need no CORS.
  async rewrites() {
    return [{ source: '/api/v1/:path*', destination: `${API_URL}/api/v1/:path*` }];
  },
};
