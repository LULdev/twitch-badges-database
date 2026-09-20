"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Profile customizer: 20 common + 15 creative settings, plus steal settings
 * and the mood status. Everything is stored as one customization document
 * (plus dedicated columns) via /api/account.
 */

interface Customization {
  // 20 common
  displayName: string;
  bio: string;
  bannerUrl: string;
  color: string;
  accent2: string;
  font: "sans" | "serif" | "mono" | "rounded";
  cardStyle: "glass" | "solid" | "outline";
  radius: "sharp" | "soft" | "round";
  nameGradient: string;
  avatarFrame: "none" | "ring" | "double" | "glow" | "crown";
  bannerOverlay: number;
  showcaseLayout: "grid" | "row" | "carousel";
  showStats: boolean;
  showInventory: boolean;
  showLevel: boolean;
  showCoins: boolean;
  showVisitors: boolean;
  socialTwitter: string;
  socialDiscord: string;
  title: string;
  density: "cozy" | "compact";
  // 15 creative
  aura: boolean;
  particles: boolean;
  nameRainbow: boolean;
  bannerShine: boolean;
  tilt3d: boolean;
  pixelAvatar: boolean;
  achievementTicker: boolean;
  greetingBanner: boolean;
  levelHalo: string;
  cursorBadge: boolean;
  statusBubble: string;
  profileTheme: "auto" | "violet" | "emerald" | "sapphire" | "gold";
  effectsIntensity: "off" | "subtle" | "full";
  coinRainAuto: boolean;
  visitorMarquee: boolean;
}

const DEFAULTS: Customization = {
  displayName: "", bio: "", bannerUrl: "", color: "#a970ff", accent2: "#60a5fa",
  font: "sans", cardStyle: "glass", radius: "soft", nameGradient: "",
  avatarFrame: "none", bannerOverlay: 30, showcaseLayout: "grid",
  showStats: true, showInventory: true, showLevel: true, showCoins: true,
  showVisitors: true, socialTwitter: "", socialDiscord: "", title: "", density: "cozy",
  aura: false, particles: false, nameRainbow: false, bannerShine: true,
  tilt3d: false, pixelAvatar: false, achievementTicker: true, greetingBanner: true,
  levelHalo: "#a970ff", cursorBadge: false, statusBubble: "",
  profileTheme: "auto", effectsIntensity: "subtle", coinRainAuto: false,
  visitorMarquee: true,
};

type Field =
  | { key: keyof Customization; kind: "text"; label: string; placeholder?: string }
  | { key: keyof Customization; kind: "color"; label: string }
  | { key: keyof Customization; kind: "toggle"; label: string; hint?: string }
  | { key: keyof Customization; kind: "select"; label: string; options: Array<[string, string]> }
  | { key: keyof Customization; kind: "range"; label: string; min: number; max: number };

const COMMON_FIELDS: Field[] = [
  { key: "displayName", kind: "text", label: "displayName" },
  { key: "title", kind: "text", label: "title", placeholder: "Badge Hunter" },
  { key: "bio", kind: "text", label: "bio" },
  { key: "bannerUrl", kind: "text", label: "banner" },
  { key: "color", kind: "color", label: "color" },
  { key: "accent2", kind: "color", label: "accent2" },
  { key: "font", kind: "select", label: "font", options: [["sans", "Sans"], ["serif", "Serif"], ["mono", "Mono"], ["rounded", "Rounded"]] },
  { key: "cardStyle", kind: "select", label: "cardStyle", options: [["glass", "Glass"], ["solid", "Solid"], ["outline", "Outline"]] },
  { key: "radius", kind: "select", label: "radius", options: [["sharp", "Sharp"], ["soft", "Soft"], ["round", "Round"]] },
  { key: "nameGradient", kind: "text", label: "nameGradient", placeholder: "#a970ff,#60a5fa" },
  { key: "avatarFrame", kind: "select", label: "avatarFrame", options: [["none", "None"], ["ring", "Ring"], ["double", "Double"], ["glow", "Glow"], ["crown", "Crown"]] },
  { key: "bannerOverlay", kind: "range", label: "bannerOverlay", min: 0, max: 90 },
  { key: "showcaseLayout", kind: "select", label: "showcaseLayout", options: [["grid", "Grid"], ["row", "Row"], ["carousel", "Carousel"]] },
  { key: "showStats", kind: "toggle", label: "showStats" },
  { key: "showInventory", kind: "toggle", label: "showInventory" },
  { key: "showLevel", kind: "toggle", label: "showLevel" },
  { key: "showCoins", kind: "toggle", label: "showCoins" },
  { key: "showVisitors", kind: "toggle", label: "showVisitors" },
  { key: "socialTwitter", kind: "text", label: "socialTwitter", placeholder: "username" },
  { key: "socialDiscord", kind: "text", label: "socialDiscord", placeholder: "username" },
  { key: "density", kind: "select", label: "density", options: [["cozy", "Cozy"], ["compact", "Compact"]] },
];

