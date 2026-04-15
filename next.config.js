/** @type {import('next').NextConfig} */
const nextConfig = {
  // distDir default (.next) — kept outside OneDrive via junction symlink
  experimental: {
    serverComponentsExternalPackages: ["pdf-parse", "mammoth"],
  },
}

module.exports = nextConfig
