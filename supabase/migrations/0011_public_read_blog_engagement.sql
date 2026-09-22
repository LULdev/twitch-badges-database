-- pg-8: /[locale]/blog/[slug] read blog_views and blog_reactions with the
-- service-role client, i.e. RLS was bypassed on a public page — the one thing
-- AGENTS.md confines to scripts, cron routes and server push code.
--
-- The reason it had to: neither table had a SELECT policy at all, so anon reads
-- returned zero rows. Both tables also carry `ip_hash`, which must not become
-- public. So instead of a blanket SELECT, this grants column-level SELECT for
-- the columns the page actually aggregates over, mirroring the approach in
-- 0010 for `profiles`.
--
-- Effect: the blog page counts views and reactions through the normal anon
-- server client; `ip_hash` and `id` stay unreachable from the public API.
-- (The ledger row itself is written by scripts/db-apply.ts.)

-- `drop … if exists` first: a lost-ledger replay would otherwise abort with 42710.
drop policy if exists "blog_views_public_read" on public.blog_views;
create policy "blog_views_public_read" on public.blog_views
  for select using (true);

drop policy if exists "blog_reactions_public_read" on public.blog_reactions;
create policy "blog_reactions_public_read" on public.blog_reactions
  for select using (true);

-- Supabase grants table-level SELECT by default; replace it with a column-level
-- grant so `ip_hash` cannot be selected even though the row policy allows it.
revoke select on public.blog_views from anon, authenticated;
revoke select on public.blog_reactions from anon, authenticated;

grant select (post_id, created_at) on public.blog_views to anon, authenticated;
grant select (post_id, emoji, created_at) on public.blog_reactions to anon, authenticated;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Blog page stops bypassing RLS to count views and reactions',
  'The blog post page read blog_views and blog_reactions with the service-role client because neither table had a SELECT policy, so anon reads returned nothing. Both tables store ip_hash. Migration 0011 adds a public-read policy plus column-level SELECT grants covering only the columns the page aggregates over, so the page can use the normal anon server client while ip_hash and id stay unreachable from the public API.',
  '{"version": "blog-engagement-rls-1.0"}'::jsonb
);