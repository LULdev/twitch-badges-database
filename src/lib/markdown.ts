/** Minimal, dependency-free markdown → HTML for trusted editorial content. */
export function renderMarkdown(markdown: string): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  // A link is only emitted when its href is http(s), mailto, or clearly relative.
  // The HTML escape above already blocks attribute breakout, but it does not touch
  // the scheme — `[x](javascript:alert(1))` would otherwise survive as a live
  // javascript: href, and catalog text from external providers is interpolated
  // into this content (see createDropPost).
  const safeHref = (href: string): string | null => {
    // Every C0 control and space is removed before the scheme is read, not just
    // leading ones: the URL parser strips them anywhere it scans, so
    // `java\u0001script:…` (which `[^)\s]+` happily captures) would otherwise pass
    // this check and then be parsed as a javascript: URL by the browser.
    const normalised = href.replace(/[\u0000-\u0020]/g, "");
    const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(normalised);
    if (!scheme) return href; // no scheme → a relative path or an in-page anchor
    const name = scheme[1].toLowerCase();
    return name === "http" || name === "https" || name === "mailto" ? href : null;
  };
  const inline = (value: string) =>
    escape(value)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        (_match, text: string, href: string) => {
          const safe = safeHref(href);
          return safe === null
            ? text
            : `<a href="${safe}" rel="noopener noreferrer">${text}</a>`;
        },
      );

  const blocks: string[] = [];
  let listOpen = false;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const line = rawLine.trimEnd();
    const heading = /^(#{2,3})\s+(.*)$/.exec(line);
    const listItem = /^[-*]\s+(.*)$/.exec(line);

    if (listItem) {
      if (!listOpen) {
        blocks.push("<ul>");
        listOpen = true;
      }
      blocks.push(`<li>${inline(listItem[1])}</li>`);
      continue;
    }
    if (listOpen) {
      blocks.push("</ul>");
      listOpen = false;
    }
    if (heading) {
      const tag = heading[1].length === 2 ? "h2" : "h3";
      blocks.push(`<${tag}>${inline(heading[2])}</${tag}>`);
    } else if (line.trim() === "") {
      // paragraph separator
    } else {
      blocks.push(`<p>${inline(line)}</p>`);
    }
  }
  if (listOpen) blocks.push("</ul>");
  return blocks.join("\n");
}
