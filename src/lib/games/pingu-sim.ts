/**
 * Pingu Throw physics — ported verbatim from the original Grok workspace
 * (see scripts/../.tmp-game during the port; sim is DOM-free and
 * deterministic, so the SERVER replays a throw from the tap timing alone).
 * One change from the source: sim.time resets per throw (resetFlightBits),
 * fixing the 40 s session-clock failsafe that insta-ended later throws.
 */
export type Phase = "ready" | "dive" | "swing" | "flight" | "done";

export type GameEvent =
  | { type: "dive" }
  | { type: "swing" }
  | { type: "hit"; power: number; deg: number }
  | { type: "bounce" }
  | { type: "stick" }
  | { type: "whiff" }
  | { type: "done" };

export const LAYOUT = {
  yetiX: 2.08,
  yetiH: 2.68,
  pivotX: 1.34,
  pivotY: 1.46,
  clubLen: 1.92,
  clubR: 0.42,
  pengR: 0.5,
  cliffX: -1.55,
  cliffH: 8.2,
  platformY: 7.48,
  startX: -0.22,
  diveX: 0.46,
  groundY: 0.3,
  idleAngle: 0.78,
  windupAngle: 2.04,
  swingEnd: 4.28,
  swingDur: 0.24,
  hopTime: 0.3,
  diveAccel: 4.6,
  flightG: 11.4,
  drag: 0.04,
  sweetY: 1.82,
  stickDeg: 56,
};

export type Sim = {
  phase: Phase;
  x: number;
  y: number;
  vx: number;
  vy: number;
  nose: number;
  club: number;
  swingFrom: number;
  swingU: number;
  diveT: number;
  hit: boolean;
  stuck: boolean;
  sliding: boolean;
  whiffed: boolean;
  bounces: number;
  maxX: number;
  meters: number;
  contactY: number | null;
  clickY: number | null;
  launchDeg: number;
  power: number;
  stillT: number;
  time: number;
  throws: number;
};

export function createSim(): Sim {
  return {
    phase: "ready",
    x: LAYOUT.startX,
    y: LAYOUT.platformY + 0.48,
    vx: 0,
    vy: 0,
    nose: Math.PI / 2,
    club: LAYOUT.idleAngle,
    swingFrom: LAYOUT.windupAngle,
    swingU: 1,
    diveT: 0,
    hit: false,
    stuck: false,
    sliding: false,
    whiffed: false,
    bounces: 0,
    maxX: 0,
    meters: 0,
    contactY: null,
    clickY: null,
    launchDeg: 0,
    power: 0,
    stillT: 0,
    time: 0,
    throws: 0,
  };
}

function lerp(a: number, b: number, t: number) {
  return a + (b - a) * t;
}

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

function dampAngle(a: number, b: number, k: number, dt: number) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * (1 - Math.exp(-k * dt));
}

function resetFlightBits(sim: Sim) {
  sim.hit = false;
  sim.stuck = false;
  sim.sliding = false;
  sim.whiffed = false;
  sim.bounces = 0;
  sim.maxX = 0;
  sim.meters = 0;
  sim.contactY = null;
  sim.clickY = null;
  sim.launchDeg = 0;
  sim.power = 0;
  sim.stillT = 0;
  // Port fix: sim.time accumulated across the whole session in the original,
  // so once 40 s of SESSION time had passed the failsafe (time > 40 → done)
  // fired on the first step of every later throw, ending each at 0.46 m. The
  // clock now belongs to the throw, not the session — and simulateThrow's
  // server replay matches the client because both start from time 0.
  sim.time = 0;
  sim.vx = 0;
  sim.vy = 0;
  sim.swingU = 1;
}

export function tap(sim: Sim): GameEvent[] {
  if (sim.phase === "ready") {
    resetFlightBits(sim);
    sim.phase = "dive";
    sim.diveT = 0;
    sim.throws += 1;
    return [{ type: "dive" }];
  }
  if (sim.phase === "dive") {
    sim.phase = "swing";
    sim.swingFrom = sim.club;
    sim.swingU = 0;
    sim.clickY = sim.y;
    return [{ type: "swing" }];
  }
  if (sim.phase === "done") {
    sim.phase = "ready";
    sim.x = LAYOUT.startX;
    sim.y = LAYOUT.platformY + 0.48;
    sim.nose = Math.PI / 2;
    resetFlightBits(sim);
    return [];
  }
  return [];
}

