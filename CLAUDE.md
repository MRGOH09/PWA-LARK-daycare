# CLAUDE.md

## Project Name

Weekly Manpower Gantt Dashboard

## Project Goal

Build a Vercel-hosted web dashboard that reads schedule/manpower data from Lark Base and displays a weekly Gantt chart for internal teachers.

The dashboard helps staff understand:

- How many students are in each time block
- Which teachers / assistants are assigned
- Teacher-to-student ratio
- Total manpower-to-student ratio
- Which time slots are normal, warning, overloaded, crisis, or no-student slots

This project is similar in deployment style to the existing Vercel + Python Serverless + Lark Base REST API project structure, where static frontend files are served by Vercel and Python API routes read data from Lark Base.

---

# 1. Technical Stack

Use a simple Vercel project structure.

Do not use React unless explicitly requested.

Use:

- HTML
- CSS
- Vanilla JavaScript
- Python Serverless Functions on Vercel
- Lark Base REST API
- `requests` Python library only

Expected structure:

```text
/
├── index.html
├── manifest.json
├── sw.js
├── requirements.txt
├── api/
│   └── schedule.py
└── js/
    └── gantt.js
```

Future editable version may add:

```text
api/update-schedule.py
api/create-schedule.py
api/delete-schedule.py
```

---

# 2. Deployment Platform

Deploy on Vercel.

Use Vercel Python Serverless Functions.

Each Python API file must expose a `handler` class that inherits from:

```python
from http.server import BaseHTTPRequestHandler
```

The project may not need `vercel.json` unless required.

---

# 3. Environment Variables

Use these Vercel environment variables:

```text
LARK_APP_ID
LARK_APP_SECRET
LARK_BASE_TOKEN
LARK_TABLE_ID
```

`LARK_BASE_TOKEN` is the Lark Base app token.

`LARK_TABLE_ID` is the target table ID.

Do not hardcode credentials in source files.

---

# 4. Lark API Flow

The backend API should:

1. Read environment variables
2. Request Lark tenant access token
3. Read records from Lark Base
4. Normalize Lark field values into clean JSON
5. Return JSON to frontend

Lark token endpoint:

```text
POST https://open.larksuite.com/open-apis/auth/v3/tenant_access_token/internal
```

Lark records endpoint:

```text
GET https://open.larksuite.com/open-apis/bitable/v1/apps/{base_token}/tables/{table_id}/records
```

Use:

```http
Authorization: Bearer <tenant_access_token>
```

The records API must support pagination.

Use `page_size=500` and loop with `page_token` until all records are retrieved.

---

# 5. Lark Base Fields

The current Lark Base table contains these fields:

```text
礼拜几
BLOCK
时段人数
时间段
DAYCARE老师
教书老师
助理
助教
```

Optional future fields:

```text
校区
备注
```

Every row represents one schedule time block.

Example:

```text
1.MON + HM BLOCK A + 7:30–9:30
1.MON + HM BLOCK B + 7:30–9:30
2.TUE + HM BLOCK A + 9:30–11:00
```

---

# 6. Weekly Template

The week is fixed.

The dashboard does not need real dates.

Valid weekday values:

```text
1.MON
2.TUE
3.WED
4.THU
5.FRI
6.SAT
7.SUN
```

Create a `dayOrder` value from these labels.

Example:

```js
"1.MON" -> 1
"2.TUE" -> 2
```

---

# 7. Time Axis

The Gantt chart time axis is fixed:

```text
7:00AM to 10:00PM
```

In 24-hour format:

```text
07:00–22:00
```

Convert times into minutes from midnight.

Examples:

```text
7:00AM = 420
7:30AM = 450
10:00PM = 1320
```

The time parser must handle these formats:

```text
7:30–9:30
3. 9:30AM–11:00AM
4. 11:00AM–12:30PM
5. 12:30PM–14:00PM
14:00–15:30
17:00–18:30
19:00–20:30
```

Important parsing rules:

* Remove leading numbering such as `3.`, `4.`, `5.`
* Support `–`, `—`, and `-` as separators
* Support AM / PM
* Support 24-hour format
* Treat invalid time ranges safely and do not break the page

---

# 8. API Output Format

`GET /api/schedule` should return:

