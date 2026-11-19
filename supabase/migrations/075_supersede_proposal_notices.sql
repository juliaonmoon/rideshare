-- 075: no pile of old "New pickup time proposed" notices. A new proposal replaces the older unread ones for the same ride,
-- and once the rider answers (or the proposal ends) the unread proposal notice is marked read.
-- Run once in the Supabase SQL editor (safe to run again). Needs 053 and 063.
create or replace function public._supersede_proposal_notices() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.notices set read_at = now() where match_id = new.match_id and kind = 'pickup_time_proposed' and read_at is null and id <> new.id;
  return new;
end $$;
revoke all on function public._supersede_proposal_notices() from public, anon, authenticated;
drop trigger if exists notices_supersede_proposals on public.notices;
create trigger notices_supersede_proposals after insert on public.notices for each row
  when (new.kind = 'pickup_time_proposed' and new.match_id is not null) execute function public._supersede_proposal_notices();

create or replace function public._clear_proposal_notice() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.notices set read_at = now() where match_id = new.id and kind = 'pickup_time_proposed' and read_at is null;
  return new;
end $$;
revoke all on function public._clear_proposal_notice() from public, anon, authenticated;
drop trigger if exists matches_clear_proposal_notice on public.matches;
create trigger matches_clear_proposal_notice after update of prop_time on public.matches for each row
  when (old.prop_time is not null and new.prop_time is null) execute function public._clear_proposal_notice();