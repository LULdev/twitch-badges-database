import path from "node:path";
import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const nextConfig: NextConfig = {
  // The parent directory (C:\Users\LUL) carries a stray package-lock.json
  // outside this repo; without an explicit root Turbopack walks up, finds it
  // and warns about ignoring it on every dev/build run.
  turbopack: {
    root: path.join(__dirname),
  },
  // Local builds on this machine run next to a full browser session: the 15
  // default static-generation workers exhaust RAM (worker dies 134 / Zone
  // Allocation). BUILD_CPUS caps them locally only — Vercel builds stay at
  // the platform default (env var unset there).
  ...(process.env.BUILD_CPUS
    ? { experimental: { cpus: Number(process.env.BUILD_CPUS) } }
    : {}),
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "static-cdn.jtvnw.net" },
      { protocol: "https", hostname: "api.potat.app" },
    ],
  },
};

export default withNextIntl(nextConfig);