function fall(sim: Sim, dt: number) {
  sim.diveT += dt;
  if (sim.diveT < LAYOUT.hopTime) {
    const u = sim.diveT / LAYOUT.hopTime;
    const e = u * u * (3 - 2 * u);
    sim.x = lerp(LAYOUT.startX, LAYOUT.diveX, e);
    sim.y = LAYOUT.platformY + 0.48 + Math.sin(Math.PI * u) * 0.42;
    sim.vy = 0;
    sim.nose = lerp(Math.PI / 2, 0.4, u);
    return;
  }
  if (sim.vy === 0 && sim.diveT - dt < LAYOUT.hopTime) sim.vy = -1.4;
  sim.vy -= LAYOUT.diveAccel * dt;
  sim.y += sim.vy * dt;
  sim.x = LAYOUT.diveX;
  const fallP = clamp((LAYOUT.platformY + 0.2 - sim.y) / 6.2, 0, 1);
  sim.nose = lerp(0.2, -Math.PI / 2, fallP);
}

function swingClub(sim: Sim, dt: number) {
  sim.swingU += dt / LAYOUT.swingDur;
  const u = clamp(sim.swingU, 0, 1);
  const e = u;
  sim.club = lerp(sim.swingFrom, LAYOUT.swingEnd, e);
}

function segment(sim: Sim) {
  const x2 = LAYOUT.pivotX + Math.cos(sim.club) * LAYOUT.clubLen;
  const y2 = LAYOUT.pivotY + Math.sin(sim.club) * LAYOUT.clubLen;
  return { x1: LAYOUT.pivotX, y1: LAYOUT.pivotY, x2, y2 };
}

function closestT(px: number, py: number, x1: number, y1: number, x2: number, y2: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy || 1;
  const t = ((px - x1) * dx + (py - y1) * dy) / l2;
  const c = clamp(t, 0, 1);
  const nx = x1 + c * dx;
  const ny = y1 + c * dy;
  return { dist: Math.hypot(px - nx, py - ny), t: c };
}

function launchFor(y: number) {
  const sweet = LAYOUT.sweetY;
  const deg =
    y <= sweet
      ? lerp(20, 43, clamp((y - 0.48) / (sweet - 0.48), 0, 1))
      : lerp(43, 74, clamp((y - sweet) / (3.5 - sweet), 0, 1));
  const align = Math.exp(-0.5 * ((y - sweet) / 0.85) ** 2);
  let speed = 22 + align * 30;
  if (y > 3.2 || y < 0.4) speed *= 0.62;
  const rad = (deg * Math.PI) / 180;
  return { vx: Math.cos(rad) * speed, vy: Math.sin(rad) * speed, deg, power: align };
}

function tryHit(sim: Sim): GameEvent | null {
  const seg = segment(sim);
  const hit = closestT(sim.x, sim.y, seg.x1, seg.y1, seg.x2, seg.y2);
  if (hit.dist > LAYOUT.pengR + LAYOUT.clubR || hit.t < 0.2) return null;
  const launch = launchFor(sim.y);
  sim.hit = true;
  sim.phase = "flight";
  sim.contactY = sim.y;
  sim.launchDeg = launch.deg;
  sim.power = launch.power;
  sim.vx = launch.vx;
  sim.vy = launch.vy;
  sim.nose = (launch.deg * Math.PI) / 180;
  sim.sliding = false;
  return { type: "hit", power: launch.power, deg: launch.deg };
}

function faceplant(sim: Sim): GameEvent[] {
  sim.y = LAYOUT.groundY;
  sim.vy = 0;
  sim.vx = 0;
  sim.stuck = true;
  sim.sliding = true;
  sim.nose = -1.2;
  sim.maxX = Math.max(sim.maxX, sim.x);
  sim.meters = Math.max(0, sim.maxX);
  sim.phase = "done";
  return [{ type: "stick" }, { type: "done" }];
}

function noteX(sim: Sim) {
  if (sim.x > sim.maxX) sim.maxX = sim.x;
  sim.meters = Math.max(0, sim.maxX);
}

