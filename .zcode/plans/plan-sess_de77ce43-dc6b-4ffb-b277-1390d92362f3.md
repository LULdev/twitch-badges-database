# Admin Control Panel (ACP) + Rollen-Badges + Besucher-Tracking + öffentliche Statistiken

Größter Einzel-Feature-Bau der Sitzung, in 8 Phasen. Jede Phase endet mit laufenden Gates; ein Changelog-Eintrag pro Phase (ohne den Passcode — der erscheint NUR als Salted-SHA-256-Hash im Code, nie in Changelog, Blog, Messages oder Doku).

## Phase 1 — Fundament: DB, Admin-Auth, ACP-Gate (Migration 0025, `src/lib/admin.ts`, `/admin`)

**Migration 0025** (neue Tabellen, alle Service-Role-schreibbar):
- `site_settings(key text pk, value jsonb, updated_at)` — Admin-Identität (`admin`: `{twitchId?, username?}`), Wartungsmodus, Economy-Werte, Spiel-Schalter, Feature-Flags
- `profiles.role text not null default 'user' check in ('user','moderator','admin','owner')` — `is_admin` bleibt als abgeleitete Spalte synchron (owner/admin → true)
- `bans(profile_id pk references profiles, reason, banned_by, banned_until, created_at)`
- `newsletter_drafts(id, subject, body, status, recipient_count, sent_at, created_at)`
- `brainstorm_ideas(id, category, title, body, status, votes, created_by, created_at)` — Kategorien: profile/game/badge/design/content/stats/other
- `admin_audit(id, actor_id, action, target, payload jsonb, created_at)` — jede Admin-Mutation protokolliert
- `analytics_events(id bigint identity, ts, path, locale, referrer_host, visitor_hash, browser, os, device, screen_w, tz_offset_mins, duration_s)` — grob, DNT-respektierend (keine IP, nur Salt-Hash)
- Aggregat-Views `stats_analytics_*` (views/hits today/7d/30d, online = distinct visitor_hash letzte 5 min, Top-Pfade/Referrer/Browser/OS/Device)
- RLS: alle neuen Tabellen service-role-write; `analytics_events` insert für anon (Beacon), reads nur über Views; `brainstorm_ideas` öffentlich lesbar

**Admin-Auth (`src/lib/admin.ts`):**
- `ADMIN_BOOTSTRAP_HASH` = Salted-SHA-256 des Passcodes (Literal steht nirgends im Repo; Hash wird bei Implementierung berechnet und eingebettet), Vergleich zeitenkonstant wie `cron-auth.ts`
- `requireAdmin()`: `authUserId()` → Rolle via Admin-Client; zusätzlich `isBootstrapSession()` (HMAC-signiertes httpOnly-Cookie, 2 h TTL) — gilt NUR solange `site_settings.admin` leer ist
- `POST /api/admin/auth` — Passcode-Check, Brute-Force-Drossel (Zähler in site_settings, 5 Versuche / 15 Min), setzt Bootstrap-Cookie; antwortet 410 sobald ein Admin existiert
- `POST /api/admin/setup` — (nur Bootstrap-Sitzung) legt den Owner fest: Twitch-ID ODER Username → `profiles.role='owner'`, `is_admin=true`, schreibt `site_settings.admin`, loggt in admin_audit. Danach verschwindet die Passcode-Methode endgültig

**Seite `/[locale]/admin`**: `force-dynamic`, `robots noindex`; kein Admin + kein Bootstrap → Passcode-Formular (verschwindet nach Eintrag); Admin eingeloggt → Dashboard; Twitch-Login-Button führt Admin direkt durch (kein weiteres Passwort)

**Header**: `layout.tsx` liest `role` mit ins Header-Prop; „ACP"-Link nur für admin/owner (neuer Key `nav.acp` ×11)

## Phase 2 — Benutzerverwaltung (Tab „Users")

