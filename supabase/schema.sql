-- Analytics schema. Run once in the Supabase SQL editor.
--
-- Committed for the same reason static/data is: the backend should be
-- reviewable and reproducible rather than something that only exists in a
-- dashboard someone clicked together.
--
-- The app is prerendered to static files and Vercel runs no functions, so the
-- browser posts here directly over PostgREST. That makes the endpoint public,
-- which is what most of the care below is about.

create table public.events (
	id bigint generated always as identity primary key,
	-- The server clock. A client timestamp would be wrong for anyone whose
	-- laptop clock is off, and trivially forgeable besides.
	created_at timestamptz not null default now(),
	-- Both random, both generated in the browser. visitor_id lives in
	-- localStorage and is what makes "returning" measurable; session_id lives in
	-- sessionStorage and dies with the tab. Neither is derived from anything
	-- about the person - no IP, no user agent, no fingerprint.
	visitor_id uuid not null,
	session_id uuid not null,
	-- The vocabulary is closed. Anyone can post here, so this is what stops the
	-- table filling with arbitrary junk; it cannot stop a flood of *valid*
	-- events, which is what the kill switch at the bottom is for.
	name text not null check (
		name in (
			'session_start',
			'session_end',
			'search_select',
			'course_added',
			'expand',
			'course_removed',
			'builder_cleared',
			'map_load_failed'
		)
	),
	props jsonb not null default '{}'
);

create index on public.events (created_at desc);
create index on public.events (session_id);

alter table public.events enable row level security;

-- Table privileges are a separate gate from RLS, and both have to be right:
-- RLS decides which *rows* a role may touch, grants decide whether it may reach
-- the table at all. Supabase's defaults for a new table in `public` are broader
-- than this needs, so start from nothing.
revoke all on public.events from anon, authenticated;

-- Reaching a table also needs usage on its schema. Normally already granted,
-- but stated here so this script stands on its own on a project configured with
-- "automatically expose new tables" off - which is the recommended setting, and
-- the one the grants below assume.
grant usage on schema public to anon;

-- Column-level, so the two columns the browser has no business setting are out
-- of reach: `created_at` keeps the server clock rather than a forgeable one,
-- and `id` stays with the sequence.
grant insert (visitor_id, session_id, name, props) on public.events to anon;

-- No select/update/delete policy for anon at all, so the table is write-only
-- from the browser even once the grant above lets it in. The size check is a
-- cheap ceiling on what one request can cost; RLS cannot express a rate limit.
create policy "anon inserts events" on public.events
	for insert to anon
	with check (pg_column_size(props) < 2048);

-- Sessionisation. Every report builds on this, and duration is the only part
-- that is not a one-line aggregate over the raw table.
--
-- reported_seconds comes from the session_end event, which the browser sends on
-- pagehide. When that is lost - it happens, mostly on mobile - fall back to
-- last_at - started_at, which undercounts anyone who stopped interacting and
-- kept the tab open.
--
-- `security_invoker = true` matters: a view otherwise runs with its owner's
-- privileges and quietly bypasses the row-level security above, which in an
-- exposed schema like `public` would hand anon exactly the session data the
-- table was locked down to protect. With it, reading the view is subject to the
-- reader's own policies, so anon gets nothing. The revoke below says the same
-- thing again at the privilege level.
create view public.sessions with (security_invoker = true) as
select
	session_id,
	min(visitor_id::text)::uuid as visitor_id,
	min(created_at) as started_at,
	max(created_at) as last_at,
	max((props ->> 'seconds')::int) as reported_seconds,
	coalesce(
		max((props ->> 'seconds')::int),
		extract(epoch from max(created_at) - min(created_at))::int
	) as seconds,
	count(*) filter (where name = 'course_added') as courses_added,
	count(*) filter (where name = 'expand') as expands,
	-- Adding a course opens its requirement list for you. Counting that as an
	-- expand would make "expanded something" and "added something" the same
	-- column, so the deliberate ones are separated out for the funnel.
	count(*) filter (
		where name = 'expand' and props ->> 'trigger' = 'user'
	) as user_expands,
	max((props ->> 'path_size')::int) as max_path_size
from public.events
group by session_id;

revoke all on public.sessions from anon, authenticated;

-- The reports in reports.sql group by `props ->> 'code'`. At this size that is
-- a sequential scan over a table measured in the tens of thousands of rows,
-- which is milliseconds, and an index would be paid for on every insert - the
-- side this table is actually hot on. If the dashboard ever gets slow:
--
--   create index on public.events ((props ->> 'code'));
--
-- Kill switch, if the open endpoint is ever abused:
--
--   drop policy "anon inserts events" on public.events;
--
-- Ingest stops globally and immediately; the app keeps working, because every
-- send is fire-and-forget. Only reach for an Edge Function with per-IP limits if
-- that day actually comes.
