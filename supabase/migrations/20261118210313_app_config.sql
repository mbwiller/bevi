-- =====================================================================
-- 20261118210313 · app_config (IA-2, half 1: the database)
-- =====================================================================
-- The version gate and the maintenance flag, for real.
--
-- WHY THIS EXISTS. Today the app and the backend ship together, so there is
-- only ever one client: a deploy replaces every copy of the app at once, and
-- "old client" is not a state the system can be in. An App Store binary ends
-- that. A build approved in January is still on someone's phone in June,
-- still calling these RPCs, and we cannot take it back. The backend therefore
-- needs a row it can point at to say two things an old binary has no other
-- way to learn:
--   * "stop, update" -- `min_app_version` / `min_contract_version` /
--     `ios_min_build`, which the client compares against itself;
--   * "we are down on purpose" -- `maintenance` and `maintenance_message`,
--     so a migration window reads as a maintenance screen rather than as a
--     wall of failed requests.
--
-- SCOPE. This migration is the database half only. `shared/`'s `AppConfig`
-- still carries just `minAppVersion` and `maintenance`, and
-- `packages/api/src/meta.ts` still returns `placeholderAppConfig()`. The
-- contract fields (`minContractVersion`, `maintenanceMessage`), the
-- CONTRACT_VERSION bump and the rewiring of `meta.ts` land in the follow-up
-- PR -- one contract bump is in flight at a time (DEVELOPMENT-ARJUN-IOS.md
-- §5), and IA-4 owns the current one. The columns are all here now so that
-- half is a read, not another migration.
--
-- CALLABLE SIGNED OUT, DELIBERATELY. `get_app_config()` is granted to `anon`
-- as well as `authenticated`, and the select policy covers both roles. This
-- is not an oversight: a gated client has to be able to read the gate
-- BEFORE it signs in. If the only way to learn "this build is too old" were
-- an authenticated read, a binary broken badly enough to fail sign-in could
-- never be told to update, and the maintenance screen could not be shown to
-- the person staring at a sign-in form that will not work. The contract
-- already promises this in both places it can: `shared/src/api.ts:7` lists
-- `meta.getAppConfig` among the methods that do NOT throw 'unauthorized'
-- when signed out, and `MetaApi.getAppConfig` is commented "Callable signed
-- out." Nothing in this row is a secret -- it is a public service notice.
--
-- NO WRITE PATH FOR THE APP. There is no insert/update/delete policy and no
-- write grant for `anon` or `authenticated`, and no write RPC. The row is
-- edited by hand from Studio or by the service role, which is the whole
-- point: a client must not be able to lift its own gate.
-- =====================================================================

set search_path = public, extensions;

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
-- SINGLETON. `id boolean primary key check (id = true)` is the standard
-- one-row pattern: the CHECK admits only `true` and the primary key admits
-- it only once, so the table can hold exactly zero or one row, enforced by
-- the database rather than by everyone remembering. Readers can therefore
-- say `select ... from app_config` with no `order by`/`limit` and no
-- ambiguity about which row won.
create table public.app_config (
  id boolean primary key default true check (id = true),

  -- The lowest app version still allowed to talk to this backend, as
  -- `major.minor.patch`. The client compares its own version against it and
  -- shows the "Update required" screen (IM-9) when it is behind.
  min_app_version text not null
    check (min_app_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),

  -- The lowest `CONTRACT_VERSION` (shared/src/index.ts) still served. This is
  -- the one that actually protects the backend: app versions are a marketing
  -- number, the contract version is what says which shapes the client expects
  -- back. IA-3 turns "the current major and the two previous minors" into a
  -- written policy; this column is where that policy becomes a value.
  min_contract_version text not null
    check (min_contract_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),

  -- Planned downtime. True means every client shows the maintenance screen
  -- instead of its normal UI. It is advisory -- it does not close the
  -- database -- so a migration window still wants its own care; what this
  -- buys is that the person sees an explanation rather than errors.
  maintenance boolean not null default false,

  -- Shown on that screen when set. Null means the client uses its own
  -- wording. Bounded because it is rendered on a phone, and a sentence is
  -- the entire use: "Back by 9pm ET."
  maintenance_message text
    check (maintenance_message is null
           or char_length(maintenance_message) between 1 and 280),

  -- iOS `CFBundleVersion`, the integer build number, which is the only
  -- identifier that is monotonic across TestFlight builds that share a
  -- marketing version. Null until the first TestFlight build exists, which
  -- is why it is nullable rather than defaulted to 0.
  ios_min_build integer check (ios_min_build is null or ios_min_build > 0),

  updated_at timestamptz not null default now()
);

