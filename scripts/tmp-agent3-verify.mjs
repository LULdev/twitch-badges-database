// TEMP verification script (agent3) — read-only GETs against Supabase REST.
// Delete after use.
import { config } from "dotenv";
import { randomUUID } from "node:crypto";

config({ path: ".env.local" });

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const headers = { apikey: key, Authorization: `Bearer ${key}` };
const rand = randomUUID();

async function get(path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { method: "GET", headers });
  const text = await res.text();
  return { status: res.status, text };
}

function show(label, r, limit = 1500) {
  console.log(`\n=== ${label} ===`);
  console.log(`HTTP ${r.status}`);
  console.log(r.text.length > limit ? r.text.slice(0, limit) + ` …[truncated ${r.text.length} chars]` : r.text);
}

const base =
  "steal_attempts?select=id,cost,coins,success,created_at,thief:profiles!steal_attempts_thief_id_fkey(username)&limit=1";

// 1) FK constraint name check
const r1 = await get(base);
show("1) named FK embed", r1);

// Control: bogus constraint name (to show the 400 error shape)
const r1b = await get(
  "steal_attempts?select=id,thief:profiles!steal_attempts_thief_id_fkey_BOGUS(username)&limit=1",
);
show("1b) control: bogus FK name", r1b, 600);

// 2) random victim_id filter
const r2 = await get(`${base}&victim_id=eq.${rand}`);
show(`2) victim_id=eq.${rand}`, r2);

// Parse for semantics + thief shape
function parseJoin(r) {
  try {
    return JSON.parse(r.text);
  } catch {
    return null;
  }
}
const rows = parseJoin(r1);
if (Array.isArray(rows) && rows.length > 0) {
  const row = rows[0];
  console.log("\n=== 3/4) semantics ===");
  console.log("row keys:", Object.keys(row).join(","));
  console.log("thief typeof:", row.thief === null ? "null" : Array.isArray(row.thief) ? "ARRAY" : typeof row.thief);
  const t = Array.isArray(row.thief) ? row.thief[0] : row.thief;
  if (t && typeof t === "object") {
    const name = String(t.username ?? "");
    console.log("thief.username (redacted):", name ? name.slice(0, 2) + "***" : "(empty)");
  }
  console.log(
    "first row:",
    JSON.stringify({
      id: row.id,
      cost: row.cost,
      coins: row.coins,
      success: row.success,
      created_at: row.created_at,
    }),
  );
  console.log("relations seen in row:", rows.length);
  const badNull = rows.filter((x) => x.thief === null).length;
  console.log("rows with null thief (of this 1):", badNull);

  // Wider sample (still same select, read-only) for the => semantics claims.
  const r4 = await get(base.replace("&limit=1", "&limit=100&order=created_at.desc"));
  const sample = parseJoin(r4);
  if (Array.isArray(sample)) {
    console.log("\n=== 4) wider sample ===");
    console.log("sample size:", sample.length, "| HTTP", r4.status);
    const viol1 = sample.filter((x) => x.success === false && x.coins !== 0);
    const viol2 = sample.filter((x) => x.success === true && !(x.coins > 0));
    const costs = [...new Set(sample.map((x) => x.cost))];
    const thiefShapes = [...new Set(sample.map((x) => (x.thief === null ? "null" : Array.isArray(x.thief) ? "ARRAY" : typeof x.thief)))];
    console.log("success=false with coins!=0:", viol1.length, JSON.stringify(viol1.slice(0, 3)));
    console.log("success=true with coins<=0:", viol2.length, JSON.stringify(viol2.slice(0, 3)));
    console.log("distinct cost values in sample:", JSON.stringify(costs));
    console.log("thief shapes in sample:", thiefShapes.join(","));
    console.log("success counts:", JSON.stringify(sample.reduce((a, x) => ((a[x.success] = (a[x.success] || 0) + 1), a), {})));
    const nullThief = sample.filter((x) => x.thief === null).length;
    console.log("null thief in sample:", nullThief);
  } else {
    show("4) wider sample", r4);
  }
} else {
  console.log("\n=== 3/4) no rows returned, nothing to inspect ===");
}

// 5) Structural proof from the PostgREST OpenAPI spec (read-only GET).
try {
  const res = await fetch(`${url}/rest/v1/`, { headers });
  const spec = await res.json();
  console.log("\n=== 5) OpenAPI spec ===");
  console.log("HTTP", res.status);
  const def = spec?.definitions?.steal_attempts;
  if (def) {
    const props = Object.keys(def.properties ?? {});
    console.log("steal_attempts columns:", props.join(","));
    const rels = def.relationships ?? [];
    console.log(
      "relationships:",
      JSON.stringify(
        rels.map((x) => ({ card: x.cardinality, rel: x.relationship, cols: x.columns, target: x.referencedRelation })),
        null,
        0,
      ),
    );
  } else {
    console.log("steal_attempts missing from spec definitions; keys:", Object.keys(spec?.definitions ?? {}).slice(0, 20));
  }
  // total row count via read-only HEAD (count header only)
  const cres = await fetch(`${url}/rest/v1/steal_attempts?select=id`, {
    method: "HEAD",
    headers: { ...headers, Prefer: "count=exact" },
  });
  console.log("HEAD steal_attempts status:", cres.status, "content-range:", cres.headers.get("content-range"));
  // control: bogus column should 400, proving column names are actually validated
  const r5b = await get("steal_attempts?select=id&victim_id_BOGUS=eq.x&limit=1");
  show("5b) control: bogus column", r5b, 400);
} catch (e) {
  console.log("\n=== 5) OpenAPI spec fetch failed ===", String(e));
}
