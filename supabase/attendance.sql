-- Daycare attendance tables for Supabase.
--
-- Run this in Supabase SQL Editor. The PWA should access these tables only
-- through Vercel API routes using SUPABASE_SERVICE_ROLE_KEY.

create extension if not exists pgcrypto;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  date date not null,
  weekday text check (
    weekday is null
    or weekday in ('MON', 'TUE', 'WED', 'THUR', 'FRI', 'SAT', 'SUN')
  ),
  period text,
  student_record_id text not null,
  student_no text,
  student_name text,
  year_form text,
  block text,
  campus text,
  teacher text,
  arrival text not null default '未点',
  tuition text not null default '未点',
  shower text not null default '未点',
  meal text not null default '未点',
  homework text not null default '未点',
  extra text not null default '未点',
  home text not null default '未回家',
  note text not null default '',
  lark_record_id text,
  lark_sync_status text not null default 'pending',
  lark_synced_at timestamptz,
  lark_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint attendance_records_student_day_unique unique (date, student_record_id)
);

create index if not exists attendance_records_date_idx
  on public.attendance_records (date);

create index if not exists attendance_records_scope_idx
  on public.attendance_records (date, campus, block, period);

create index if not exists attendance_records_student_idx
  on public.attendance_records (student_record_id, date desc);

drop trigger if exists set_attendance_records_updated_at on public.attendance_records;
create trigger set_attendance_records_updated_at
before update on public.attendance_records
for each row execute function public.set_updated_at();

create table if not exists public.attendance_events (
  id uuid primary key default gen_random_uuid(),
  attendance_record_id uuid references public.attendance_records(id) on delete cascade,
  date date not null,
  student_record_id text not null,
  step_key text not null,
  old_value text,
  new_value text,
  source text not null default 'pwa',
  created_at timestamptz not null default now()
);

create index if not exists attendance_events_record_idx
  on public.attendance_events (attendance_record_id, created_at desc);

create index if not exists attendance_events_student_idx
  on public.attendance_events (student_record_id, date desc, created_at desc);

alter table public.attendance_records enable row level security;
alter table public.attendance_events enable row level security;