comment on table public.app_config is
  'IA-2: the single-row version gate and maintenance flag. Read by every '
  'client through get_app_config(), including signed-out ones. Written only '
  'by the service role / by hand in Studio -- a client must not be able to '
  'lift its own gate.';

-- `updated_at` is maintained by a trigger rather than by the caller, because
-- unlike every other table here this one has no write RPC to set it: it is
-- edited by hand. A hand edit that forgets the column would otherwise leave
-- `updated_at` lying about when the gate last moved, which is exactly the
-- figure anyone debugging "why is everyone being told to update" reaches for.
create function public.app_config_touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger app_config_touch_updated_at
  before update on public.app_config
  for each row execute function public.app_config_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. The row
-- ---------------------------------------------------------------------------
-- Seeded permissive on purpose: nothing is gated on day one. `0.0.0` is below
-- any version either side can ship, `maintenance` is false and `ios_min_build`
-- is null, so the gate exists and is open. Raising these is a deliberate,
-- separate act -- and it had better be, because raising `min_app_version`
-- past a shipped build locks those users out until they update.
insert into public.app_config (id, min_app_version, min_contract_version, maintenance)
values (true, '0.0.0', '0.0.0', false);

-- ---------------------------------------------------------------------------
-- 3. RLS
-- ---------------------------------------------------------------------------
alter table public.app_config enable row level security;

-- One row, no secrets, every client needs it -- including before sign-in.
-- `using (true)` is the whole table, which is the whole intent.
create policy app_config_select on public.app_config
  for select to anon, authenticated
  using (true);

-- No insert/update/delete policy, and no write grant. `service_role` bypasses
-- RLS, so the operator path keeps working without a policy of its own.
revoke all on public.app_config from anon, authenticated;
grant select on public.app_config to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. get_app_config()
-- ---------------------------------------------------------------------------
-- Security definer so the read does not depend on the policy above staying
-- exactly as it is: this is the one call a client makes when it may be about
-- to be told it cannot make any others, and it should not be the call that
-- breaks. `stable`, so a single statement reads it once.
create function public.get_app_config()
returns public.app_config
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.app_config;
$$;

comment on function public.get_app_config() is
  'IA-2: the version gate and maintenance flag. Callable signed out -- a '
  'client has to be able to read the gate before it can sign in, which is '
  'what shared/src/api.ts promises (meta.getAppConfig does not throw '
  'unauthorized when signed out).';

-- `anon` and `authenticated` are named as well as PUBLIC because Supabase's
-- default privileges grant EXECUTE on every new function in `public` directly
-- to anon, authenticated and service_role, which a revoke from PUBLIC does
-- not touch (20261019000500, 20261023000100 and 20261115214237 all learned
-- this). Here both roles get the grant straight back -- the revoke is so the
-- file states the grant rather than inheriting it -- while the trigger
-- function, which no client calls, keeps none.
alter function public.get_app_config() owner to postgres;
revoke execute on function public.get_app_config() from public, anon, authenticated;
grant execute on function public.get_app_config() to anon, authenticated, service_role;

revoke execute on function public.app_config_touch_updated_at()
  from public, anon, authenticated;