const CREATIVE_FIELDS: Field[] = [
  { key: "aura", kind: "toggle", label: "aura", hint: "auraHint" },
  { key: "particles", kind: "toggle", label: "particles", hint: "particlesHint" },
  { key: "nameRainbow", kind: "toggle", label: "nameRainbow" },
  { key: "bannerShine", kind: "toggle", label: "bannerShine" },
  { key: "tilt3d", kind: "toggle", label: "tilt3d" },
  { key: "pixelAvatar", kind: "toggle", label: "pixelAvatar" },
  { key: "achievementTicker", kind: "toggle", label: "achievementTicker" },
  { key: "greetingBanner", kind: "toggle", label: "greetingBanner" },
  { key: "levelHalo", kind: "color", label: "levelHalo" },
  { key: "cursorBadge", kind: "toggle", label: "cursorBadge" },
  { key: "statusBubble", kind: "text", label: "statusBubble", placeholder: "hunting SUBtember…" },
  { key: "profileTheme", kind: "select", label: "profileTheme", options: [["auto", "Auto"], ["violet", "Violet"], ["emerald", "Emerald"], ["sapphire", "Sapphire"], ["gold", "Gold"]] },
  { key: "effectsIntensity", kind: "select", label: "effectsIntensity", options: [["off", "Off"], ["subtle", "Subtle"], ["full", "Full"]] },
  { key: "coinRainAuto", kind: "toggle", label: "coinRainAuto" },
  { key: "visitorMarquee", kind: "toggle", label: "visitorMarquee" },
];

export default function ProfileCustomizer({
  initial,
  initialMood,
  steal,
}: {
  initial: Partial<Customization>;
  initialMood: string;
  steal: { enabled: boolean; price: number; max: number };
}) {
  const t = useTranslations("customizer");
  const router = useRouter();
  const [values, setValues] = useState<Customization>({ ...DEFAULTS, ...initial });
  const [mood, setMood] = useState(initialMood);
  const [stealSettings, setStealSettings] = useState(steal);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function set<K extends keyof Customization>(key: K, value: Customization[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName: values.displayName,
          bio: values.bio,
          bannerUrl: values.bannerUrl,
          color: values.color,
          mood,
          customization: values,
          stealEnabled: stealSettings.enabled,
          stealPrice: stealSettings.price,
          stealMax: stealSettings.max,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("saved");
      router.refresh();
      setTimeout(() => setState("idle"), 3000);
    } catch {
      setState("error");
      setTimeout(() => setState("idle"), 3000);
    }
  }

  function renderField(field: Field) {
    const value = values[field.key];
    const label = t(field.label);
    switch (field.kind) {
      case "text":
        return (
          <label key={field.key} className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">{label}</span>
            <input
              className="input"
              value={String(value ?? "")}
              placeholder={field.placeholder}
              maxLength={120}
              onChange={(event) => set(field.key, event.target.value as Customization[typeof field.key])}
            />
          </label>
        );
      case "color":
        return (
          <label key={field.key} className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">{label}</span>
            <span className="flex items-center gap-2">
              <input
                type="color"
                className="input h-[42px] w-16 cursor-pointer p-1"
                value={String(value ?? "#a970ff")}
                onChange={(event) => set(field.key, event.target.value as Customization[typeof field.key])}
                aria-label={label}
              />
              <code className="text-xs text-muted">{String(value)}</code>
            </span>
          </label>
        );
      case "toggle":
        return (
          <label key={field.key} className="flex items-start gap-3 py-1">
            <input
              type="checkbox"
              checked={Boolean(value)}
              onChange={(event) => set(field.key, event.target.checked as Customization[typeof field.key])}
              className="mt-0.5 size-4 accent-[var(--accent)]"
            />
            <span className="text-sm">
              {label}
              {field.hint ? <span className="block text-xs text-muted">{t(field.hint)}</span> : null}
            </span>
          </label>
        );
      case "select":
        return (
          <label key={field.key} className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">{label}</span>
            <select
              className="input"
              value={String(value ?? "")}
              onChange={(event) => set(field.key, event.target.value as Customization[typeof field.key])}
            >
              {field.options.map(([optionValue, optionLabel]) => (
                <option key={optionValue} value={optionValue}>{optionLabel}</option>
              ))}
            </select>
          </label>
        );
      case "range":
        return (
          <label key={field.key} className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              {label}: {Number(value)}%
            </span>
            <input
              type="range"
              min={field.min}
              max={field.max}
              value={Number(value)}
              onChange={(event) => set(field.key, Number(event.target.value) as Customization[typeof field.key])}
              className="w-full accent-[var(--accent)]"
            />
          </label>
        );
    }
  }

  return (
    <div className="space-y-6">
      <section className="card space-y-4 p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">{t("commonSection")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {COMMON_FIELDS.map(renderField)}
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">{t("creativeSection")}</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {CREATIVE_FIELDS.map(renderField)}
        </div>
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">{t("moodSection")}</h2>
        <input
          className="input"
          value={mood}
          maxLength={60}
          placeholder={t("statusBubble")}
          onChange={(event) => setMood(event.target.value)}
        />
      </section>

      <section className="card space-y-4 p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">{t("stealSection")}</h2>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={stealSettings.enabled}
            onChange={(event) => setStealSettings((prev) => ({ ...prev, enabled: event.target.checked }))}
            className="size-4 accent-[var(--accent)]"
          />
          <span className="text-sm">{t("stealEnabled")}</span>
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">{t("stealPrice")}</span>
            <input
              type="number"
              className="input"
              min={0}
              max={10000}
              value={stealSettings.price}
              onChange={(event) => setStealSettings((prev) => ({ ...prev, price: Number(event.target.value) || 0 }))}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">{t("stealMax")}</span>
            <input
              type="number"
              className="input"
              min={10}
              max={10000}
              value={stealSettings.max}
              onChange={(event) => setStealSettings((prev) => ({ ...prev, max: Number(event.target.value) || 10 }))}
            />
          </label>
        </div>
        <p className="text-xs text-muted">{t("stealHint")}</p>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={state === "saving"}>
          {state === "saving" ? t("saving") : t("save")}
        </button>
        {state === "saved" && <span className="text-sm font-semibold text-success">{t("saved")}</span>}
        {state === "error" && <span className="text-sm font-semibold text-danger">✗</span>}
      </div>
    </div>
  );
}
