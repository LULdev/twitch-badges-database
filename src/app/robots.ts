import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // `/*/login` is a thin logged-out page (a heading and a button) — the
        // mirrored entry point is `/*/account`, already blocked.
        disallow: ["/api/", "/*/account", "/*/inventory", "/*/auth/", "/*/login"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
