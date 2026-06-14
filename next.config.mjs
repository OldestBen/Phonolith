/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.genius.com' },
      { protocol: 'https', hostname: 'assets.genius.com' },
      { protocol: 'https', hostname: '**.genius.com' },
    ],
  },
  async rewrites() {
    const analystUrl = process.env.ANALYST_URL || 'http://localhost:8000'
    return [
      {
        source: '/api/waveforms/:hash',
        destination: `${analystUrl}/waveforms/:hash`,
      },
    ]
  },
}

export default nextConfig
