import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Twitch Badges Database",
    short_name: "Badges DB",
    description:
      "Track every global Twitch badge: live drops, countdown timers, rarity and leaderboards.",
    start_url: "/en",
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
