-- Migration 051: a repeating trip or request only runs on the days it repeats on. Its start date no longer counts as a day
-- when it is not one of them (for example "every Sunday" starting on a Saturday did also run on that Saturday).
-- Run once in the Supabase SQL editor (safe to run again). Needs migration 048.
--
-- One-time trips are unchanged: their date always counts.

create or replace function public._on_day(p_date date, p_base date, p_days smallint[], p_until date, p_every integer default 1, p_nth integer default null)
returns boolean language sql stable set search_path = public as $$
  select case
    when p_date is null or p_base is null then false
    when coalesce(array_length(p_days, 1), 0) = 0 then p_date = p_base                      -- a one-time item: its date
    when p_date < p_base then false
    when p_until is not null and p_date > p_until then false
    when p_nth is not null then
      extract(isodow from p_date)::int = p_days[1]
      and case when p_nth = 5 then extract(day from p_date)::int + 7 > extract(day from (date_trunc('month', p_date) + interval '1 month - 1 day'))::int
               else ((extract(day from p_date)::int - 1) / 7) + 1 = p_nth end
    else extract(isodow from p_date)::int = any (p_days)
      and (coalesce(p_every, 1) <= 1 or (((p_date - (p_base - (extract(isodow from p_base)::int - 1))) / 7) % p_every) = 0)
  end;
$$;
