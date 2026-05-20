-- Add actor tracking for daycare attendance.
-- Run this once in Supabase SQL Editor before relying on per-teacher stats.

alter table public.attendance_records
  add column if not exists updated_by_email text,
  add column if not exists updated_by_name text;

alter table public.attendance_events
  add column if not exists actor_email text,
  add column if not exists actor_name text;

create index if not exists attendance_events_actor_month_idx
  on public.attendance_events (actor_email, date desc, created_at desc);