- `GET/PATCH/DELETE /api/admin/users`, `/api/admin/users/ban`, `/api/admin/users/role`, `/api/admin/users/progress`, `/api/admin/users/achievements` (vergeben/entziehen) — alle `requireAdmin()`, alle Writes in admin_audit
- UI: Suche (Username/Twitch-ID), Tabelle mit Rolle/XP/Coins/Level/Status; Detail-Drawer: ALLE Profilfelder editierbar (display_name, bio, banner, color, mood, showcase, steal-Einstellungen, inventory_public, customization als JSON), XP/Coins/Level direkt setzbar (via bestehende atomare RPCs bzw. service-role UPDATE), Rolle ändern, bannen (mit Grund/Dauer — Ban blockt Login + Spiele + API), löschen (mit Bestätigung), Errungenschaften vergeben
- Bans werden in `proxy.ts`/Session-Helper geprüft (gebannter User erhält Ausbildungsseite/Fehler)

## Phase 3 — Inhalte & Synchronisation (Tabs „Content", „Badges", „Sync")

- Blog: Liste/Erstellen/Bearbeiten/Löschen (alle `blog_posts`-Felder inkl. Status draft/published, Tags, Cover) über `/api/admin/blog`
- Changelog: Einträge anlegen/bearbeiten/löschen (`/api/admin/changelog` — nutzt bestehende Tabelle)
- Custom Badges: manuelle Katalog-Einträge (`/api/admin/badges` → `badges`-Tabelle, quelle='custom')
- Achievements: erstellen/bearbeiten (Titel, Beschreibung, Kategorie, Punkte) + vergeben (Phase-2-Route)
- Sync-Tab: Buttons triggern `runGlobalSync` / `runBadgebaseSync` / `runPotatSync` direkt (wie die Crons, aber Ad-hoc) mit Live-Ausgabe der Summaries

## Phase 4 — Einstellungen & Economy (Tab „Settings")

- `site_settings`-Editor; die Libs lesen mit Fallback auf die heutigen Konstanten:
  - `economy`: Daily-XP/Coins + Streak-Boni/Caps, Coin-Rain-Betrag, Badge-Claim-Belohnung, Spiel-XP, Steal-Defaults (Preis/Max/Chance), Flood-Fenster
  - `games`: an/aus + minBet/maxBet pro Spiel (Gefiltert in Hub, `playGame` lehnt ab)
  - `maintenance`: an/aus + Meldung — Layout rendert für Nicht-Admins eine Wartungsseite, `/api/*` (außer admin/cron) antworten 503
  - `features`: Feature-Flags (feed, wheel, steals, coin-rain …)
  - `admin`: weitere Admins/Moderatoren per Twitch-ID/Username verwalten (Rollen-UI)

## Phase 5 — Tracking, Statistiken, Status (Tabs „Stats", „Status"; öffentliche /stats-Erweiterung)

- `AnalyticsBeacon` (Client-Komponente im Root-Layout) → `POST /api/track`: Pfad, Referrer-Host, Locale, Browser/OS/Device (UA-Klasse, serverseitig), Screen, TZ-Offset, Verweildauer (visibilitychange); salteter Besucher-Hash; DNT → nur Pfad-Zähler
- Admin-Stats-Tab: nutzt die bestehenden animierten Komponenten (CountUp, Reveal, TrendChart, DonutChart, DistributionBars) + neue analytics Views — Heute/7d/30d, Online-Jetzt, Top-Seiten, Referrer, Browser/OS/Gerät, Verweildauer, Kombination mit stats_* Views
- Status-Tab: alle Services aus `system_heartbeats` (online/offline, letzter Zugriff, Ø-Dauer, 24h/7d-Verfügbarkeit via UptimeGauge/UptimeCalendar) + Live-Sonden (/api/health, DB-Ping)
- Öffentlich: `/stats` bekommt einen prominenten „Besucher"-Block (Online jetzt, Total Views, Hits heute/7d/30d, animiert) aus denselben Aggregaten

## Phase 6 — Newsletter, Brainstorming, Audit

