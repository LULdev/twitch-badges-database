/** Minimal, dependency-free markdown → HTML for trusted editorial content. */
export function renderMarkdown(markdown: string): string {
  const escape = (value: string) =>
    value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  const inline = (value: string) =>
    escape(value)
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(
        /\[([^\]]+)\]\(([^)\s]+)\)/g,
        '<a href="$2" rel="noopener noreferrer">$1</a>',
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
