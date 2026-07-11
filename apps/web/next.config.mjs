// Where the Next server forwards proxied API traffic. Dev default hits the local
// API; containers get this as a build arg (Fly: the API app's private 6PN address).
const API_PROXY_TARGET = process.env.API_PROXY_TARGET ?? 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@palouse/shared', '@palouse/ui'],
  // @palouse/shared uses NodeNext-style `./x.js` specifiers for `.ts` sources;
  // webpack needs the alias to resolve them when bundling runtime imports.
  webpack: (config) => {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'] };
    return config;
  },
  experimental: {
    typedRoutes: true,
  },
  // Browser hardening headers. The CSP ships report-only first: Next injects
  // inline hydration scripts and inline styles, so we observe violations in
  // production before switching to an enforced policy in a follow-up. The
  // other headers are safe to enforce immediately. font-src allows data: for
  // the embedded IBM Plex fonts; connect-src 'self' covers the same-origin
  // API proxy.
  async headers() {
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; ');
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy-Report-Only', value: csp },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
        ],
      },
    ];
  },
  // The bare apex resolves to the same Fly app as app.palouse.ai, but auth
  // (cookies, BETTER_AUTH_URL) is scoped to the app subdomain, so apex traffic
  // must bounce to the canonical origin instead of being served directly.
  async redirects() {
    return [
      {
        source: '/:path*',
        has: [{ type: 'host', value: 'palouse.ai' }],
        destination: 'https://app.palouse.ai/:path*',
        permanent: true,
      },
    ];
  },
  // The browser only ever talks to the web origin; these paths proxy server-side
  // to the API. Keeps auth cookies first-party and hides infra hostnames.
  async rewrites() {
    return [
      '/v1/:path*',
      '/api/:path*',
      '/oauth/:path*',
      '/webhooks/:path*',
      // OAuth 2.1 discovery for MCP clients; RFC 8414 puts these at the origin
      // root, so they proxy to the API like /api/auth does.
      '/.well-known/oauth-authorization-server/:path*',
      '/.well-known/openid-configuration/:path*',
    ].map((source) => ({
      source,
      destination: `${API_PROXY_TARGET}${source}`,
    }));
  },
};

export default nextConfig;
