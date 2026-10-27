/**
 * Badge Rocket — the canvas scene. Pure draw code, no React: the component
 * owns a rAF loop, mutates a `CrashScene` object per frame and calls
 * `drawScene`. Everything reads its colours from the passed theme (the
 * design tokens, resolved by the component), so dark/light both work.
 *
 * The scene is a classic crash chart drawn as a flight: an exponential,
 * glow-stroked curve from the bottom-left pad, the rocket riding its tip,
 * a three-layer starfield parallax that streams past as the multiplier
 * climbs, the Earth's curvature sinking away below — and from 6x upward
 * the moon slides in from the top-right until it fills at 10x ("to the
 * moon").
 */

export interface CrashTheme {
  accent: string;
  success: string;
  danger: string;
  warning: string;
  foreground: string;
  muted: string;
  line: string;
}

export const FALLBACK_CRASH_THEME: CrashTheme = {
  accent: "#a970ff",
  success: "#34d399",
  danger: "#f87171",
  warning: "#fbbf24",
  foreground: "#f4f4f8",
  muted: "#9a9ab0",
  line: "rgba(255,255,255,0.12)",
};

/** Resolve the design tokens for the canvas (SVG-style var() cannot). */
export function readCrashTheme(root: HTMLElement): CrashTheme {
  const styles = getComputedStyle(root);
  const get = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    accent: get("--accent", FALLBACK_CRASH_THEME.accent),
    success: get("--success", FALLBACK_CRASH_THEME.success),
    danger: get("--danger", FALLBACK_CRASH_THEME.danger),
    warning: get("--warning", FALLBACK_CRASH_THEME.warning),
    foreground: get("--foreground", FALLBACK_CRASH_THEME.foreground),
    muted: get("--muted", FALLBACK_CRASH_THEME.muted),
    line: get("--line", FALLBACK_CRASH_THEME.line),
  };
}

export type CrashPhase = "idle" | "flying" | "crashed" | "cashed";

export interface CrashScene {
  phase: CrashPhase;
  /** Display multiplier — live while flying, frozen at the end value after. */
  mult: number;
  /** Flight elapsed ms, frozen after the end. */
  timeMs: number;
  crashAt?: number;
  cashedAt?: number;
  /** Server auto cash-out target (display multiplier), dashed guide line. */
  auto: number | null;
  /** Last drawn rocket-tip screen position — where bursts spawn. Written by
   * drawScene every frame, read by the component on flight end. */
  tip?: { x: number; y: number };
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  kind: "spark" | "debris" | "coin" | "puff" | "ring";
  spin?: number;
}

export type Particles = Particle[];

export function spawnBurst(
  parts: Particles,
  x: number,
  y: number,
  kind: Particle["kind"],
  count: number,
  speed: number,
): void {
  for (let i = 0; i < count; i += 1) {
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
    const v = speed * (0.4 + Math.random() * 0.8);
    parts.push({
      x,
      y,
      vx: Math.cos(angle) * v,
      vy: Math.sin(angle) * v,
      life: 0.5 + Math.random() * 0.7,
      max: 1.2,
      size: 1.5 + Math.random() * 2.5,
      kind,
      spin: Math.random() * Math.PI * 2,
    });
  }
  if (kind === "spark" || kind === "ring") {
    parts.push({ x, y, vx: 0, vy: 0, life: 0.55, max: 0.55, size: 6, kind: "ring" });
  }
}

export function stepParticles(parts: Particles, dt: number): void {
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const p = parts[i];
    p.life -= dt;
    if (p.life <= 0) {
      parts.splice(i, 1);
      continue;
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.kind === "debris" || p.kind === "coin") p.vy += 220 * dt;
    if (p.kind === "puff") {
      p.vx *= 1 - 1.4 * dt;
      p.vy *= 1 - 1.4 * dt;
    }
    if (p.spin != null) p.spin += dt * 6;
  }
}

// Deterministic starfield: stable positions without storing state, via a
// cheap integer hash — the same star is the same star on every frame.
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

const STAR_LAYERS = [
  { count: 46, speed: 14, size: 1.0, alpha: 0.35 },
  { count: 30, speed: 30, size: 1.5, alpha: 0.55 },
  { count: 16, speed: 55, size: 2.1, alpha: 0.85 },
];

const Y_STEPS = [1, 1.5, 2, 3, 5, 10, 20, 50, 100, 250];

