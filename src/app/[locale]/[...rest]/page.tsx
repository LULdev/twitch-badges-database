import { notFound } from "next/navigation";

/** Catch-all under [locale]: funnels unknown paths to the localized 404. */
export default function CatchAllPage() {
  notFound();
}
