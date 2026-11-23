-- 080: the phone helper asks for "a rider cancelled" notices it has not shown yet, so a cancel is not missed while the driver
-- is in Google Maps. Same notices as the app's Update card; they stay until the driver taps OK in the app.
-- Run once in Supabase > SQL Editor (after 079). Safe to run twice.
create or replace function public.driver_cancel_alerts_token(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare u uuid; j jsonb;
begin
  select driver_id into u from public.tracking_tokens
    where token_hash = encode(sha256(convert_to(coalesce(p_token, ''), 'UTF8')), 'hex') and expires_at > now();
  if u is null then raise exception 'Invalid or expired token'; end if;
  select coalesce(jsonb_agg(jsonb_build_object('id', n.id, 'title', n.title, 'body', n.body) order by n.created_at), '[]'::jsonb) into j
    from public.notices n
    where n.user_id = u and n.kind = 'ride_cancelled_by_rider' and n.read_at is null and n.created_at > now() - interval '3 hours';
  return j;
end $$;
revoke all on function public.driver_cancel_alerts_token(text) from public;
grant execute on function public.driver_cancel_alerts_token(text) to anon, authenticated;
