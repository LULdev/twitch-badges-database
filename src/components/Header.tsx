"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { usePathname, useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import LanguageSwitcher from "./LanguageSwitcher";
import ThemeToggle from "./ThemeToggle";
import { createClient } from "@/lib/supabase/browser";

export interface HeaderUser {
  username: string;
  avatarUrl: string | null;
}

export default function Header({ user }: { user: HeaderUser | null }) {
  const t = useTranslations("nav");
  const pathname = usePathname();
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);

  const links: Array<{ href: string; label: string }> = [
    { href: "/badges", label: t("badges") },
    { href: "/active", label: t("active") },
    { href: "/upcoming", label: t("upcoming") },
    { href: "/games", label: t("games") },
    { href: "/wheel", label: t("wheel") },
    { href: "/leaderboards", label: t("leaderboards") },
    { href: "/achievements", label: t("achievementsNav") },
    { href: "/feed", label: t("feedNav") },
    { href: "/compare", label: t("compare") },
    { href: "/stats", label: t("stats") },
    { href: "/blog", label: t("blog") },
    { href: "/faq", label: t("faqNav") },
    { href: "/changelog", label: t("changelog") },
  ];

  function isActive(href: string) {
    if (href === "/badges") {
      return pathname === "/badges" || pathname === "/";
    }
    return pathname.startsWith(href);
  }

  async function logout() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (error) {
      console.error("[header] logout failed:", error);
    }
    setUserMenuOpen(false);
    router.refresh();
  }

  return (
    <header className="sticky top-0 z-50 border-b border-line bg-[color-mix(in_srgb,var(--background)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4">
        <Link href="/" className="flex items-center gap-2 font-bold tracking-tight">
          <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-ink shadow-glow">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
            </svg>
          </span>
          <span className="hidden text-sm sm:inline">Twitch Badges DB</span>
        </Link>

        <nav className="hidden items-center gap-0.5 lg:flex" aria-label="Main">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={`rounded-lg px-2.5 py-1.5 text-[0.8125rem] font-semibold transition-colors ${
                isActive(link.href)
                  ? "text-foreground"
                  : "text-muted hover:text-foreground"
              }`}
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <div className="ms-auto flex items-center gap-1.5">
          <LanguageSwitcher />
          <ThemeToggle />
          {user ? (
            <div className="relative">
              <button
                type="button"
                onClick={() => setUserMenuOpen((open) => !open)}
                className="flex items-center gap-2 rounded-full border border-line py-1 pe-2.5 ps-1 transition-colors hover:border-line-strong"
                aria-haspopup="menu"
                aria-expanded={userMenuOpen}
              >
                {user.avatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={user.avatarUrl}
                    alt={user.username}
                    width={24}
                    height={24}
                    className="rounded-full"
                  />
                ) : (
                  <span className="grid size-6 place-items-center rounded-full bg-accent-soft text-[0.625rem] font-bold text-accent">
                    {user.username.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="max-w-24 truncate text-xs font-semibold">
                  {user.username}
                </span>
              </button>
              {userMenuOpen && (
                <div
                  role="menu"
                  className="card absolute end-0 top-11 z-50 w-44 overflow-hidden p-1"
                >
                  <Link
                    href={`/profile/${user.username}`}
                    className="block rounded-lg px-3 py-2 text-[0.8125rem] font-medium text-muted hover:bg-surface-2 hover:text-foreground"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    {t("profile")}
                  </Link>
                  <Link
                    href="/inventory"
                    className="block rounded-lg px-3 py-2 text-[0.8125rem] font-medium text-muted hover:bg-surface-2 hover:text-foreground"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    {t("inventory")}
                  </Link>
                  <Link
                    href="/notifications"
                    className="block rounded-lg px-3 py-2 text-[0.8125rem] font-medium text-muted hover:bg-surface-2 hover:text-foreground"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    {t("notifications")}
                  </Link>
                  <Link
                    href="/account"
                    className="block rounded-lg px-3 py-2 text-[0.8125rem] font-medium text-muted hover:bg-surface-2 hover:text-foreground"
                    onClick={() => setUserMenuOpen(false)}
                  >
                    {t("account")}
                  </Link>
                  <button
                    type="button"
                    onClick={logout}
                    className="block w-full rounded-lg px-3 py-2 text-start text-[0.8125rem] font-medium text-danger hover:bg-surface-2"
                  >
                    {t("logout")}
                  </button>
                </div>
              )}
            </div>
          ) : (
            <Link href="/login" className="btn btn-primary px-3 py-2 text-xs">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
              </svg>
              <span className="hidden sm:inline">{t("login")}</span>
            </Link>
          )}
          <button
            type="button"
            className="btn btn-ghost px-2.5 py-2 lg:hidden"
            aria-label={t("menu")}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              {menuOpen ? (
                <path d="M18 6 6 18M6 6l12 12" />
              ) : (
                <path d="M3 6h18M3 12h18M3 18h18" />
              )}
            </svg>
          </button>
        </div>
      </div>

      {menuOpen && (
        <nav
          className="border-t border-line bg-surface px-4 py-3 lg:hidden"
          aria-label="Mobile"
        >
          <div className="grid grid-cols-2 gap-1">
            {links.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="rounded-lg px-3 py-2 text-sm font-semibold text-muted hover:bg-surface-2 hover:text-foreground"
                onClick={() => setMenuOpen(false)}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </nav>
      )}
    </header>
  );
}
