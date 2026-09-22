-- v28-01: `blog_reactions` kept a table-level INSERT grant for anon and
-- authenticated, and an `insert with check (true)` policy to match. The reaction
-- route writes through the service-role client, so no anon insert is needed —
-- and the verification round proved one actually succeeds today. The grant, the
-- policy and the column grants that 0023 left in place are removed here; the
-- route keeps working because it never used them.

revoke all on public.blog_reactions from anon, authenticated;
grant select (post_id, emoji, created_at) on public.blog_reactions to anon, authenticated;

drop policy if exists "blog_reactions_insert" on public.blog_reactions;

insert into public.changelog (kind, title, body, payload) values (
  'bugfix',
  'Anonymous visitors can no longer insert blog reactions directly',
  'blog_reactions kept a table-level INSERT grant for anon and authenticated plus an allow-all insert policy. The reaction route has always written through the service-role client, so the anonymous path was pure surface — a probe insert succeeded against it. The grant and the policy are removed; the column-level SELECT the blog page uses stays.',
  '{"version": "blog-reactions-insert-1.0"}'::jsonb
);

notify pgrst, 'reload schema';