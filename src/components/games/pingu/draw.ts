import type { Sim } from "@/lib/games/pingu-sim";
import { LAYOUT } from "@/lib/games/pingu-sim";
// Assets live in public/game/pingu and load by URL: Next's static image
// imports return StaticImageData objects, and the loader below needs plain
// same-origin string URLs for its canvas alpha scan.
const skyUrl = "/game/pingu/sky.jpg";
const yetiUrl = "/game/pingu/yeti.webp";
const clubUrl = "/game/pingu/club.webp";
const standUrl = "/game/pingu/penguin-stand.webp";
const flyUrl = "/game/pingu/penguin-fly.webp";
const cliffUrl = "/game/pingu/cliff.webp";
const pineUrl = "/game/pingu/pine.webp";
const rockUrl = "/game/pingu/rock.webp";
const signUrl = "/game/pingu/sign.webp";
const snowUrl = "/game/pingu/snow.webp";

export type Sprite = {
  img: HTMLImageElement;
  minx: number;
  miny: number;
  maxx: number;
  maxy: number;
};

export type Sprites = {
  sky: HTMLImageElement;
  yeti: Sprite;
  club: Sprite;
  stand: Sprite;
  fly: Sprite;
  cliff: Sprite;
  pine: Sprite;
  rock: Sprite;
  sign: Sprite;
  snow: Sprite;
};

export type Particle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  r: number;
  kind: "puff" | "chip" | "spark";
};

export type Cam = { x: number; y: number; ppm: number; ax: number; ay: number };

const SIGNS = [25, 50, 75, 100, 150, 200, 250, 300, 400, 500, 700];

const PROPS: { kind: "pine" | "rock"; x: number; scale: number }[] = [];
for (let i = 0; i < 70; i++) {
  const x = 7 + i * 12.5 + ((i * 47) % 8);
  PROPS.push({
    kind: i % 5 === 2 ? "rock" : "pine",
    x,
    scale: 0.82 + ((i * 13) % 6) * 0.05,
  });
}

function loadImage(src: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(src));
    img.src = src;
  });
}

function measure(img: HTMLImageElement): Sprite {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  if (!g) return { img, minx: 0, miny: 0, maxx: img.width, maxy: img.height };
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, c.width, c.height).data;
  let minx = c.width;
  let miny = c.height;
  let maxx = 0;
  let maxy = 0;
  for (let y = 0; y < c.height; y += 2) {
    for (let x = 0; x < c.width; x += 2) {
      if (data[(y * c.width + x) * 4 + 3]! > 24) {
        if (x < minx) minx = x;
        if (y < miny) miny = y;
        if (x > maxx) maxx = x;
        if (y > maxy) maxy = y;
      }
    }
  }
  if (maxx <= minx || maxy <= miny) return { img, minx: 0, miny: 0, maxx: img.width, maxy: img.height };
  return { img, minx, miny, maxx: maxx + 2, maxy: maxy + 2 };
}

export async function loadSprites(): Promise<Sprites> {
  const [sky, yeti, club, stand, fly, cliff, pine, rock, sign, snow] = await Promise.all([
    loadImage(skyUrl),
    loadImage(yetiUrl),
    loadImage(clubUrl),
    loadImage(standUrl),
    loadImage(flyUrl),
    loadImage(cliffUrl),
    loadImage(pineUrl),
    loadImage(rockUrl),
    loadImage(signUrl),
    loadImage(snowUrl),
  ]);
  return {
    sky,
    yeti: measure(yeti),
    club: measure(club),
    stand: measure(stand),
    fly: measure(fly),
    cliff: measure(cliff),
    pine: measure(pine),
    rock: measure(rock),
    sign: measure(sign),
    snow: measure(snow),
  };
}

export function desiredCam(sim: Sim, w: number, h: number): Cam {
  const flying = sim.phase === "flight" || sim.phase === "done";
  if (!flying) {
    const ppm = Math.min(w / 12.4, (h * 0.64) / 9.4);
    return { x: 1.05, y: 0, ppm: Math.max(34, ppm), ax: 0.48, ay: 0.6 };
  }
  const alt = Math.max(0.8, sim.y);
  const spanH = Math.min(26, Math.max(9.5, alt + 7.2));
  const spanW = Math.min(42, Math.max(15, Math.abs(sim.vx) * 0.45 + 16));
  const ppm = Math.min(w / spanW, h / spanH);
  return {
    x: sim.x,
    y: Math.min(8, alt * 0.28),
    ppm: Math.max(20, Math.min(ppm, 96)),
    ax: 0.36,
    ay: 0.64,
  };
}

function toScreen(x: number, y: number, cam: Cam, w: number, h: number) {
  return {
    sx: (x - cam.x) * cam.ppm + w * cam.ax,
    sy: (cam.y - y) * cam.ppm + h * cam.ay,
  };
}

