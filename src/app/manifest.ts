import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Twitch Badges Database",
    short_name: "Badges DB",
    description:
      "Track every global Twitch badge: live drops, countdown timers, rarity and leaderboards.",
    // Explicit id, because it defaults to start_url: changing start_url would
    // otherwise make already-installed apps look like a different app. "/en" is
    // the previous default, kept so existing installs stay the same app.
    id: "/en",
    start_url: "/",
    display: "standalone",
    background_color: "#0b0b11",
    theme_color: "#a970ff",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };
}
