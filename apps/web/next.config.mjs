/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@reqops/shared', '@reqops/ui'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
