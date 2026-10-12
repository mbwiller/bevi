-- Categories and the Bev catalog are loaded by migrations
-- (20261012000300_catalog_seed.sql, generated from data/catalog), so local,
-- CI and hosted databases all get the same rows from `db push` / `db reset`.

-- Local/CI only (supabase/CLAUDE.md: "local and CI only", never for
-- hosted) -- lets packages/api's vitest suite and any local manual sign-up
-- actually pass handle_new_user's invite-code check.
insert into public.app_secrets (key, value) values ('invite_code', 'local-test-invite-code')
on conflict (key) do nothing;