export interface DrawOpts {
  shakeX: number;
  shakeY: number;
  flash: number;
  /** Seconds since epoch / 1000 — drives twinkle + flame flicker. */
  now: number;
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  scene: CrashScene,
  theme: CrashTheme,
  parts: Particles,
  opts: DrawOpts,
): void {
  const padX = 54;
  const padY = h - 42;
  const top = 26;
  const mult = Math.max(1, scene.mult);
  const t = Math.max(0, scene.timeMs) / 1000;

  // ── Space background: near-black in both themes, with a faint accent
  // nebula that keeps the board on-brand without fighting the tokens.
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  // The screen shake: everything from the background up rides it, so a
  // shaken frame briefly reveals the card surface at its edges — the
  // physical jolt the trauma value is for.
  ctx.translate(opts.shakeX, opts.shakeY);
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0b0b14");
  bg.addColorStop(0.65, "#0e0e1a");
  bg.addColorStop(1, "#12121f");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const nebula = ctx.createRadialGradient(w * 0.78, h * 0.2, 10, w * 0.78, h * 0.2, w * 0.6);
  nebula.addColorStop(0, hexA(theme.accent, 0.1));
  nebula.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = nebula;
  ctx.fillRect(0, 0, w, h);

  // ── Earth curvature: a huge circle sinking away as the rocket climbs —
  // the "camera rises" tell that makes high multipliers feel like altitude.
  const earthR = Math.max(w, h) * 1.5;
  const earthY = padY + h * 0.55 + Math.min(mult, 60) * 9;
  const earth = ctx.createLinearGradient(0, earthY - earthR, 0, earthY);
  earth.addColorStop(0, hexA(theme.accent, 0.28));
  earth.addColorStop(0.25, "#161228");
  earth.addColorStop(1, "#0c0c16");
  ctx.beginPath();
  ctx.arc(w * 0.5, earthY, earthR, 0, Math.PI * 2);
  ctx.fillStyle = earth;
  ctx.fill();
  ctx.strokeStyle = hexA(theme.accent, 0.55);
  ctx.lineWidth = 2;
  ctx.stroke();

  // ── Starfield parallax: stars stream down-left while the curve climbs.
  for (let l = 0; l < STAR_LAYERS.length; l += 1) {
    const layer = STAR_LAYERS[l];
    const drift = scene.phase === "idle" ? 6 : layer.speed * (1 + Math.min(mult, 40) * 0.12);
    for (let i = 0; i < layer.count; i += 1) {
      const sx = hash(i + l * 97) * w;
      const sy = hash(i + l * 97 + 51) * h;
      const px = mod(sx - opts.now * drift * 0.55, w);
      const py = mod(sy + opts.now * drift * 0.35, h);
      const tw = 0.65 + 0.35 * Math.sin(opts.now * (1.2 + hash(i) * 2) + i);
      ctx.globalAlpha = layer.alpha * tw;
      ctx.fillStyle = theme.foreground;
      ctx.fillRect(px, py, layer.size, layer.size);
    }
  }
  ctx.globalAlpha = 1;

  // ── Moon: slides in from the top-right between 6x and 10x and stays.
  const moonA = Math.max(0, Math.min(1, (mult - 6) / 4));
  if (moonA > 0) {
    const mx = w - 64 + (1 - moonA) * 90;
    const my = 66 + (1 - moonA) * -40;
    const mr = 26 + moonA * 8;
    ctx.globalAlpha = moonA;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.6, mx, my, mr * 2.4);
    halo.addColorStop(0, hexA(theme.warning, 0.25));
    halo.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = halo;
    ctx.fillRect(mx - mr * 2.4, my - mr * 2.4, mr * 4.8, mr * 4.8);
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    ctx.fillStyle = "#dcd6c8";
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.14)";
    for (const [cx, cy, cr] of [
      [-mr * 0.35, -mr * 0.2, mr * 0.22],
      [mr * 0.25, mr * 0.15, mr * 0.3],
      [mr * 0.05, mr * 0.5, mr * 0.14],
    ] as const) {
      ctx.beginPath();
      ctx.arc(mx + cx, my + cy, cr, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── Chart geometry: auto-rescaling axes keep the rocket near the
  // upper-right third at every multiplier, the classic crash sweep.
  const xMax = Math.max(t, 8) * 1.16;
  const yMax = Math.max(mult, 1.6) * 1.3;
  const plotW = w - padX - 18;
  const plotH = padY - top;
  const px = (sec: number) => padX + (sec / xMax) * plotW;
  // Linear y axis: the exponential climb keeps its iconic bend early and
  // straightens as the scale catches up — exactly how crash charts read.
  const py = (m: number) => padY - ((m - 1) / (yMax - 1)) * plotH;

  // Reference grid + multiplier labels (log scale — the curve reads as a
  // straightening climb, exactly how crash charts stay readable at 100x).
  ctx.font = "10px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const step of Y_STEPS) {
    if (step > yMax) break;
    const y = py(step);
    ctx.strokeStyle = hexA(theme.muted, step === 1 ? 0.28 : 0.12);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padX, y);
    ctx.lineTo(w - 18, y);
    ctx.stroke();
    ctx.fillStyle = hexA(theme.muted, 0.75);
    ctx.fillText(`${step}×`, padX - 8, y);
  }
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let sec = 2; sec <= xMax; sec += 2) {
    ctx.strokeStyle = hexA(theme.muted, 0.08);
    ctx.beginPath();
    ctx.moveTo(px(sec), top);
    ctx.lineTo(px(sec), padY);
    ctx.stroke();
    ctx.fillStyle = hexA(theme.muted, 0.5);
    ctx.fillText(`${sec}s`, px(sec), padY + 6);
  }

  // Launch pad (idle only — once the rocket flies, the pad stays behind).
  if (scene.phase === "idle") {
    ctx.strokeStyle = hexA(theme.muted, 0.5);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(padX - 14, padY);
    ctx.lineTo(padX + 30, padY);
    ctx.stroke();
    ctx.strokeStyle = hexA(theme.muted, 0.28);
    ctx.beginPath();
    ctx.moveTo(padX + 22, padY);
    ctx.lineTo(padX + 22, padY - 34);
    ctx.stroke();
  }

  // ── The curve: the multiplier itself, glow-stroked with an area fill.
  // Frozen at its final value after the end (crashed → danger, cashed →
  // success); while flying it climbs in accent.
  const curveColor =
    scene.phase === "crashed"
      ? theme.danger
      : scene.phase === "cashed"
        ? theme.success
        : theme.accent;
  const steps = 36;
  ctx.beginPath();
  ctx.moveTo(px(0), py(1));
  for (let i = 1; i <= steps; i += 1) {
    const sec = (t * i) / steps;
    ctx.lineTo(px(sec), py(Math.exp((Math.log(mult) * i) / steps)));
  }
  ctx.strokeStyle = curveColor;
  ctx.lineWidth = 3;
  ctx.lineJoin = "round";
  ctx.shadowColor = curveColor;
  ctx.shadowBlur = 12;
  ctx.stroke();
  ctx.shadowBlur = 0;
  // Area fill under the curve.
  ctx.lineTo(px(t), padY);
  ctx.lineTo(px(0), padY);
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, top, 0, padY);
  fill.addColorStop(0, hexA(curveColor, 0.22));
  fill.addColorStop(1, hexA(curveColor, 0.02));
  ctx.fillStyle = fill;
  ctx.fill();

  // Auto cash-out guide: a dashed gold horizon at the server-stored target.
  if (scene.auto != null && scene.auto > 1 && scene.auto <= yMax) {
    const ay = py(scene.auto);
    ctx.setLineDash([5, 6]);
    ctx.strokeStyle = hexA(theme.warning, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(padX, ay);
    ctx.lineTo(w - 18, ay);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // ── The rocket (gone after a crash — the explosion replaced it).
  if (scene.phase !== "crashed") {
    const tipX = px(t);
    const tipY = py(mult);
    scene.tip = { x: tipX, y: tipY };
    // Tangent angle from the curve's local derivative.
    const dtSec = 0.12;
    const slope =
      (py(mult * Math.exp(dtSec * 0.18)) - tipY) / Math.max(1, px(t + dtSec) - tipX);
    const angle =
      scene.phase === "flying" || scene.phase === "cashed"
        ? Math.atan2(-Math.max(0.35, Math.min(2.4, slope)), 1)
        : -Math.PI / 2;
    const idleBob = scene.phase === "idle" ? Math.sin(opts.now * 2.2) * 2.5 : 0;
    drawRocket(ctx, tipX, tipY + idleBob, angle, theme, opts.now, scene.phase);
  }

  // ── Particles + flash, then the shake transform wraps everything.
  for (const p of parts) {
    const a = Math.max(0, p.life / p.max);
    if (p.kind === "ring") {
      const r = p.size + (1 - a) * 90;
      ctx.globalAlpha = a * 0.8;
      ctx.strokeStyle = theme.danger;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.stroke();
      continue;
    }
    ctx.globalAlpha = a;
    if (p.kind === "spark") {
      ctx.fillStyle = Math.random() < 0.5 ? "#fb923c" : theme.warning;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    } else if (p.kind === "debris") {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin ?? 0);
      ctx.fillStyle = hexA(theme.muted, 0.9);
      ctx.fillRect(-p.size, -p.size * 0.6, p.size * 2, p.size * 1.2);
      ctx.restore();
    } else if (p.kind === "coin") {
      ctx.fillStyle = theme.warning;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillStyle = hexA(theme.muted, 0.3 * a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (2 - a), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  if (opts.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, opts.flash)})`;
    ctx.fillRect(-20, -20, w + 40, h + 40);
  }
  ctx.restore();
}

function drawRocket(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  angle: number,
  theme: CrashTheme,
  now: number,
  phase: CrashPhase,
): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);

  // Exhaust flame — flickering, longer mid-flight, a pilot light on the pad.
  const flick = 0.75 + 0.25 * Math.sin(now * 31) * Math.sin(now * 17);
  const flying = phase === "flying" || phase === "cashed";
  const flameLen = (flying ? 26 : 9) * flick;
  const flame = ctx.createLinearGradient(-12, 0, -12 - flameLen, 0);
  flame.addColorStop(0, "rgba(251,146,60,0.95)");
  flame.addColorStop(0.6, "rgba(249,115,22,0.55)");
  flame.addColorStop(1, "rgba(249,115,22,0)");
  ctx.fillStyle = flame;
  ctx.beginPath();
  ctx.moveTo(-12, -3.5);
  ctx.lineTo(-12 - flameLen, 0);
  ctx.lineTo(-12, 3.5);
  ctx.closePath();
  ctx.fill();

  // Fins.
  ctx.fillStyle = hexA(theme.accent, 0.9);
  ctx.beginPath();
  ctx.moveTo(-6, -5);
  ctx.lineTo(-14, -11);
  ctx.lineTo(-11, -4);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(-6, 5);
  ctx.lineTo(-14, 11);
  ctx.lineTo(-11, 4);
  ctx.closePath();
  ctx.fill();

  // Body: silver capsule, nose to the right (+x).
  const body = ctx.createLinearGradient(0, -6, 0, 6);
  body.addColorStop(0, "#e8e8f2");
  body.addColorStop(0.55, "#c9c9da");
  body.addColorStop(1, "#9d9db4");
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.moveTo(-12, -5);
  ctx.lineTo(6, -5);
  ctx.quadraticCurveTo(21, -4, 21, 0);
  ctx.quadraticCurveTo(21, 4, 6, 5);
  ctx.lineTo(-12, 5);
  ctx.closePath();
  ctx.fill();

  // Porthole.
  ctx.fillStyle = hexA(theme.accent, 0.85);
  ctx.beginPath();
  ctx.arc(7, 0, 2.6, 0, Math.PI * 2);
  ctx.fill();

  // The badge it carries: a small gold diamond on the hull.
  ctx.fillStyle = theme.warning;
  ctx.save();
  ctx.translate(-4, 0);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-2.2, -2.2, 4.4, 4.4);
  ctx.restore();

  ctx.restore();
}

/** #rrggbb / css color → same colour at alpha `a` (canvas-safe). */
function hexA(color: string, a: number): string {
  const trimmed = color.trim();
  if (trimmed.startsWith("#") && (trimmed.length === 7 || trimmed.length === 4)) {
    let r: number, g: number, b: number;
    if (trimmed.length === 4) {
      r = parseInt(trimmed[1] + trimmed[1], 16);
      g = parseInt(trimmed[2] + trimmed[2], 16);
      b = parseInt(trimmed[3] + trimmed[3], 16);
    } else {
      r = parseInt(trimmed.slice(1, 3), 16);
      g = parseInt(trimmed.slice(3, 5), 16);
      b = parseInt(trimmed.slice(5, 7), 16);
    }
    return `rgba(${r},${g},${b},${a})`;
  }
  // rgb()/named colours: layer the alpha through globalAlpha at the caller's
  // expense is not worth it — fall back to a neutral grey line.
  return `rgba(154,154,176,${a})`;
}

function mod(value: number, by: number): number {
  return ((value % by) + by) % by;
}