```json
{
  "success": true,
  "updatedAt": "2026-05-03T22:00:00+08:00",
  "records": [
    {
      "recordId": "recxxxx",
      "day": "1.MON",
      "dayOrder": 1,
      "block": "HM BLOCK A",
      "studentCount": 33,
      "timeRange": "7:30–9:30",
      "startMinutes": 450,
      "endMinutes": 570,
      "daycareTeachers": ["Quinn"],
      "teachingTeachers": [],
      "assistants": ["助理玮瑄（Until 5月）"],
      "assistantTeachers": []
    }
  ]
}
```

The frontend should calculate ratios and status because the warning threshold is adjustable on the webpage.

Always include `recordId` for future editing.

---

# 9. Field Normalization Rules

Lark field values may come in different shapes.

Create helper functions to extract values safely.

Handle:

## Text / single select

```json
{"text": "Quinn"}
```

Return:

```text
Quinn
```

## Number

```json
33
```

Return number.

## Multi-select / people-like fields

```json
[
  {"text": "Quinn"},
  {"text": "Ling"}
]
```

Return:

```json
["Quinn", "Ling"]
```

## Empty fields

Return:

```json
[]
```

for teacher lists.

Return:

```text
""
```

for string fields.

Return:

```text
0
```

for student count.

Do not crash if a field is missing.

---

# 10. Gantt Chart Layout

The chart should show:

* Horizontal axis: time
* Vertical axis: week

Preferred default layout:

```text
MON
  HM BLOCK A
  HM BLOCK B
  PU

TUE
  HM BLOCK A
  HM BLOCK B
  PU
```

This is clearer than putting all blocks into one weekday row.

Each bar represents one Lark Base row.

Bar position:

```text
left = startMinutes - axisStartMinutes
width = endMinutes - startMinutes
```

Axis start:

```text
420
```

Axis end:

```text
1320
```

---

# 11. Bar Content

Inside each Gantt bar, show compact information:

```text
HM A
33人
T 33:1 / M 16.5:1
```

Where:

```text
T = Teacher Ratio
M = Manpower Ratio
```

On click, open detail panel or modal showing:

```text
礼拜：1.MON
Block：HM BLOCK A
时间：7:30–9:30
人数：33

DAYCARE老师：Quinn
教书老师：-
助理：助理玮瑄
助教：-

老师学生比：33:1
人手学生比：16.5:1

状态：超标
```

---

# 12. Ratio Calculation

There are two ratios.

## Teacher Ratio

Only count:

```text
DAYCARE老师 + 教书老师
```

Formula:

```text
studentCount / teacherCount
```

Where:

```text
teacherCount = daycareTeachers.length + teachingTeachers.length
```

## Manpower Ratio

Count all manpower:

```text
DAYCARE老师 + 教书老师 + 助理 + 助教
```

Formula:

```text
studentCount / manpowerCount
```

Where:

```text
manpowerCount =
  daycareTeachers.length
  + teachingTeachers.length
  + assistants.length
  + assistantTeachers.length
```

Every person counts as 1.

Do not use 0.5 weighting.

---

# 13. Warning Threshold

First version should have one adjustable threshold input on the webpage.

Example:

```text
警戒线：30
```

Use the same threshold for both:

```text
teacherRatio
manpowerRatio
```

Later, this can be moved to a Lark Base settings table.

Do not hardcode permanently.

Default threshold can be:

```text
30
```

---

# 14. Status Logic

Each record should be classified into one of these states:

```text
crisis
overloaded
warning
normal
no-student
```

Display Chinese labels:

```text
危机
超标
警戒
正常
无学生
```

## No Student

If:

```text
studentCount === 0
```

Status:

```text
无学生
```

Show grey.

Do not hide it.

## Crisis

Crisis has highest priority after no-student check.

If:

```text
studentCount > 0
and teacherCount === 0
```

Status:

```text
危机：没有正式老师
```

If:

```text
studentCount > 0
and manpowerCount === 0
```

Status:

```text
危机：没有任何人手
```

Use dark red.

## Overloaded

If:

```text
teacherRatio > threshold
or manpowerRatio > threshold
```

Status:

```text
超标
```

Use red.

## Warning

If:

```text
teacherRatio >= threshold * 0.8
or manpowerRatio >= threshold * 0.8
```

Status:

```text
警戒
```

Use yellow / orange.

## Normal

Otherwise:

```text
正常
```

Use green.

---

# 15. Filters

