-- Migration 056: more places, so searches in the rest of BC and in Washington / Oregon are accepted.
-- Run once in the Supabase SQL editor (safe to run again).
--
-- The app turns every address into the nearest "area" and refuses a place that is more than 40 km from every area
-- ("outside the area we cover"). Before this, the areas only covered Metro Vancouver, so Bellevue Square was refused.
-- This adds towns and cities along the I-5 / Highway 1 corridor and beyond. The exact address is still kept for the route.

insert into public.areas (name, lat, lng)
select v.name, v.lat, v.lng
from (values
  ('Downtown Vancouver', 49.2827, -123.1207),
  ('Langley', 49.1044, -122.6604),
  ('Maple Ridge', 49.2194, -122.5984),
  ('Abbotsford', 49.0504, -122.3045),
  ('Chilliwack', 49.1579, -121.9515),
  ('Hope', 49.3858, -121.4419),
  ('Squamish', 49.7016, -123.1558),
  ('Whistler', 50.1163, -122.9574),
  ('Victoria', 48.4284, -123.3656),
  ('Nanaimo', 49.1659, -123.9401),
  ('Kelowna', 49.8880, -119.4960),
  ('Blaine (WA)', 48.9937, -122.7471),
  ('Bellingham (WA)', 48.7519, -122.4787),
  ('Mount Vernon (WA)', 48.4201, -122.3341),
  ('Everett (WA)', 47.9790, -122.2021),
  ('Lynnwood (WA)', 47.8209, -122.3151),
  ('Seattle Downtown (WA)', 47.6062, -122.3321),
  ('SeaTac Airport (WA)', 47.4502, -122.3088),
  ('Bellevue (WA)', 47.6101, -122.2015),
  ('Redmond (WA)', 47.6740, -122.1215),
  ('Tacoma (WA)', 47.2529, -122.4443),
  ('Olympia (WA)', 47.0379, -122.9007),
  ('Portland (OR)', 45.5152, -122.6784)
) as v(name, lat, lng)
where not exists (select 1 from public.areas a where a.name = v.name);
