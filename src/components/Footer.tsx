import { getTranslations } from "next-intl/server";
import { Link } from "@/i18n/navigation";

export default async function Footer() {
  const t = await getTranslations("footer");
  const nav = await getTranslations("nav");

  return (
    <footer className="mt-16 border-t border-line">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 font-bold">
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-ink">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
              </svg>
            </span>
            Twitch Badges Database
          </div>
          <p className="mt-3 max-w-md text-[0.8125rem] leading-relaxed text-muted">
            {t("description")}
          </p>
          <p className="mt-4 text-xs text-muted">{t("rights")}</p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            {t("explore")}
          </h3>
          <ul className="mt-3 space-y-2 text-[0.8125rem]">
            <li><Link className="text-muted hover:text-foreground" href="/badges">{nav("badges")}</Link></li>
            <li><Link className="text-muted hover:text-foreground" href="/active">{nav("active")}</Link></li>
            <li><Link className="text-muted hover:text-foreground" href="/upcoming">{nav("upcoming")}</Link></li>
            <li><Link className="text-muted hover:text-foreground" href="/expired">{nav("expired")}</Link></li>
            <li><Link className="text-muted hover:text-foreground" href="/leaderboards">{nav("leaderboards")}</Link></li>
          </ul>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">
            {t("resources")}
          </h3>
          <ul className="mt-3 space-y-2 text-[0.8125rem]">
            <li><Link className="text-muted hover:text-foreground" href="/blog">{nav("blog")}</Link></li>
            <li><Link className="text-muted hover:text-foreground" href="/changelog">{nav("changelog")}</Link></li>
            <li><Link className="text-muted hover:text-foreground" href="/stats">{nav("stats")}</Link></li>
            <li><Link className="text-muted hover:text-foreground" href="/compare">{nav("compare")}</Link></li>
            <li><Link className="text-muted hover:text-foreground" href="/inventory">{nav("inventory")}</Link></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-line">
        <div className="mx-auto max-w-7xl px-4 py-4">
          <p className="text-[0.6875rem] leading-relaxed text-muted">
            <span className="font-semibold">{t("sources")}: </span>
            {t("sourcesDesc")}
          </p>
        </div>
      </div>
    </footer>
  );
}