function drawSprite(
  ctx: CanvasRenderingContext2D,
  spr: Sprite,
  sx: number,
  sy: number,
  ppm: number,
  fit: { w?: number; h?: number },
  ax: number,
  ay: number,
  rot: number,
) {
  const dw = spr.maxx - spr.minx;
  const dh = spr.maxy - spr.miny;
  if (dw < 2 || dh < 2) return;
  const aspect = dw / dh;
  let pw: number;
  let ph: number;
  if (fit.h) {
    ph = fit.h * ppm;
    pw = ph * aspect;
  } else {
    pw = (fit.w ?? 1) * ppm;
    ph = pw / aspect;
  }
  ctx.save();
  ctx.translate(sx, sy);
  ctx.rotate(rot);
  ctx.drawImage(spr.img, spr.minx, spr.miny, dw, dh, -ax * pw, -ay * ph, pw, ph);
  ctx.restore();
}

export function drawWorld(
  ctx: CanvasRenderingContext2D,
  sim: Sim,
  sprites: Sprites,
  cam: Cam,
  w: number,
  h: number,
  particles: Particle[],
  best: number,
  shakeX: number,
  shakeY: number,
  flash: number,
  squash: number,
  time: number,
) {
  ctx.save();
  ctx.translate(shakeX, shakeY);
  ctx.clearRect(-20, -20, w + 40, h + 40);

  const sky = sprites.sky;
  const skyScale = Math.max(w / sky.width, (h * 0.78) / (sky.height * 0.62));
  const dw = sky.width * skyScale;
  const dh = sky.height * 0.62 * skyScale;
  const parallax = -((cam.x * 12) % dw);
  ctx.drawImage(sky, 0, 0, sky.width, sky.height * 0.62, parallax, 0, dw, dh);
  ctx.drawImage(sky, 0, 0, sky.width, sky.height * 0.62, parallax + dw, 0, dw, dh);
  const fade = ctx.createLinearGradient(0, h * 0.45, 0, h);
  fade.addColorStop(0, "rgba(214, 238, 248, 0)");
  fade.addColorStop(0.55, "rgba(228, 242, 250, 0.2)");
  fade.addColorStop(1, "rgba(214, 236, 246, 0.85)");
  ctx.fillStyle = fade;
  ctx.fillRect(0, 0, w, h);

  const ground = toScreen(0, 0, cam, w, h);
  const iceTop = ground.sy;
  const ice = ctx.createLinearGradient(0, iceTop, 0, h);
  ice.addColorStop(0, "#f7fbff");
  ice.addColorStop(0.08, "#e7f6fb");
  ice.addColorStop(0.35, "#c5e4f2");
  ice.addColorStop(1, "#8ebbd0");
  ctx.fillStyle = ice;
  ctx.fillRect(0, iceTop, w, h - iceTop + 30);

  const tileM = 6.2;
  const snowH = 1.15;
  const viewLeft = cam.x - (w * cam.ax) / cam.ppm - 2;
  const viewRight = cam.x + (w * (1 - cam.ax)) / cam.ppm + 2;
  const startTile = Math.floor(viewLeft / tileM) - 1;
  const endTile = Math.ceil(viewRight / tileM) + 1;
  for (let i = startTile; i <= endTile; i++) {
    const p = toScreen(i * tileM, 0.08, cam, w, h);
    const flip = Math.abs(i) % 2 === 1;
    ctx.save();
    ctx.translate(p.sx + (flip ? tileM * cam.ppm : 0), p.sy);
    if (flip) ctx.scale(-1, 1);
    ctx.globalAlpha = 0.9;
    drawSprite(ctx, sprites.snow, 0, 0, cam.ppm, { w: tileM }, 0, 0.2, 0);
    ctx.restore();
  }

  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = Math.max(2, cam.ppm * 0.06);
  ctx.beginPath();
  ctx.moveTo(0, iceTop + 1);
  ctx.lineTo(w, iceTop + 1);
  ctx.stroke();

  for (const prop of PROPS) {
    if (prop.x < viewLeft - 2 || prop.x > viewRight + 2) continue;
    const p = toScreen(prop.x, 0, cam, w, h);
    const spr = prop.kind === "pine" ? sprites.pine : sprites.rock;
    const height = (prop.kind === "pine" ? 2.35 : 0.85) * prop.scale;
    drawSprite(ctx, spr, p.sx, p.sy, cam.ppm, { h: height }, 0.5, 1, 0);
  }

  ctx.font = `700 ${Math.max(14, cam.ppm * 0.42)}px var(--font-sans, system-ui), sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const m of SIGNS) {
    if (m < viewLeft - 1 || m > viewRight + 1) continue;
    const p = toScreen(m, 0, cam, w, h);
    drawSprite(ctx, sprites.sign, p.sx, p.sy, cam.ppm, { h: 1.85 }, 0.5, 1, 0);
    ctx.fillStyle = "#163544";
    ctx.fillText(String(m), p.sx, p.sy - 1.85 * cam.ppm * 0.72);
  }

  if (best > 8) {
    const p = toScreen(best, 0, cam, w, h);
    ctx.save();
    ctx.translate(p.sx, p.sy);
    ctx.strokeStyle = "#1f6f8f";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -cam.ppm * 1.55);
    ctx.stroke();
    ctx.fillStyle = "#e36b12";
    ctx.beginPath();
    ctx.moveTo(0, -cam.ppm * 1.55);
    ctx.lineTo(cam.ppm * 0.72, -cam.ppm * 1.38);
    ctx.lineTo(0, -cam.ppm * 1.18);
    ctx.fill();
    ctx.restore();
  }

  const cliff = toScreen(LAYOUT.cliffX, 0, cam, w, h);
  drawSprite(ctx, sprites.cliff, cliff.sx, cliff.sy, cam.ppm, { h: LAYOUT.cliffH }, 0.5, 1, 0);

  const drawClub = () => {
    const pivot = toScreen(LAYOUT.pivotX, LAYOUT.pivotY, cam, w, h);
    ctx.save();
    ctx.translate(pivot.sx, pivot.sy);
    ctx.rotate(-sim.club);
    drawSprite(ctx, sprites.club, 0, 0, cam.ppm, { w: LAYOUT.clubLen }, 0.04, 0.5, 0);
    ctx.restore();
  };

  const yetiFeet = toScreen(LAYOUT.yetiX, 0, cam, w, h);
  ctx.save();
  ctx.translate(yetiFeet.sx, yetiFeet.sy);
  ctx.fillStyle = "rgba(22, 53, 68, 0.16)";
  ctx.beginPath();
  ctx.ellipse(0, -2, cam.ppm * 0.7, cam.ppm * 0.16, 0, 0, Math.PI * 2);
  ctx.fill();
  let lean = 0;
  if (sim.phase === "dive") lean = -0.05;
  if (sim.phase === "swing" || (sim.phase === "flight" && sim.swingU < 1)) {
    const u = Math.max(0, Math.min(1, sim.swingU));
    lean = -0.08 + u * 0.22;
  }
  ctx.rotate(lean);
  drawSprite(ctx, sprites.yeti, 0, 0, cam.ppm, { h: LAYOUT.yetiH }, 0.52, 1, 0);
  ctx.restore();
  drawClub();

  const peng = toScreen(sim.x, sim.y, cam, w, h);
  const diving = sim.phase === "dive" || sim.phase === "swing" || sim.phase === "flight" || sim.phase === "done";
  const useFly = diving && !(sim.phase === "dive" && sim.diveT < LAYOUT.hopTime * 0.55);
  ctx.save();
  ctx.translate(peng.sx, peng.sy);
  ctx.fillStyle = "rgba(22, 53, 68, 0.14)";
  ctx.beginPath();
  ctx.ellipse(0, (sim.y - 0) * cam.ppm * 0 + cam.ppm * 0.02, cam.ppm * 0.42, cam.ppm * 0.1, 0, 0, Math.PI * 2);
  ctx.fill();
  const sx = squash;
  const sy = 1 / Math.max(0.6, squash);
  ctx.scale(sx, sy);
  if (!useFly) {
    drawSprite(ctx, sprites.stand, 0, cam.ppm * 0.48, cam.ppm, { h: 0.98 }, 0.5, 1, 0);
  } else {
    ctx.rotate(-sim.nose);
    drawSprite(ctx, sprites.fly, 0, 0, cam.ppm, { w: 1.15 }, 0.55, 0.55, 0);
  }
  ctx.restore();

  for (const p of particles) {
    const s = toScreen(p.x, p.y, cam, w, h);
    const a = Math.max(0, p.life / p.max);
    ctx.globalAlpha = a;
    if (p.kind === "spark") ctx.fillStyle = "#e36b12";
    else if (p.kind === "chip") ctx.fillStyle = "#d7f1f8";
    else ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.arc(s.sx, s.sy, p.r * cam.ppm, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  ctx.restore();

  if (flash > 0.01) {
    ctx.fillStyle = `rgba(255,255,255,${flash})`;
    ctx.fillRect(0, 0, w, h);
  }
}

export function spawnBurst(particles: Particle[], x: number, y: number, kind: Particle["kind"], n: number, speed: number) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI - (kind === "puff" ? Math.PI : 0);
    const s = speed * (0.4 + Math.random());
    particles.push({
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.abs(Math.sin(a)) * s + (kind === "puff" ? 1.2 : 0.4),
      life: 0.45 + Math.random() * 0.35,
      max: 0.8,
      r: kind === "spark" ? 0.06 : 0.08 + Math.random() * 0.08,
      kind,
    });
  }
}

export function stepParticles(particles: Particle[], dt: number) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i]!;
    p.life -= dt;
    p.vy -= 6 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.y < 0.05) {
      p.y = 0.05;
      p.vy *= -0.3;
      p.vx *= 0.8;
    }
    if (p.life <= 0) particles.splice(i, 1);
  }
  if (particles.length > 180) particles.splice(0, particles.length - 180);
}