The dashboard must support multi-dimensional filters.

Required filters:

```text
星期
BLOCK
老师
角色
人数状态
校区
```

`校区` is optional for now and should be hidden or disabled if no campus data exists.

## Weekday Filter

```text
全部
1.MON
2.TUE
3.WED
4.THU
5.FRI
6.SAT
7.SUN
```

## Block Filter

Examples:

```text
全部
HM BLOCK A
HM BLOCK B
PU
```

Generate options dynamically from data.

## Role Filter

```text
全部
DAYCARE老师
教书老师
助理
助教
```

## Teacher Filter

Generate teacher names dynamically from:

```text
DAYCARE老师
教书老师
助理
助教
```

## Teacher Search Logic

If:

```text
角色 = 全部
老师 = Quinn
```

Show records where Quinn appears in any of:

```text
DAYCARE老师
教书老师
助理
助教
```

If:

```text
角色 = DAYCARE老师
老师 = Quinn
```

Only show records where Quinn appears in the DAYCARE老师 field.

## Status Filter

```text
全部
正常
警戒
超标
危机
无学生
```

---

# 16. Dashboard Summary Cards

At the top, show summary cards:

```text
总时段数
危机时段数
超标时段数
警戒时段数
无学生时段数
最高老师学生比
最高人手学生比
```

These should update when filters or threshold change.

---

# 17. Responsive Design

The dashboard must work on:

* Desktop
* Tablet
* Mobile phone

On mobile:

* Allow horizontal scrolling for the time axis
* Keep filters accessible
* Bar content can be more compact
* Detail modal should be readable

---

# 18. Auto Refresh

Implement auto refresh every 30 seconds.

Use cache-busting:

```js
fetch('/api/schedule?t=' + Date.now())
```

Avoid rerendering if data has not changed.

Pause auto refresh when:

* The browser tab is hidden
* A detail modal is open
* Later, when editing mode is open

---

# 19. Error Handling

Frontend must handle:

* Lark API error
* Missing environment variables
* Empty records
* Invalid time range
* Network error

Show clear user-facing messages in Chinese.

Example:

```text
无法读取 Lark Base 数据，请检查 App 权限、Base Token、Table ID 或字段名称。
```

Backend should return structured errors:

```json
{
  "success": false,
  "error": "Missing LARK_BASE_TOKEN"
}
```

---

# 20. Security

Do not expose:

```text
LARK_APP_ID
LARK_APP_SECRET
tenant_access_token
```

to frontend.

All Lark API calls must happen in Vercel serverless functions.

Escape all user-generated content before inserting into HTML.

Do not use `innerHTML` with raw Lark data unless escaped.

---

# 21. Future Editable Version

First version is read-only.

However, keep structure ready for editing.

Future requirements:

```text
A. Edit DAYCARE老师 / 教书老师 / 助理 / 助教
B. Edit student count
C. Edit time range
D. Add new time slot
E. Delete time slot
```

Use `recordId` for update and delete.

Future API files:

```text
api/update-schedule.py
api/create-schedule.py
api/delete-schedule.py
```

Future edit modal should support:

```text
studentCount
timeRange
daycareTeachers
teachingTeachers
assistants
assistantTeachers
```

---

# 22. Coding Style

Keep code simple and readable.

Use clear function names.

Suggested frontend functions:

```js
loadSchedule()
normalizeRecords()
parseTimeRange()
calculateRatios()
getRecordStatus()
renderFilters()
applyFilters()
renderSummary()
renderGantt()
renderDetailModal()
escapeHtml()
```

Suggested backend functions:

```python
get_env()
get_tenant_access_token()
fetch_all_records()
extract_text()
extract_list()
parse_student_count()
parse_day_order()
parse_time_range()
normalize_record()
send_json()
send_error()
```

---

# 23. Important Implementation Notes

## Do not assume Lark values are always strings.

Many Lark fields may return:

```json
{"text": "..."}
```

or:

```json
[{"text": "..."}]
```

or raw values.

Write robust extraction helpers.

## Do not skip records with studentCount = 0.

They must appear as grey "无学生" slots.

## Do not merge roles.

DAYCARE老师, 教书老师, 助理, 助教 must stay separate.

Only combine them for ratio calculation.

## Do not use AM / PM display only.

Internally use minutes.

Display original `timeRange` to users.

