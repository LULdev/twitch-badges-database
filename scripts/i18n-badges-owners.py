"""Adds the missing badges.owners key to all 11 locale files."""

# One-off migration: already applied. Its values are a snapshot of a past state
# of messages/*.json — they match live today, which is exactly the coincidence
# that must not be relied on. Set ALLOW_ONE_OFF_MIGRATION=1 to run deliberately.
import os as _guard_os

if _guard_os.environ.get("ALLOW_ONE_OFF_MIGRATION") != "1":
    raise SystemExit(
        "Refusing to re-run: this is a one-off migration. "
        "Set ALLOW_ONE_OFF_MIGRATION=1 to override."
    )
import json
import io
import os

LOCALES = ["en", "de", "es", "fr", "pt", "it", "ru", "zh", "ja", "ko", "ar"]

# BadgeCard renders: "{count} {owners}" → plural noun, lowercase.
OWNERS = {
    "en": "owners",
    "de": "Besitzer",
    "es": "propietarios",
    "fr": "propriétaires",
    "pt": "proprietários",
    "it": "proprietari",
    "ru": "владельцев",
    "zh": "人拥有",
    "ja": "人が所持",
    "ko": "명 보유",
    "ar": "مالكًا",
}

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for locale in LOCALES:
    path = os.path.join(root, "messages", f"{locale}.json")
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    badges = data.setdefault("badges", {})
    badges["owners"] = OWNERS[locale]
    data["badges"] = dict(sorted(badges.items()))
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"{locale}: badges.owners = {badges['owners']}")

print(f"OK — badges.owners added to {len(LOCALES)} locales")
