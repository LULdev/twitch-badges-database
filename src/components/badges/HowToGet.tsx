import type { ReactNode } from "react";
import { isTwitchUrl, type HowToGuide } from "@/lib/badges/how-to-get";

/**
 * The per-badge "how to get it" guide.
 *
 * Server component on purpose: it renders the most-crawled surface on the site
 * and has no interactivity, so shipping it to the browser would only inflate the
 * RSC payload. That is also why it takes FINISHED strings from `buildHowToGet`
 * rather than a translator — the same array feeds the schema.org HowTo, so the
 * visible steps and the structured data can never drift apart.
 *
 * Outbound links are plain <a> (not the i18n Link) because every destination is
 * an external Twitch URL; they carry rel="noopener noreferrer" so the opened tab
 * cannot reach back through window.opener.
 */

export interface HowToGetLabels {
  title: string;
  intro: string;
  methodLabel: string;
  stepsTitle: string;
  linksTitle: string;
  /** Rendered inside a dotted chip next to the section heading. */
  fromCurated: string;
}

export default function HowToGet({
  guide,
  labels,
}: {
  guide: HowToGuide;
  labels: HowToGetLabels;
}) {
  /**

  /**
   * Render a step's text, turning any URL Twitch itself wrote into a live link.
   *
   * The 51 curated `how_to_earn` rows are Twitch's own wording and frequently
   * carry the campaign URL inline ("Open the badge campaign:
   * https://www.twitch.tv/directory/category/…"), which rendered as dead text.
   * Only twitch.tv hosts are linkified — the sync pipeline supplies this text,
   * so an arbitrary host must never become an anchor we vouch for.
   */
  const renderStepText = (text: string) => {
    if (!text.includes("http")) return text;
    const parts: ReactNode[] = [];
    const pattern = /https?:\/\/[^\s,;)]+/g;
    let last = 0;
    let match: RegExpExecArray | null;
    let key = 0;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[0];
      if (match.index > last) parts.push(text.slice(last, match.index));
      if (isTwitchUrl(raw)) {
        parts.push(
          <a
            key={`u${key++}`}
            href={raw}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="break-all text-accent hover:underline"
          >
            {raw.replace(/^https?:\/\//, "")}
          </a>,
        );
      } else {
        parts.push(raw);
      }
      last = match.index + raw.length;
    }
    if (last < text.length) parts.push(text.slice(last));
    return parts;
  };

  return (
    <section className="card p-6" aria-labelledby="bd-howto">
      <div className="flex flex-wrap items-center gap-2">
        <h2
          id="bd-howto"
          className="text-sm font-bold uppercase tracking-[0.08em] text-muted"
        >
          {labels.title}
        </h2>
        <span className="chip" title={guide.evidence}>
          {guide.methodLabel}
        </span>
        {/* Marks the 10% of badges whose row carries Twitch's own requirement
            text, so a reader knows the first step is quoted, not paraphrased. */}
        {guide.fromCuratedField && (
          <span className="chip">{labels.fromCurated}</span>
        )}
      </div>

      <p className="mt-3 text-sm leading-relaxed text-muted">{guide.intro}</p>

      <h3 className="mt-5 text-xs font-bold uppercase tracking-[0.08em] text-muted">
        {labels.stepsTitle}
      </h3>
      <ol className="mt-3 space-y-3">
        {guide.steps.map((step, index) => (
          <li key={index} className="flex gap-3 text-sm leading-relaxed">
            <span
              aria-hidden
              className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-2 font-mono text-xs font-bold text-muted"
            >
              {index + 1}
            </span>
            <span className="min-w-0 text-foreground">
              {renderStepText(step.text)}
            </span>
          </li>
        ))}
      </ol>

      {guide.links.length > 0 && (
        <>
          <h3 className="mt-6 text-xs font-bold uppercase tracking-[0.08em] text-muted">
            {labels.linksTitle}
          </h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {guide.links.map((link) => (
              <li key={link.href}>
                <a
                  className="chip hover:text-accent"
                  href={link.href}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {link.label}
                  <span className="dir-arrow" aria-hidden="true">
                    ↗
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}