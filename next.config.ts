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
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "static-cdn.jtvnw.net" },
      { protocol: "https", hostname: "api.potat.app" },
    ],
  },
};

export default withNextIntl(nextConfig);
