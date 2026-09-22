"""Fix the broken ICU placeholder introduced by the BadgesCoins rename.

StealPanel calls t("success", { coins }) / t("failed", { coins }), but the
rename rewrote the ICU variable `{coins}` into `{BadgesCoins}` in all 11
locales — so the steal result message could not be formatted.
"""
import json
import io
import os

LOCALES = ["en", "de", "es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"]

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
changed = 0

for locale in LOCALES:
    path = os.path.join(root, "messages", f"{locale}.json")
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle)

    steal = data.get("steal", {})
    for key in ("success", "failed"):
        value = steal.get(key)
        if isinstance(value, str) and "{BadgesCoins}" in value:
            steal[key] = value.replace("{BadgesCoins}", "{coins}")
            changed += 1
    data["steal"] = dict(sorted(steal.items()))

    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

print(f"repaired {changed} placeholder(s) across {len(LOCALES)} locales")
print("en.steal.success =", json.load(io.open(os.path.join(root, "messages", "en.json"), encoding="utf-8"))["steal"]["success"])
print("de.steal.failed  =", json.load(io.open(os.path.join(root, "messages", "de.json"), encoding="utf-8"))["steal"]["failed"])