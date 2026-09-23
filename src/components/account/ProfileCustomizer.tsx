"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

/**
 * Profile customizer: 20 common + 15 creative settings, plus steal settings
 * and the mood status. Everything is stored as one customization document
 * (plus dedicated columns) via /api/account.
 */

interface Customization {
  // Legacy document fields. The columns of the same name are owned by
  // AccountSettings and are what the profile renders; `color` doubles as the
  // profile page's fallback when the column is null. They stay on the type so an
  // existing document round-trips — this editor no longer writes them.
  displayName: string;
  bio: string;
  bannerUrl: string;
  color: string;
  // 20 common
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
  // 0, not 30: the profile page treats an unset value as "no overlay", so a
  // default of 30 darkened every banner on the first save without the member
  // touching the slider.
  avatarFrame: "none", bannerOverlay: 0, showcaseLayout: "grid",
  showStats: true, showInventory: true, showLevel: true, showCoins: true,
  showVisitors: true, socialTwitter: "", socialDiscord: "", title: "", density: "cozy",
  aura: false, particles: false, nameRainbow: false, bannerShine: true,
  tilt3d: false, pixelAvatar: false, achievementTicker: true, greetingBanner: true,
  levelHalo: "#a970ff", cursorBadge: false, statusBubble: "",
  profileTheme: "auto", effectsIntensity: "subtle", coinRainAuto: false,
  visitorMarquee: true,
};

type Field =
  | { key: keyof Customization; kind: "text"; label: string; placeholder?: string; placeholderKey?: string }
  | { key: keyof Customization; kind: "color"; label: string }
  | { key: keyof Customization; kind: "toggle"; label: string; hint?: string }
  | { key: keyof Customization; kind: "select"; label: string; options: Array<[string, string]> }
  | { key: keyof Customization; kind: "range"; label: string; min: number; max: number };

