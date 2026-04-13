/** @type {import('next').NextConfig} */
const nextConfig = {
  // distDir default (.next) — kept outside OneDrive via junction symlink
  serverExternalPackages: ["pdf-parse"],
}

module.exports = nextConfig
