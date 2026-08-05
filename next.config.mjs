/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    instrumentationHook: true,
  },
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.genius.com' },
      { protocol: 'https', hostname: 'assets.genius.com' },
      { protocol: 'https', hostname: '**.genius.com' },
    ],
  },
  // NOTE: waveform/cover proxying used to live here as rewrites(), but Next.js
  // evaluates rewrites() at build time and freezes the destination into the
  // routes manifest. ANALYST_URL isn't set when the Docker image is built, so
  // the rewrite baked in the localhost fallback and every fetch ECONNREFUSED at
  // runtime. Those are now runtime route handlers instead:
  //   src/app/api/waveforms/[hash]/route.ts
  //   src/app/api/library/[hash]/cover/route.ts
}

export default nextConfig
