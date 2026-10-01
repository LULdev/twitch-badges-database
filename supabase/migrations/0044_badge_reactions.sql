-- Badge detail pages get live GIF reactions (like / love / fire / poop / sad /
-- dislike), mirroring the blog's emoji reactions. Same shape, same guardrails:
-- one reaction per IP per badge per kind (unique constraint), writes only
-- through the service-role client in /api/badges/react, public reads limited to
-- the aggregate columns — `ip_hash` and `id` stay unreachable from the public
-- API (the approach migrations 0011/0024 established for blog_reactions).

create table if not exists public.badge_reactions (
  id bigint generated always as identity primary key,
  badge_id uuid not null references public.badges (id) on delete cascade,
  ip_hash text not null,
  reaction text not null check (reaction in ('like', 'love', 'fire', 'poop', 'sad', 'dislike')),
  created_at timestamptz not null default now(),
  unique (badge_id, ip_hash, reaction)
);

create index if not exists badge_reactions_badge_idx
  on public.badge_reactions (badge_id, created_at desc);

alter table public.badge_reactions enable row level security;

drop policy if exists "badge_reactions_public_read" on public.badge_reactions;
create policy "badge_reactions_public_read" on public.badge_reactions
  for select using (true);

revoke all on public.badge_reactions from anon, authenticated;
grant select (badge_id, reaction, created_at) on public.badge_reactions to anon, authenticated;

notify pgrst, 'reload schema';

insert into public.changelog (kind, title, body, payload) values (
  'feature',
  'Badge pages get live GIF reactions',
  'Every badge detail page now carries six animated GIF reactions — like, love, fire, poop, sad and dislike — in the hero placard, while the copy-link and X share buttons moved to the right side of the same row. The hero badge image sits inside the rotating rainbow emblem ring known from the home page collector orbit. Reactions toggle per visitor (one per kind), are stored in the new badge_reactions table with a unique (badge_id, ip_hash, reaction) constraint, and are written exclusively through the /api/badges/react service-role route; public reads see only badge_id, reaction and created_at.',
  '{"version": "badge-reactions-1.0", "reactions": ["like", "love", "fire", "poop", "sad", "dislike"]}'::jsonb
);