- Newsletter: Empfänger sind die E-Mails aus `auth.users` (nur Service-Role lesbar); Composer mit Vorschau/Empfängerzahl; Versand über Resend wenn `RESEND_API_KEY` gesetzt ist, sonst wird der Entwurf gespeichert und als Broadcast über die bestehende Web-Push-Infrastruktur versendet (ehrlicher Fallback, da kein Mail-Anbieter existiert); jede Sendung in admin_audit
- Brainstorming-Tab: Ideensammlung nach Kategorien (Profil/Game/Badge/Design/Content/Stats/Sonstiges), erstellen/bearbeiten/löschen, Status (idea/planned/done), public read
- Audit-Log-Tab: filterbare Liste aller Admin-Aktionen

## Phase 7 — Rollen-Badges (Profil + Header) — Premium-CSS

- `RoleBadge`-Komponente (owner/admin/moderator), neben dem LevelBadge im Identitätsblock und als Mini-Chip im Header:
  - **Owner**: konischer Regenbogen-Ring (bestehende `rarity-mythic`-Technik) + rotierende Krone + Doppel-Sparkle + `rarity-glow`-Puls
  - **Admin**: goldener Schild mit `hero-shimmer`-Sweep + Sparkle
  - **Moderator**: smaragdner Ring mit `live-ping`-Radar
  - Alles `prefers-reduced-motion`-sicher, Light/Dark über Tokens
- Kleiner Rollen-Chip im Header-Account-Menü

## Phase 8 — i18n, Gates, Screenshots, Doku

- Neuer `admin`-Namespace (~130 Keys) + `nav.acp`, `stats`-Zuwachs — vollständig in **allen 11 Locale-Dateien** via Skript (Projektregel: jede UI-Zeichenkette durch Messages; key-identisch geprüft)
- Gates je Phase: `lint && typecheck && build` + Wirtschaftssimulationen; Live-Smoke inkl. Passcode-Fluss (falsch → Drossel; richtig → Setup; Admin gesetzt → Passcode verschwunden, Twitch-Login durch)
- **Screenshots**: headless-Browser-Schritt (Playwright als devDependency) rendert jede neue Seite (Admin-Login, Dashboard-Tabs, Status, Stats-Block, Rollen-Badges im Profil, öffentliche Besucher-Statistik) und speichert PNGs nach `docs/screenshots/`
- Abschlussdokument `docs/ACP.md` mit jedem Screenshot + Implementierungs-Erklärung; Changelog-Einträge (ohne Passcode); AGENT-AUDIT.md-Runde darüber

## Die 40 + 20 erforschten Features

Von den 60 recherierten Dashboard-Funktionen (40 Standard: Audit-Log, Bans, Rollen, Wartungsmodus, Feature-Flags, Newsletter, Content-CRUD, Nutzerrsuche, Impersonation-Basis, Export/Import, SEO-Einstellungen, Redirects, Moderations-Warteschlange, Melde-System, Benachrichtigungs-Broadcast, Cron-Trigger, DB-Browser (read-only), Umgebungs-Info, Cache-Reset, Login-Versuchs-Log … 20 unerwartete: Badge-Seltenheits-Rekalkulation, Errungenschaften-Re-Evaluierung aller Nutzer, „Zeitmaschine" (Economy-Simulation vor Veröffentlichung), Ideen-Voting im Brainstorm, Sync-Dry-Run, Besucher-Replay (anonymisierte Pfade), Session-Monitor …) implementiere ich die tragfähigen direkt in den Phasen 2–6; die vollständigen Listen landen kuratiert im Brainstorming-Board und in `docs/ACP.md`, jede mit Aufwand/Hinweis, was bereits umgesetzt ist.

## Bewusste Grenzen (ehrlich)

- **E-Mail-Versand** braucht einen Anbieter: ohne `RESEND_API_KEY` speichert und pusht das Newsletter-Feature, es verschickt keine Mails
- Passcode-Hash ersetzt Klartext im Code; ein Hash eines 5-stelligen Codes ist bei Kenntnis des Salzes brute-forcebar — daher Drossel + automatisches Verschwinden nach Admin-Eintrag + Empfehlung, den Owner zeitnah einzutragen
- Screenshots über Headless-Browser: Layout-genau, aber keine echten Interaktions-Spuren