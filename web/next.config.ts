import type { NextConfig } from 'next';

const api = process.env.ACO_API_URL ?? 'http://127.0.0.1:4100';

const nextConfig: NextConfig = {
  distDir: process.env.ACO_NEXT_DIST ?? '.next',
  // The browser only talks to the Next.js origin; /api is proxied to the control plane,
  // so the httpOnly session cookie is same-origin and no API key ever reaches the client.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
  async headers() {
    return [{
      source: '/:path*',
      headers: [
        { key: 'X-Content-Type-Options', value: 'nosniff' },
        { key: 'X-Frame-Options', value: 'DENY' },
        { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
      ],
    }];
  },
  productionBrowserSourceMaps: false,
  poweredByHeader: false,
};

export default nextConfig;