export function step(sim: Sim, dt: number): GameEvent[] {
  const ev: GameEvent[] = [];
  dt = Math.min(0.05, Math.max(0, dt));
  if (dt === 0) return ev;
  sim.time += dt;

  if (sim.phase === "ready" || sim.phase === "done") {
    const target = LAYOUT.idleAngle;
    sim.club += (target - sim.club) * (1 - Math.exp(-3.2 * dt));
    if (sim.phase === "ready") sim.nose = Math.PI / 2;
    return ev;
  }

  if (sim.phase === "dive") {
    fall(sim, dt);
    sim.club += (LAYOUT.windupAngle - sim.club) * (1 - Math.exp(-5.4 * dt));
    if (sim.y <= LAYOUT.groundY) ev.push(...faceplant(sim));
    return ev;
  }

  if (sim.phase === "swing") {
    const sub = 8;
    const h = dt / sub;
    for (let i = 0; i < sub; i++) {
      const u0 = sim.swingU;
      if (!sim.hit) fall(sim, h);
      if (sim.swingU < 1) swingClub(sim, h);
      if (!sim.hit && u0 < 1) {
        const hit = tryHit(sim);
        if (hit) ev.push(hit);
      }
      if (!sim.hit && sim.y <= LAYOUT.groundY) {
        ev.push(...faceplant(sim));
        return ev;
      }
    }
    if (!sim.hit && sim.swingU >= 1 && !sim.whiffed) {
      sim.whiffed = true;
      ev.push({ type: "whiff" });
    }
    if (sim.hit) noteX(sim);
    return ev;
  }

  if (sim.phase === "flight") {
    if (sim.swingU < 1) swingClub(sim, dt);
    if (!sim.sliding) {
      sim.vy -= LAYOUT.flightG * dt;
      sim.vx *= Math.exp(-LAYOUT.drag * dt);
      sim.x += sim.vx * dt;
      sim.y += sim.vy * dt;
      sim.nose = dampAngle(sim.nose, Math.atan2(sim.vy, sim.vx), 7, dt);
      if (sim.y <= LAYOUT.groundY) {
        sim.y = LAYOUT.groundY;
        const sp = Math.hypot(sim.vx, sim.vy);
        if (sim.bounces === 0 && sim.launchDeg >= LAYOUT.stickDeg && sp > 18) {
          sim.stuck = true;
          sim.vy = 0;
          sim.vx *= 0.2;
          sim.sliding = true;
          ev.push({ type: "stick" });
        } else if (Math.abs(sim.vy) > 3.4) {
          sim.vy = Math.abs(sim.vy) * 0.46;
          sim.vx *= 0.9;
          sim.bounces += 1;
          ev.push({ type: "bounce" });
          if (sim.vy < 2.6) {
            sim.vy = 0;
            sim.sliding = true;
          }
        } else {
          sim.vy = 0;
          sim.sliding = true;
        }
      }
    } else {
      const sign = Math.sign(sim.vx);
      const fr = sim.stuck ? 13 : 3.1;
      const drop = fr * dt;
      if (Math.abs(sim.vx) <= drop) sim.vx = 0;
      else sim.vx -= sign * drop;
      sim.x += sim.vx * dt;
      sim.y = LAYOUT.groundY;
      sim.nose = dampAngle(sim.nose, sim.stuck ? -1.15 : 0.02, 7, dt);
      if (sim.vx === 0) {
        sim.stillT += dt;
        if (sim.stillT > 0.32) {
          sim.phase = "done";
          ev.push({ type: "done" });
        }
      } else {
        sim.stillT = 0;
      }
    }
    noteX(sim);
    if (sim.time > 40 && sim.phase === "flight") {
      sim.vx = 0;
      sim.vy = 0;
      sim.phase = "done";
      ev.push({ type: "done" });
    }
  }
  return ev;
}

/** 1-based rank tier for i18n (games.rank1..rank8) — same thresholds as rankFor. */
export function rankIndex(meters: number): number {
  if (meters < 8) return 1;
  if (meters < 45) return 2;
  if (meters < 110) return 3;
  if (meters < 190) return 4;
  if (meters < 280) return 5;
  if (meters < 380) return 6;
  if (meters < 500) return 7;
  return 8;
}

type ThrowReport = {
  meters: number;
  power: number;
  hit: boolean;
  stuck: boolean;
  contactY: number | null;
  clickY: number | null;
  launchDeg: number;
  phase: Phase;
  bounces: number;
};

export function simulateThrow(clickAt: number): ThrowReport {
  const sim = createSim();
  tap(sim);
  let t = 0;
  const dt = 1 / 120;
  let swung = false;
  if (clickAt <= 0) {
    tap(sim);
    swung = true;
  }
  for (let i = 0; i < 120 * 28 && sim.phase !== "done"; i++) {
    if (!swung && t >= clickAt && sim.phase === "dive") {
      tap(sim);
      swung = true;
    }
    step(sim, dt);
    t += dt;
  }
  return {
    meters: sim.meters,
    power: sim.power,
    hit: sim.hit,
    stuck: sim.stuck,
    contactY: sim.contactY,
    clickY: sim.clickY,
    launchDeg: sim.launchDeg,
    phase: sim.phase,
    bounces: sim.bounces,
  };
}
