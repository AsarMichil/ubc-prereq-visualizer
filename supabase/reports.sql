-- Queries for the Supabase Studio dashboard. Nothing here runs in the app.
--
-- Paste one into a SQL snippet, then add the snippet as a block on a custom
-- report to get it as a chart. Kept in the repo so the definition of a metric
-- is reviewable, and so a dropped report can be rebuilt.


-- 1. Sessions and visitors per day.
select
	date_trunc('day', started_at) as day,
	count(*) as sessions,
	count(distinct visitor_id) as visitors
from public.sessions
group by 1
order by 1;


-- 2. How long a session lasts, per day.
--
-- Median rather than mean: a handful of tabs left open all afternoon would drag
-- an average somewhere meaningless.
select
	date_trunc('day', started_at) as day,
	percentile_cont(0.5) within group (order by seconds)::int as median_seconds,
	percentile_cont(0.9) within group (order by seconds)::int as p90_seconds
from public.sessions
group by 1
order by 1;


-- 3. The funnel.
--
-- Each step counts sessions that got at least that far, so the drop between two
-- rows is the drop-off. "Opened" includes people who bounced before the 7MB of
-- course data finished downloading.
select
	'1. opened' as step, count(*) as sessions from public.sessions
union all
select '2. picked a course', count(*) from public.sessions where courses_added > 0
union all
select '3. expanded deliberately', count(*) from public.sessions where user_expands > 0
union all
select '4. path of 5+', count(*) from public.sessions where max_path_size >= 5
union all
select '5. path of 10+', count(*) from public.sessions where max_path_size >= 10
order by 1;


-- 4. How big the paths people build actually get.
select
	max_path_size as courses,
	count(*) as sessions
from public.sessions
where max_path_size is not null
group by 1
order by 1;


-- 5. Expanding without adding - the suspected drop-off.
--
-- A student opens the requirement list for a course and takes nothing from it.
-- Once or twice is browsing; a high rate means the list is not answering the
-- question it was opened to answer.
-- Counted per (session, course) rather than by subtracting totals. Adding a
-- course emits a `course_added` for that same code with direction `root`, and
-- opens its list - so a plain subtraction lets every root cancel its own
-- auto-expand, and a student who opened a list and took nothing from it scores
-- as healthy. That is the exact case this is here to find, hence the
-- `direction <> 'root'`: a root add is not something taken *from* a list.
with opened as (
	select distinct session_id, props ->> 'code' as code
	from public.events
	where name = 'expand'
),
took as (
	select distinct session_id, props ->> 'code' as code
	from public.events
	where name = 'course_added' and props ->> 'direction' <> 'root'
)
select
	count(*) as lists_opened,
	count(*) filter (where took.code is null) as opened_and_abandoned,
	round(100.0 * count(*) filter (where took.code is null) / nullif(count(*), 0), 1)
		as pct_abandoned
from opened
left join took using (session_id, code);


-- 5b. The same, per course: whose lists get opened and walked away from.
with opened as (
	select distinct session_id, props ->> 'code' as code
	from public.events
	where name = 'expand'
),
took as (
	select distinct session_id, props ->> 'code' as code
	from public.events
	where name = 'course_added' and props ->> 'direction' <> 'root'
)
select
	code,
	count(*) as times_opened,
	count(*) filter (where took.code is null) as abandoned
from opened
left join took using (session_id, code)
group by code
having count(*) >= 5
order by abandoned desc, times_opened desc
limit 30;


-- 6. Most-added courses. The closest thing to "what are students planning".
select
	props ->> 'code' as code,
	count(*) as adds,
	count(distinct session_id) as sessions
from public.events
where name = 'course_added'
group by 1
order by adds desc
limit 30;


-- 7. Where people arrive from.
select
	coalesce(nullif(props ->> 'referrer_host', ''), '(direct)') as source,
	count(*) as sessions
from public.events
where name = 'session_start'
group by 1
order by sessions desc;


-- 8. Failed map loads. Worth watching in the first week: it is 7MB over
-- whatever connection a student happens to be on.
select
	date_trunc('day', created_at) as day,
	props ->> 'message' as message,
	count(*) as failures
from public.events
where name = 'map_load_failed'
group by 1, 2
order by 1 desc;
