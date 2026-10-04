#!/usr/bin/env node
// Regression lock for the locale negotiation in src/proxy.ts. Spawns its own
// production server on a free port, asserts the full redirect matrix — the
// three negotiation layers and their precedence — then frees the port again.
//
// Requires a production build (.next/BUILD_ID); `npm run check:locale` chains
// nothing, so the intended ritual is `npm run build && npm run check:locale`.
// The build MUST be newer than the proxy sources you intend to test: a stale
// .next silently tests old code.
//
// The matrix encodes the documented order (AGENTS.md, Conventions):
//   NEXT_LOCALE cookie  ->  Accept-Language  ->  country-of-origin  ->  /en
// Reordering those layers must fail this script.
import { spawn, execSync } from "node:child_process";
import { createServer } from "node:net";
import { existsSync } from "node:fs";

const CASES = [
  {
    name: "no signals -> default /en",
    url: "/",
    headers: {},
    expect: "/en",
  },
  {
    name: "browser language de -> /de",
    url: "/",
    headers: { "accept-language": "de-DE,de;q=0.9" },
    expect: "/de",
  },
  {
    name: "country DE -> /de (geo layer)",
    url: "/",
    headers: { "x-vercel-ip-country": "DE" },
    expect: "/de",
  },
  {
    name: "country BR -> /pt (geo map)",
    url: "/",
    headers: { "x-vercel-ip-country": "BR" },
    expect: "/pt",
  },
  {
    name: "country JP -> /ja (geo map)",
    url: "/",
    headers: { "x-vercel-ip-country": "JP" },
    expect: "/ja",
  },
  {
    name: "unsupported language, unmapped country -> /en",
    url: "/",
    headers: {
      "accept-language": "tr-TR,tr",
      "x-vercel-ip-country": "TR",
    },
    expect: "/en",
  },
  {
    name: "browser language beats country (fr > DE)",
    url: "/",
    headers: {
      "accept-language": "fr",
      "x-vercel-ip-country": "DE",
    },
    expect: "/fr",
  },
  {
    name: "cookie beats browser language and country",
    url: "/",
    headers: {
      "accept-language": "fr",
      "x-vercel-ip-country": "FR",
      cookie: "NEXT_LOCALE=de",
    },
    expect: "/de",
  },
  {
    name: "geo redirect preserves deep paths",
    url: "/badges/xyz",
    headers: { "x-vercel-ip-country": "DE" },
    expect: "/de/badges/xyz",
  },
  {
    name: "geo redirect preserves query strings",
    url: "/?foo=1",
    headers: { "x-vercel-ip-country": "DE" },
    expect: "/de?foo=1",
  },
  {
    name: "prefixed page is never redirected",
    url: "/en/badges",
    headers: { "x-vercel-ip-country": "DE" },
    expect: 200,
  },
  {
    name: "lowercase country code is normalized",
    url: "/",
    headers: { "x-vercel-ip-country": "de" },
    expect: "/de",
  },
];

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** Netstat state names are localized (German "ABHÖREN"), so free the port by
 * parsing for the port number only and force-killing every holder found. */
function freePortForce(port) {
  try {
    const lines = execSync("netstat -ano", { encoding: "utf8" });
    const pids = new Set();
    for (const line of lines.split("\n")) {
      if (!line.includes(`:${port} `)) continue;
      const pid = line.trim().split(/\s+/).pop();
      if (pid && /^\d+$/.test(pid) && pid !== "0") pids.add(pid);
    }
    for (const pid of pids) {
      const cmd =
        process.platform === "win32"
          ? `taskkill /F /PID ${pid}`
          : `kill -9 ${pid}`;
      try {
        execSync(cmd, { stdio: "ignore" });
      } catch {
        // already gone
      }
    }
    return pids.size > 0;
  } catch {
    return false;
  }
}

async function waitForServer(base) {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${base}/en`, { redirect: "manual" });
      if (res.status < 500) return true;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

if (!existsSync(".next/BUILD_ID")) {
  console.error(
    "check:locale needs a production build (.next/BUILD_ID missing).\n" +
      "Run `npm run build` first — and remember: a stale build tests stale code.",
  );
  process.exit(2);
}

const port = await freePort();
const base = `http://127.0.0.1:${port}`;
const child = spawn(`npx next start -p ${port}`, {
  shell: true,
  stdio: ["ignore", "pipe", "pipe"],
});
let serverLog = "";
child.stdout.on("data", (d) => (serverLog += d));
child.stderr.on("data", (d) => (serverLog += d));

let exitCode = 0;
try {
  if (!(await waitForServer(base))) {
    console.error("production server did not come up. Log:\n" + serverLog);
    process.exit(2);
  }

  let failed = 0;
  for (const c of CASES) {
    let ok = false;
    let detail = "";
    try {
      const res = await fetch(`${base}${c.url}`, {
        redirect: "manual",
        headers: c.headers,
      });
      if (typeof c.expect === "number") {
        ok = res.status === c.expect;
        detail = `HTTP ${res.status}`;
      } else {
        const location = res.headers.get("location") ?? "";
        const u = new URL(location, base);
        const got = `${u.pathname}${u.search}`;
        ok = res.status >= 300 && res.status < 400 && got === c.expect;
        detail = `-> ${got}`;
      }
    } catch (error) {
      detail = String(error);
    }
    if (!ok) failed += 1;
    console.log(`${ok ? "PASS" : "FAIL"} ${c.name} ${ok ? "" : "(got " + detail + ")"}`);
  }

  console.log(
    failed === 0
      ? `locale matrix: all ${CASES.length} cases passed`
      : `locale matrix: ${failed} of ${CASES.length} cases FAILED`,
  );
  exitCode = failed === 0 ? 0 : 1;
} finally {
  child.kill();
  setTimeout(() => {
    const forced = freePortForce(port);
    if (forced) console.log(`port ${port} force-freed`);
    process.exit(exitCode);
  }, 1200);
}
