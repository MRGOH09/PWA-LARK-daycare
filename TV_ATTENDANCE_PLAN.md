# TV Attendance Board Plan

## Goal

Build a separate read-only TV page for daycare attendance:

```text
tv-attendance.html
```

The page is for teachers and students to view the current class status on a TV browser.
It should be lively, readable from a distance, Chinese-first, and compatible with ordinary smart TV browsers.

Page title:

```text
班级状态 Class Check-in
```

## Non-goals

- Do not add attendance editing on the TV page.
- Do not merge this page into the main Gantt dashboard yet.
- Do not build complex login or OAuth in V1.
- Do not build real points calculation in V1.
- Do not show private student details, notes, phone numbers, parent info, or sensitive fields.

## Current Project Context

Existing attendance infrastructure already exists:

- `attendance.html`
- `js/attendance.js`
- `api/attendance.py`
- `api/students.py`
- `api/_supabase.py`
- `supabase/attendance.sql`

Current data flow:

- Student master list comes from Lark.
- Attendance records are stored in Supabase when `ATTENDANCE_PRIMARY_STORE=supabase`.
- Attendance records may also sync back to Lark when configured.

V1 should reuse the existing student and attendance APIs where possible.

## Proposed Files

Create:

```text
tv-attendance.html
js/tv-attendance.js
```

Possibly add or adjust:

```text
api/attendance-tv.py
```

or extend existing read-only API behavior if that stays cleaner.

## Entry Flow

The TV page flow:

```text
Open tv-attendance.html
-> enter PIN
-> choose campus / location
-> choose BLOCK, if BLOCK exists
-> choose time segment
-> enter TV board
```

Confirmed PIN for V1:

```text
7373
```

Recommended implementation:

- Store the PIN in a backend environment variable:

```text
ATTENDANCE_TV_PIN=7373
```

- Use `7373` as a temporary fallback only if the env var is missing.
- Save successful PIN validation in `localStorage` so the TV can reopen without typing every time.
- Provide a small "更换班级" control after entering the board.

## API Security

The page-level PIN is not enough by itself.

The read API should also verify the PIN or a validated token so someone cannot bypass the page and call the API directly.

V1 can use a simple approach:

- Frontend sends PIN or a simple saved token with attendance TV API requests.
- Backend rejects requests when PIN is missing or wrong.
- Do not expose Supabase service keys, Lark credentials, or tenant tokens to the browser.

## Data Sources

Student list:

```text
GET /api/students
```

Attendance records:

```text
GET /api/attendance?date=YYYY-MM-DD
```

Existing student fields used by the attendance page:

```text
NO
学生名字
YEAR / FORM
负责老师
时间段
BLOCK
分院
Stop 月份
```

Existing attendance status fields:

```text
到了补习中心
去补习了
冲凉了
吃饭
功课完成
extra复习
回家
```

## Attendance Status Values

Existing normalized status values:

```text
到了补习中心: 未点 / 到了 / 还没有 / 缺席 / KOKO
去补习了: 未点 / 去了 / 迟进补习
冲凉了: 未点 / 冲了 / 不冲凉
吃饭: 未点 / 吃饭了 / 不吃饭
功课完成: 未点 / 完成了 / 没完成
extra复习: 未点 / extra复习了 / 没有复习
回家: 未回家 / 回家
```

The main TV status should be based on:

```text
到了补习中心
```

Main groups:

```text
已到
还没有
缺席
KOKO
未点
```

## Filters

Use today's date by default.

Selection order:

1. 分院 / location
2. BLOCK
3. 时间段

Rules:

- Campus options are generated dynamically from active students.
- BLOCK options are generated dynamically after campus selection.
- If no meaningful BLOCK data exists, skip BLOCK selection.
- Time segment options are generated dynamically from student data.
- Do not hardcode `早上`, `下午`, or `晚上`.
- Reuse existing parsing behavior where possible:
  - values containing `早`, `morning`, or `am` become `早上`
  - values containing `下`, `afternoon`, or `pm` become `下午`
  - if data contains `晚上`, display `晚上`

## TV Board Content

Header should show:

```text
班级状态 Class Check-in
分院 / BLOCK / 时间段
负责老师
Last updated / 最后更新
```

Teacher list:

- Collect from current filtered students' `负责老师`.
- De-duplicate names.
- Display only names, not teacher details.

Top stats:

```text
应到
已到
还没有
缺席
KOKO
未点
```

Confirmed:

- Show counts.
- Do not show percentages in V1.

## Student Cards

Student cards should show:

```text
学生名字
⭐ 0
status summary
```

Privacy rule:

- Show names only as the primary identity.
- Do not show notes or private details.

Points:

