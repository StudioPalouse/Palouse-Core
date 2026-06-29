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
  // The browser only ever talks to the web origin; these paths proxy server-side
  // to the API. Keeps auth cookies first-party and hides infra hostnames.
  async rewrites() {
    return ['/v1/:path*', '/api/:path*', '/oauth/:path*', '/webhooks/:path*'].map((source) => ({
      source,
      destination: `${API_PROXY_TARGET}${source}`,
    }));
  },
};

export default nextConfig;
