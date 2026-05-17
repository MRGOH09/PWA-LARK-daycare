# Supabase Attendance Setup

This is the Supabase preparation for the daycare attendance feature.

## 1. Create Tables

Open Supabase SQL Editor and run:

```sql
supabase/attendance.sql
```

The important constraint is:

```sql
unique (date, student_record_id)
```

That guarantees one attendance record per student per day.

## 2. Vercel Environment Variables

Add these when you are ready to test Supabase:

```text
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Optional:

```text
SUPABASE_ATTENDANCE_TABLE=attendance_records
SUPABASE_ATTENDANCE_EVENTS_TABLE=attendance_events
```

When you are ready to make Supabase the main attendance database, add:

```text
ATTENDANCE_PRIMARY_STORE=supabase
```

Without `ATTENDANCE_PRIMARY_STORE=supabase`, the app keeps using Lark for
attendance, so adding Supabase credentials alone will not suddenly change
production behavior.

## 3. Transition Plan

Recommended flow:

1. Keep Lark as the student master list.
2. Use Supabase as the main attendance store.
3. Keep syncing attendance to Lark during the transition.
4. After the workflow is stable, decide whether Lark remains a backup/report table.

The browser must never receive `SUPABASE_SERVICE_ROLE_KEY`. It stays only in
Vercel serverless environment variables.
