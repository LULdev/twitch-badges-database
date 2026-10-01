import { createAdminClient } from "@/lib/supabase/admin";
import { getEconomy } from "@/lib/settings";

/** Inventory stock cap for Streak Freezes — also rendered in the shelf copy. */
export const FREEZE_MAX = 5;

export type BuyResult =
  | { ok: true; quantity: number; coins: number }
  | { ok: false; code: "insufficient" | "at_cap" | "failed"; price: number };

/**
 * Buy one Streak Freeze for the admin-editable economy price. The price is
 * read SERVER-side — the client never sends an amount. All atomicity lives in
 * the purchase_item RPC (migration 0052): row lock, balance and stock
 * predicates, debit + upsert in one transaction, with real failure reasons.
 */
export async function buyFreeze(userId: string): Promise<BuyResult> {
  const economy = await getEconomy();
  const price = economy.freezePrice;
  try {
    const supabase = createAdminClient();
    const { data, error } = await supabase.rpc("purchase_item", {
      p_user_id: userId,
      p_item_key: "streak_freeze",
      p_price: price,
      p_cap: FREEZE_MAX,
    });
    if (error) throw error;
    const row = (Array.isArray(data) ? data[0] : data) as
      | { purchased?: boolean; out_quantity?: number; out_coins?: number; reason?: string }
      | null;
    if (!row) return { ok: false, code: "failed", price };
    if (row.purchased) {
      return {
        ok: true,
        quantity: Number(row.out_quantity ?? 0),
        coins: Number(row.out_coins ?? 0),
      };
    }
    const code = row.reason === "at_cap" ? "at_cap" : "insufficient";
    return { ok: false, code, price };
  } catch (error) {
    console.warn("[items] purchase failed:", error);
    return { ok: false, code: "failed", price };
  }
}
