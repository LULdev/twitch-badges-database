/**
 * Serialise structured data for a <script type="application/ld+json"> block.
 *
 * `JSON.stringify` alone is not safe there: any string in the payload that
 * contains `</script>` (badge titles come from external sources) terminates
 * the block early and lets the rest be parsed as markup. Escaping the HTML
 * significant characters — plus the JS line separators — keeps the payload
 * inert while remaining valid JSON-LD for crawlers.
 */
export function jsonLdScript(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}