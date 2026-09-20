import { createAdminClient } from "./supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ChangelogKind =
  | "badge_added"
  | "badge_updated"
  | "badge_removed"
  | "data_sync"
  | "feature"
  | "bugfix"
  | "blog"
  | "push";

export interface ChangelogEntry {
  kind: ChangelogKind;
  title: string;
  body?: string | null;
  payload?: Record<string, unknown> | null;
}

/**
 * Append a timestamped changelog row. Every sync mutation and site change
 * funnels through here — failures are logged but never break the caller,
 * because a changelog write must not roll back a sync.
 */
export async function logChange(
  entry: ChangelogEntry,
  client?: SupabaseClient,
): Promise<void> {
  try {
    const supabase = client ?? createAdminClient();
    const { error } = await supabase.from("changelog").insert({
      kind: entry.kind,
      title: entry.title,
      body: entry.body ?? null,
      payload: entry.payload ?? null,
    });
    if (error) throw error;
  } catch (error) {
    console.warn("[changelog] write failed:", error);
  }
}

export async function logChanges(
  entries: ChangelogEntry[],
  client?: SupabaseClient,
): Promise<void> {
  if (entries.length === 0) return;
  try {
    const supabase = client ?? createAdminClient();
    const { error } = await supabase.from("changelog").insert(
      entries.map((entry) => ({
        kind: entry.kind,
        title: entry.title,
        body: entry.body ?? null,
        payload: entry.payload ?? null,
      })),
    );
    if (error) throw error;
  } catch (error) {
    console.warn("[changelog] batch write failed:", error);
  }
}