// This editor owns ONLY the `customization` document, the mood and the steal
// settings. `displayName` / `bio` / `bannerUrl` / `color` are the *columns* that
// AccountSettings edits: the account page mounts both forms, and this one used to
// seed those four from the customization document (empty for a member who never
// opened it) and ship them on every save — so toggling one effect wiped the
// member's name, bio and banner and reverted a colour set in the sibling editor.
const COMMON_FIELDS: Field[] = [
  { key: "title", kind: "text", label: "title", placeholderKey: "titlePlaceholder" },
  { key: "accent2", kind: "color", label: "accent2" },
  { key: "font", kind: "select", label: "font", options: [["sans", "options.font.sans"], ["serif", "options.font.serif"], ["mono", "options.font.mono"], ["rounded", "options.font.rounded"]] },
  { key: "cardStyle", kind: "select", label: "cardStyle", options: [["glass", "options.cardStyle.glass"], ["solid", "options.cardStyle.solid"], ["outline", "options.cardStyle.outline"]] },
  { key: "radius", kind: "select", label: "radius", options: [["sharp", "options.radius.sharp"], ["soft", "options.radius.soft"], ["round", "options.radius.round"]] },
  { key: "nameGradient", kind: "text", label: "nameGradient", placeholder: "#a970ff,#60a5fa" },
  { key: "avatarFrame", kind: "select", label: "avatarFrame", options: [["none", "options.avatarFrame.none"], ["ring", "options.avatarFrame.ring"], ["double", "options.avatarFrame.double"], ["glow", "options.avatarFrame.glow"], ["crown", "options.avatarFrame.crown"]] },
  { key: "bannerOverlay", kind: "range", label: "bannerOverlay", min: 0, max: 90 },
  { key: "showcaseLayout", kind: "select", label: "showcaseLayout", options: [["grid", "options.showcaseLayout.grid"], ["row", "options.showcaseLayout.row"], ["carousel", "options.showcaseLayout.carousel"]] },
  { key: "showStats", kind: "toggle", label: "showStats" },
  { key: "showInventory", kind: "toggle", label: "showInventory" },
  { key: "showLevel", kind: "toggle", label: "showLevel" },
  { key: "showCoins", kind: "toggle", label: "showCoins" },
  { key: "showVisitors", kind: "toggle", label: "showVisitors" },
  { key: "socialTwitter", kind: "text", label: "socialTwitter", placeholderKey: "usernamePlaceholder" },
  { key: "socialDiscord", kind: "text", label: "socialDiscord", placeholderKey: "usernamePlaceholder" },
  { key: "density", kind: "select", label: "density", options: [["cozy", "options.density.cozy"], ["compact", "options.density.compact"]] },
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
  { key: "statusBubble", kind: "text", label: "statusBubble", placeholderKey: "statusBubblePlaceholder" },
  { key: "profileTheme", kind: "select", label: "profileTheme", options: [["auto", "options.profileTheme.auto"], ["violet", "options.profileTheme.violet"], ["emerald", "options.profileTheme.emerald"], ["sapphire", "options.profileTheme.sapphire"], ["gold", "options.profileTheme.gold"]] },
  { key: "effectsIntensity", kind: "select", label: "effectsIntensity", options: [["off", "options.effectsIntensity.off"], ["subtle", "options.effectsIntensity.subtle"], ["full", "options.effectsIntensity.full"]] },
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
  const te = useTranslations("errors");
  const router = useRouter();
  const [values, setValues] = useState<Customization>({ ...DEFAULTS, ...initial });
  const [mood, setMood] = useState(initialMood);
  const [stealSettings, setStealSettings] = useState(steal);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Cancel the pending state update on unmount: React 18 no longer warns about
  // setting state on an unmounted component, so nothing surfaced this.
  useEffect(
    () => () => {
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
    },
    [],
  );

  function set<K extends keyof Customization>(key: K, value: Customization[K]) {
    setValues((prev) => ({ ...prev, [key]: value }));
  }

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // Only the fields this editor owns. `displayName` / `bio` / `bannerUrl` /
        // `color` belong to AccountSettings (the columns): the route writes any
        // string field it is handed and treats an absent one as "leave it alone",
        // and this form's copy of those four lives in the customization document,
        // which is empty for anyone who never opened it.
        body: JSON.stringify({
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
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setState("idle"), 3000);
    } catch {
      setState("error");
      if (resetTimer.current !== null) clearTimeout(resetTimer.current);
      resetTimer.current = setTimeout(() => setState("idle"), 3000);
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
              placeholder={field.placeholderKey ? t(field.placeholderKey) : field.placeholder}
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
                <option key={optionValue} value={optionValue}>{t(optionLabel)}</option>
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
          aria-label={t("moodSection")}
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
              onChange={(event) => {
                // Keep the last valid number while the field is empty: `Number("") || 0`
                // rewrote a cleared field to 0, so retyping concatenated onto a
                // sentinel instead of the digits actually entered.
                const parsed = Number(event.target.value);
                setStealSettings((prev) => ({
                  ...prev,
                  price:
                    event.target.value.trim() !== "" && Number.isFinite(parsed)
                      ? Math.max(0, Math.min(10000, Math.trunc(parsed)))
                      : prev.price,
                }));
              }}
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
              onChange={(event) => {
                // Same rule as steal_price above: an emptied field keeps its last
                // valid value instead of becoming the `10` sentinel.
                const parsed = Number(event.target.value);
                setStealSettings((prev) => ({
                  ...prev,
                  max:
                    event.target.value.trim() !== "" && Number.isFinite(parsed)
                      ? Math.max(10, Math.min(10000, Math.trunc(parsed)))
                      : prev.max,
                }));
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted">{t("stealHint")}</p>
      </section>

      <div className="flex items-center gap-3">
        <button type="button" className="btn btn-primary" onClick={save} disabled={state === "saving"}>
          {state === "saving" ? t("saving") : t("save")}
        </button>
        {/* One live region for both outcomes: the error used to be a bare "✗"
            with no accessible name, and neither state was announced — a screen
            reader learned nothing from pressing Save. Mirrors AccountSettings. */}
        <span role="status" aria-live="polite" className="text-sm font-semibold">
          {state === "saved" ? <span className="text-success">{t("saved")}</span> : null}
          {state === "error" ? <span className="text-danger">{te("generic")}</span> : null}
        </span>
      </div>
    </div>
  );
}
