"""Rename the three message keys whose *identifiers* still carried a vendor name.

Only the i18n keys change — the database columns (`potat_level`, `potatoes`,
`potat_first_seen`) and the sync that fills them are data plumbing and stay as
they are. The point is that the rendered page payload no longer contains the
vendor string anywhere, not even as a key.
"""

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

RENAME = {
    "potatLevel": "communityLevel",
    "potatoes": "communityPoints",
    "potatSince": "communitySince",
}

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

for locale in LOCALES:
    path = os.path.join(root, "messages", f"{locale}.json")
    with io.open(path, encoding="utf-8") as handle:
        data = json.load(handle)

    profile = data["profile"]
    for old, new in RENAME.items():
        if old not in profile:
            raise SystemExit(f"{locale}: key {old} missing")
        profile[new] = profile.pop(old)

    data["profile"] = dict(sorted(profile.items()))
    with io.open(path, "w", encoding="utf-8", newline="\n") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    leftover = [k for k in data["profile"] if "potat" in k.lower()]
    print(f"{locale}: renamed, vendor-named keys left in profile namespace: {leftover or 'none'}")

print("OK — keys renamed in all locales")