## Keep Chinese labels in UI.

The main users are internal teachers.

---

# 24. Deliverables for V1

Create:

```text
index.html
js/gantt.js
api/schedule.py
requirements.txt
manifest.json
sw.js
```

V1 must support:

```text
Read Lark Base
Render weekly Gantt
Filter by week/block/teacher/role/status
Adjust threshold on webpage
Calculate teacher ratio
Calculate manpower ratio
Show crisis/overloaded/warning/normal/no-student colors
Show summary cards
Open detail modal
Responsive layout
Auto refresh
```

Do not implement editing in V1 unless explicitly requested.

---

# 25. UI Language

Use mostly Chinese UI labels.

Recommended title:

```text
一周人力覆盖 Gantt Dashboard
```

Recommended subtitle:

```text
查看每个时段的学生人数、老师安排与人手比例
```

Use these labels:

```text
礼拜
Block
时段人数
时间段
DAYCARE老师
教书老师
助理
助教
老师学生比
人手学生比
状态
警戒线
危机
超标
警戒
正常
无学生
```

---

# 26. Teachers Workload View (V1.1)

A second top-level view for understanding per-teacher workload.

## Goal

Help internal staff answer:

* Who works the most / least this week
* What does a single teacher's week look like
* How is workload distributed across roles
* Which days are over- or under-staffed by a particular person

## Top Tabs

A tab bar sits between the page header and the filter bar.

```text
[ 周排班 Gantt ]   [ 老师工作量 ]
```

Switching tabs does not reload data — it only changes which view renders.

## Shared Filters

The same top filter row applies to both views.

When in the Teachers view:

* `星期` / `BLOCK` / `角色` / `老师` filters reduce the record set
  *before* aggregation. So choosing `星期 = 1.MON` shows everyone's
  Monday workload only.
* `状态` and `警戒线` are Gantt-only and may be hidden in the
  Teachers view (use `data-view-only="gantt"` markers).

## Role Assumption

A teacher belongs to **one** role across all their slots
(no overlap). When multiple roles are detected for the same person,
fall back to the first role encountered as the primary role.

## Per-Teacher Metrics

For each teacher, compute over the filtered record set:

```text
slots               每老师的时段数
hours               总工时（小时）= Σ (endMinutes - startMinutes) / 60
studentHours        生·时（总）   = Σ studentCount × hours
sharedStudentHours  生·时（分摊） = Σ (studentCount / manpowerInSlot) × hours
avgStudents         平均带生      = studentHours / hours
byDay               { dayOrder: hours } — 用于热力图
```

`manpowerInSlot` is the total of all four role lists in that slot.

## Components

### A. Summary Cards

```text
老师总数
DAYCARE 老师
教书老师
助理
助教
总工时
人均工时
总时段数
```

### B. Leaderboard Table

Columns:

```text
老师 | 角色 | 时段数 | 总工时(h) | 平均带生 | 生·时(分摊) | 生·时(总) | 工时占比
```

Behavior:

* Click any column header to sort. Default `hours` desc.
* Numeric columns default desc, name/role default asc.
* The 工时占比 column is a horizontal bar tinted by the
  teacher's role color (`var(--role-{role})`).
* Click any row to open the teacher detail modal.

### C. Heatmap

Grid of `老师 × 星期`, intensity = hours that day.

```text
        MON  TUE  WED  THU  FRI  SAT  SUN  总
Quinn   3h   .    2h   1h   3h   .    .    9h
Ling    .    4h   .    2h   .    3h   .    9h
```

Coloring:

* Empty cell uses `--panel-2`
* Filled cells use `rgba(56,189,248, intensity)` where
  `intensity = clamp(0.15 + 0.85 × hours/maxDayHours, 0, 0.95)`
* Click a teacher name in the first column to open detail.

### D. Teacher Detail Modal

Opened by clicking a teacher row or heatmap name.

Contents:

```text
姓名 + 角色 pill

时段数
总工时
平均带生
生·时 (分摊)
生·时 (总)

本周时间表 — mini Gantt: one short track per day,
            colored bars for each slot the teacher is in

所有时段（N） — list of all slots:
  礼拜 · BLOCK · 时间段 · 学生数
```

## Cross-Linking from Gantt

In the slot detail modal (Gantt view), every teacher name
becomes a clickable link.

Clicking it must:

