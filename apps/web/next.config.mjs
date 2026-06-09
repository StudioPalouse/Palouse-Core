/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@reqops/shared'],
  experimental: {
    typedRoutes: true,
  },
};

export default nextConfig;