- Real points are not built yet.
- V1 shows `⭐ 0` as a placeholder.
- Future points may include attendance, behavior, streaks, team competition, and rewards.

## Showing All Seven Flows

The TV page should show all attendance flows, but not as a dense table.

Avoid this kind of cramped display:

```text
到: 到了 | 补: 去了 | 冲: 冲了 | 饭: 吃饭了 | 功: 完成了 | extra: 未点 | 回: 未回家
```

Preferred design direction:

- Keep the main card focused on name and main arrival status.
- Add compact visual chips or small dots for the seven flows.
- Use color and short labels to communicate quickly.
- Keep text large enough for TV viewing.

Possible chip labels:

```text
到
补
冲
饭
功
复
回
```

Each chip color follows the status tone:

- good: completed / normal
- warning: needs attention
- bad: absent or not doing
- idle: not marked
- koko: KOKO
- home: went home

## Layout Direction

Use:

```text
状态分区 + 自动滚动
```

Confirmed sorting:

- Status groups first.
- `已到` first.

Suggested group order:

```text
已到
还没有
缺席
KOKO
未点
```

Within a group, sort by:

```text
YEAR / FORM -> NO -> 学生名字
```

## Auto Scroll / Rotation

Confirmed:

```text
分页轮播
```

Behavior:

- Every 8 seconds, switch to the next page of students.
- Keep the header and stats fixed.
- Rotate within the selected class only.
- When reaching the last page, loop back to page 1.

Target:

- Support around 40 students.
- Use large text and avoid cramped rows.

## Auto Refresh

Confirmed refresh interval:

```text
8 seconds
```

Behavior:

- Fetch latest students and attendance records every 8 seconds.
- Avoid jarring full rerenders when data has not changed.
- Pause refresh when `document.hidden`.
- Refresh immediately when the page becomes visible again.

## Empty and Error States

Show clear Chinese messages:

- PIN wrong
- Cannot load students
- Cannot load attendance records
- No students match this campus / BLOCK / time segment
- No attendance records yet

If student list exists but today's attendance record does not exist for a student:

```text
未点
```

Do not hide the student.

## UI Style

Direction:

- lively
- classroom-friendly
- Chinese-first
- readable from far away
- simple enough for smart TV browsers

Avoid:

- dense tables
- tiny text
- complicated interactions
- modern browser-only features that may fail on TV
- visible technical explanations

Recommended:

- bright status colors
- big count cards
- large student names
- simple chips for the seven flows
- stable layout while pages rotate

## Browser Compatibility

Because the page targets smart TV browsers:

- Use plain HTML, CSS, and vanilla JS.
- Avoid heavy framework dependencies.
- Avoid relying on very new browser APIs.
- Keep CSS simple and resilient.
- Use `setInterval`, `fetch`, basic CSS grid/flex, and localStorage.

## Implementation Steps

1. Create `tv-attendance.html`.
2. Create `js/tv-attendance.js`.
3. Build PIN screen and saved PIN behavior.
4. Load students from existing API.
5. Build campus / BLOCK / time segment selection.
6. Load today's attendance records.
7. Merge student list with attendance records.
8. Render board header, teacher list, updated time, and stats.
9. Render status groups and student cards.
10. Add seven-flow compact chips.
11. Add 8-second auto refresh.
12. Add 8-second page rotation.
13. Add "更换班级" action.
14. Add error and empty states.
15. Verify in browser at desktop and TV-like wide viewport.

## Verification Plan

Manual checks:

- Page opens independently at `tv-attendance.html`.
- Wrong PIN is rejected.
- Correct PIN `7373` enters setup.
- Saved PIN allows reopening without typing.
- Campus options load dynamically.
- BLOCK options load dynamically or are skipped if missing.
- Time segment options load dynamically.
- Selecting a class renders students.
- Students with no attendance record show `未点`.
- Header shows teacher list.
- Header shows last updated time.
- Stats match current filtered students.
- Page rotates every 8 seconds.
- Data refreshes every 8 seconds.
- Hidden tab pauses refresh.
- No editing controls exist.
- Student private details are not displayed.

Technical checks:

- No frontend exposure of Lark credentials or Supabase service key.
- API requests require PIN or validated token.
- Existing `attendance.html` behavior is not broken.
- Existing main dashboard is not changed.

## Open Questions

These are not blockers for V1 implementation, but should be revisited:

- Should `ATTENDANCE_TV_PIN` have no code fallback after deployment?
- Should PIN validation use a signed short-lived token instead of resending PIN?
- Should the board later support real points from Supabase?
- Should points be visible to students before the reward rules are finalized?
- Should there be a dedicated TV API that returns already-merged student + attendance data?
- Should the board eventually support QR login or Lark OAuth?

