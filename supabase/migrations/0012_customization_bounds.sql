-- ============================================================
-- 0012 — bound the profile `customization` document
-- ============================================================
-- WHY THIS EXISTS (sec-4 / fp-11): `profiles.customization` is a public-read
-- jsonb document that /api/account stored verbatim. Nothing at the application
-- layer or the database layer constrained its size or shape, so an authenticated
-- user could persist an arbitrarily large or malformed blob that every profile
-- read then re-parsed (storage / DoS amplification). The write path in
-- `src/app/api/account/route.ts` now rejects a non-object, more than 64 keys, or
-- a serialization longer than 4096 characters. This migration adds the matching
-- database-level backstop so a script, a migration or any non-app writer cannot
-- bypass it either.

alter table public.profiles
  drop constraint if exists profiles_customization_object;
alter table public.profiles
  add constraint profiles_customization_object
  check (jsonb_typeof(customization) = 'object');

-- 16384 bytes is deliberately looser than the 4096-character write-path cap:
-- JSON.stringify length counts UTF-16 code units, so a legitimate multi-byte
-- (CJK/emoji) document can occupy up to ~4x that in UTF-8. This check exists to
-- stop an unbounded blob, not to re-implement the application's exact budget.
alter table public.profiles
  drop constraint if exists profiles_customization_size;
alter table public.profiles
  add constraint profiles_customization_size
  check (octet_length(customization::text) <= 16384);

-- R8-4: PostgREST serves the schema from a cache; every migration from 0008 to
-- 0010 ends with this notification so a grant/constraint change is visible
-- immediately. 0011 omitted it; this single reload also refreshes the cache for
-- 0011's blog_views/blog_reactions policies, so no separate follow-up is needed.
notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Profile customization document is now bounded in size and shape',
  'profiles.customization was stored verbatim: any authenticated user could save an arbitrarily large or malformed JSON blob that every profile read re-parsed. The write path (/api/account) now requires a plain object with at most 64 keys and at most 4096 serialized characters, and migration 0012 adds the matching CHECK constraints (jsonb_typeof = object, octet_length <= 16384) so a non-app writer cannot bypass the cap. Every field the ProfileCustomizer reads is preserved.',
  '{"version": "customization-bounds-1.0"}'::jsonb
);