1. Close the slot modal
2. Switch to the Teachers view (call `switchView('teachers')`)
3. Open that teacher's detail modal

## Role Colors

```text
DAYCARE         #38bdf8   --role-daycare
教书            #a78bfa   --role-teaching
助理            #fbbf24   --role-assistant
助教            #34d399   --role-assistantTeacher
```

## Suggested Frontend Functions

```js
computeTeacherStats(records)
sortTeacherStats(list)
renderTeachersSummary(stats, filtered)
renderTeachersTable(stats)
renderTeachersHeatmap(stats)
renderTeachersView(filtered)
openTeacherDetail(name, statsList)
switchView(view)
```

## Mobile

* Table allows horizontal scrolling
* Heatmap collapses label column to ~100px on narrow screens
* Detail modal max-width 560px, max-height 85vh, scrollable

---

# Current Progress — 2026-05-04

Latest shipped commits:

```text
758a1fa Replace teacher datalist with custom suggestions
d819659 Use selects for schedule block and day
d48920c Remove block datalist popup
85ed0a4 Stack overlapping schedule bars
f9173c4 Clarify Lark write permission errors
f94b649 Enforce teacher role bindings on schedule edits
feaab64 Add public schedule editing CRUD
29a636d Split 警戒线 into separate teacher and manpower thresholds
```

## V1.1 Editing Layer

Editing mode is public. Anyone with the URL can currently edit.

Implemented:

* Create schedule slot
* Update schedule slot
* Delete schedule slot
* Edit day, block, start/end time, student count, and four role fields
* Save to Lark through Python serverless API only
* Refresh schedule after successful create/update/delete

API files:

```text
api/_lark.py
api/create-schedule.py
api/update-schedule.py
api/delete-schedule.py
api/schedule.py
```

Frontend entry points:

```text
新增时段 button
Gantt bar detail -> 编辑
```

## Edit Form Rules

Day:

* Select only
* Saves back to Lark as `1.MON`, `2.TUE`, etc.

BLOCK:

* Select only
* Options are derived from existing Lark records
* Do not use free text or browser `datalist` for BLOCK

Time:

* Two selects: start and end
* 30-minute interval
* End time must be later than start time
* Saved as `HH:MM-HH:MM`

Teachers:

* Four role fields stay separate: DAYCARE老师, 教书老师, 助理, 助教
* Browser native `datalist` was removed because it produced ugly white popups
* Use custom dark suggestion menu instead
* Suggestions are filtered by role
* New teacher names can still be typed manually

## Teacher Role Binding

Important business rule:

```text
One teacher name must belong to one role only.
```

This is enforced in both frontend and backend.

Frontend:

* A teacher already bound to DAYCARE cannot be added as 助理/助教/教书
* Same teacher cannot be added to multiple roles in the same slot
* Custom suggestions show only teachers compatible with that role

Backend:

* `validate_teacher_role_bindings()` scans current Lark records before create/update
* If a teacher is already bound to another role, update/create is rejected
* If existing Lark data already has a teacher in multiple roles, the API rejects and asks to clean Lark data first

## Gantt Rendering Fix

Overlapping time slots inside the same day + BLOCK are now stacked into lanes.

Reason:

* HM BLOCK A can have newly added time ranges overlapping existing ranges
* Old rendering placed every bar in one row, so a new bar could be hidden behind another bar

Current behavior:

* `layoutRecordLanes()` assigns overlapping records to separate vertical lanes
* Row height expands automatically

## Lark Permission Notes

Read-only schedule loading works with read access.

Create/update/delete require Lark write permissions.

Observed failure:

```text
403 Client Error: Forbidden for Lark records/{record_id}
```

Meaning:

* App can read the Base but Lark refuses write/delete
* Need Lark Open Platform scope such as `bitable:app`
* After adding scope, app must be published/re-authorized
* Target Base/Table must also allow this app to edit, not only view

The API now converts 403 into a clearer Chinese error message.

## Remaining Risks / Next Steps

* Current editing mode is fully public; add PIN or Lark OAuth before wider sharing.
* Confirm Vercel deployment after every push. Local Vercel CLI can fail when project directory name contains Chinese characters.
* If users report stale UI, force refresh because service worker/static asset cache may keep old JS.
* Consider adding a small `/api/debug-permissions` endpoint only for admin debugging if Lark permission issues continue.
