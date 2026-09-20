"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BadgeImage } from "@/components/badges/BadgeImage";

export interface OwnedBadgeOption {
  slug: string;
  title: string;
  image_url_1x: string | null;
  image_url_2x: string | null;
  image_url_4x: string | null;
}

export default function AccountSettings({
  profile,
  ownedBadges,
}: {
  profile: {
    displayName: string | null;
    bio: string | null;
    bannerUrl: string | null;
    color: string | null;
    inventoryPublic: boolean;
    showcaseSlots: string[];
  };
  ownedBadges: OwnedBadgeOption[];
}) {
  const t = useTranslations("account");
  const router = useRouter();

  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio ?? "");
  const [bannerUrl, setBannerUrl] = useState(profile.bannerUrl ?? "");
  const [color, setColor] = useState(profile.color ?? "#a970ff");
  const [inventoryPublic, setInventoryPublic] = useState(profile.inventoryPublic);
  const [showcaseSlots, setShowcaseSlots] = useState<string[]>(
    profile.showcaseSlots ?? [],
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  function toggleShowcase(slug: string) {
    setShowcaseSlots((current) => {
      if (current.includes(slug)) return current.filter((s) => s !== slug);
      if (current.length >= 6) return current;
      return [...current, slug];
    });
  }

  async function save() {
    setState("saving");
    try {
      const res = await fetch("/api/account", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          displayName,
          bio,
          bannerUrl,
          color,
          inventoryPublic,
          showcaseSlots,
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

  const bySlug = new Map(ownedBadges.map((badge) => [badge.slug, badge]));

  return (
    <div className="space-y-6">
      {/* Profile fields */}
      <section className="card space-y-4 p-6">
        <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">
          {t("profileSection")}
        </h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              {t("displayName")}
            </span>
            <input
              className="input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={64}
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-muted">
              {t("color")}
            </span>
            <span className="flex items-center gap-2">
              <input
                type="color"
                className="input h-[42px] w-16 cursor-pointer p-1"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                aria-label={t("color")}
              />
              <code className="text-xs text-muted">{color}</code>
            </span>
          </label>
        </div>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">{t("bio")}</span>
          <textarea
            className="input min-h-24"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            placeholder={t("bioPlaceholder")}
            maxLength={280}
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-muted">
            {t("banner")}
          </span>
          <input
            className="input"
            type="url"
            value={bannerUrl}
            onChange={(e) => setBannerUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={inventoryPublic}
            onChange={(e) => setInventoryPublic(e.target.checked)}
            className="size-4 accent-[var(--accent)]"
          />
          <span className="text-sm">
            {t("publicInventory")}
            <span className="block text-xs text-muted">{t("publicInventoryHint")}</span>
          </span>
        </label>
      </section>

      {/* Showcase */}
      <section className="card space-y-4 p-6">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-bold uppercase tracking-[0.08em] text-muted">
            {t("showcase")}
          </h2>
          <button
            type="button"
            className="btn btn-secondary text-xs"
            onClick={() => setPickerOpen((open) => !open)}
          >
            {pickerOpen ? t("close") : t("chooseBadges")}
          </button>
        </div>
        <p className="text-xs text-muted">
          {t("showcaseHint")} ({t("maxSix")})
        </p>

        {showcaseSlots.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {showcaseSlots.map((slug) => {
              const badge = bySlug.get(slug);
              return (
                <button
                  key={slug}
                  type="button"
                  onClick={() => toggleShowcase(slug)}
                  className="card card-interactive flex items-center gap-2 px-3 py-2"
                  title={`${badge?.title ?? slug} — remove`}
                >
                  {badge ? <BadgeImage badge={badge} size={24} /> : null}
                  <span className="max-w-40 truncate text-xs font-semibold">
                    {badge?.title ?? slug}
                  </span>
                  <span aria-hidden className="text-muted">×</span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted">{t("showcaseHint")}</p>
        )}

        {pickerOpen && (
          <div className="max-h-72 overflow-y-auto rounded-[var(--radius-input)] border border-line bg-surface-2 p-3">
            {ownedBadges.length === 0 ? (
              <p className="p-4 text-center text-xs text-muted">{t("showcaseHint")}</p>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                {ownedBadges.map((badge) => {
                  const selected = showcaseSlots.includes(badge.slug);
                  return (
                    <button
                      key={badge.slug}
                      type="button"
                      onClick={() => toggleShowcase(badge.slug)}
                      className={`badge-tile rounded-[var(--radius-input)] border transition-colors ${
                        selected
                          ? "border-accent bg-accent-soft"
                          : "border-transparent hover:border-line-strong"
                      }`}
                      aria-pressed={selected}
                    >
                      <BadgeImage badge={badge} size={36} />
                      <p className="line-clamp-2 text-[0.625rem] font-semibold leading-tight">
                        {badge.title}
                      </p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          className="btn btn-primary"
          onClick={save}
          disabled={state === "saving"}
        >
          {state === "saving" ? t("saving") : t("save")}
        </button>
        {state === "saved" && (
          <span className="text-sm font-semibold text-success">{t("saved")}</span>
        )}
        {state === "error" && (
          <span className="text-sm font-semibold text-danger">✗</span>
        )}
      </div>
    </div>
  );
}
