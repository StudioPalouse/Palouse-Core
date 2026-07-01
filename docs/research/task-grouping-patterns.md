# Task grouping and organization patterns in task-management tools

Research to inform a flexible, user-customizable task-organization feature for Palouse.

Prepared: 2026-07-01. Every non-obvious claim is cited to an official help center or product doc. A handful of claims are confirmed by absence (no official feature exists) or flagged as vendor-blog-sourced; these are marked inline.

## Contents
1. Executive summary
2. Comparison table
3. Core concepts and vocabulary
4. Per-tool / per-paradigm sections
5. Cross-cutting analysis (the seven questions)
6. Palouse today: current model
7. Recommendations for Palouse

---

## 1. Executive summary

Two broad design philosophies show up across the ten tools studied:

- **Fixed-structure organizers** (Microsoft To Do, Things 3, Fellow, Todoist, TickTick, Trello). The product defines a small, opinionated hierarchy (list, area/project, board), and the user's freedom is mostly in *creating instances* of that structure plus filtering. Grouping axes are limited and often fixed.
- **Reconfigurable "view" organizers** (Notion, Linear, Asana, ClickUp). The same underlying items can be re-pivoted along many axes (group by status / assignee / priority / label / custom field), rendered in multiple layouts (list / board / calendar / timeline / table), and that configuration is saved as a named, shareable **view**.

The strongest model for a "let users organize tasks any way they want" feature is the **saved View abstraction** that Notion, Linear, Asana, and ClickUp converge on: a View is a projection over a shared set of items, storing `layout + groupBy + filter + sort + visibleProperties` and nothing else (no data duplication). Cross-cutting **tags/labels** (many-to-many) plus **typed custom fields** provide the axes that `groupBy`/`filter`/`sort` operate on. This is exactly the direction the Palouse brief proposes, and the research supports it with two refinements: (1) grouping must be *orthogonal to layout* (one `groupBy`, many renderers), and (2) the filter should be a nestable boolean tree, not a flat list.

---

## 2. Comparison table

Core unit = the primary container a task lives in. "Group-by axes" = what the user can pivot a view around. "Layouts" = renderers the user can switch between.

| Tool | Core organizational unit | Container hierarchy | Cross-cutting tags/labels | Priority | Date buckets / smart lists | Custom fields | Saved views / filters | Group-by axes (user-choosable) | Layouts | Goals roll-up | Subtask nesting | Multi-membership |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Todoist** | Project | Project > Sub-project (3 lvl) > Section (max 20) | Labels `@` | 4 (p1-p4) | Inbox, Today, Upcoming | No | Saved filters w/ query language | Date, Date added, Deadline, Priority, Label | List, Board, Calendar | None (Karma only) | 4 indent levels | No (one project per task) |
| **TickTick** | List | Folder > List > Section > Task | Tags (nestable) | 4 (High/Med/Low/None) | Today, Tomorrow, Next 7 Days, Inbox | No | Filters (Normal + Advanced, Premium) | List, Date, Priority, Tag | List, Kanban, Timeline, Calendar, Eisenhower Matrix | None (Habits instead) | ~5 levels (blog-sourced) | No |
| **Microsoft To Do** | List | List group > List > Task > Step | None | Star = Important (binary) | My Day, Important, Planned, All, Completed, Assigned to me | No | No (built-in smart lists only, toggleable) | None (list-only) | List only | None | 1 level (flat steps) | No |
| **Things 3** | To-do (org'd by Area/Project) | Area > Project > Heading > To-do > Checklist | Tags (live filter) | None native | Today (+This Evening), Upcoming, Anytime, Someday, Logbook (fixed) | No | No (tag filter is live, not saved) | None (fixed lists) | List only | None (project ring only) | ~5 levels; checklist is flat | No |
| **Asana** | Project | Org/Workspace > Team > Project > Section > Task > Subtask | Tags + Custom Fields | Built-in custom-field template | My Tasks (Today/Upcoming/Later) | Yes (typed) | Yes, saved as default view; advanced search saved as reports | Section, Assignee, Due date, Priority, Custom field | List, Board, Timeline, Calendar, Gantt | Asana Goals (auto/manual roll-up) | Multi-level (max unclear) | Yes (multi-homing) |
| **ClickUp** | List | Workspace > Space > Folder > List > Task > Subtask | Tags + Custom Fields | Native Priority field | My Tasks page; "All Tasks" global | Yes (typed) | Yes, saved per List/Folder/Space; private or shared | Status, Assignee, Priority, Tags, Due date, Custom field, None | List, Board, Calendar, Gantt, Timeline, Table, Workload, Mind Map, Map, + doc/form/chat | ClickUp Goals w/ Targets (Number/Currency/True-False/Task) | Nested subtasks | Yes (Tasks in Multiple Lists ClickApp) |
| **Linear** | Issue (owned by Team) | Workspace > Team > Project/Cycle > Issue > Sub-issue; Initiatives above projects | Labels | Priority field | My Issues; Triage; Focus (My Issues only) | No (labels + fields limited) | First-class Custom Views (shareable; personal/workspace defaults) | Status, Assignee, Project, Priority, Cycle, Label, Parent, Team, Customer, Release, SLA | List, Board (Cmd+B) w/ sub-grouping | Initiatives (health + roll-up); project Milestones | Sub-issues (2-level primary) + relations | No |
| **Fellow** | Action item (born in a Meeting / Note Series) | Workspace > Meeting/Note Series > Action item (flat) | Not primary | Not primary | Central Action Items page | No | No (toggle-based group/sort/filter only) | Due Date, Meeting/Note Series, Custom, None | Grouped list | Objectives/OKRs (Legacy feature) | Flat | No |
| **Notion** | Database (row = page) | Workspace > Teamspace > Database; sub-items in DB | Multi-select (tags) property | Any select/status property | Any Date property view (Calendar) | Yes (typed properties) | Yes, each view saves layout+group+filter+sort+props | Any property (+ sub-group) | Table, Board, Timeline, Calendar, List, Gallery, Chart | Relations + Rollups (native, DIY) | Sub-items in DB; sub-pages | Relations (a row can relate to many) |
| **Trello** | Card (in a List) | Workspace > Board > List > Card > Checklist | Labels (color) + Members | None native | Dashboard (Premium) | Yes (5 types, paid) | Filters are saved/persistent; Table view flat | List (positional); Table view (flat, no group) | Board, Table, Calendar, Timeline, Dashboard, Map (most Premium) | None native (Power-Ups only) | Flat (checklists != subtasks) | Card can link to boards; no multi-list |

Sourcing for every cell is in the per-tool sections below.

---

## 3. Core concepts and vocabulary

Consistent primitives seen across tools, with the names each vendor uses:

- **Container / core unit**: Project (Todoist, Asana), List (Microsoft To Do, TickTick, ClickUp), Area+Project (Things), Board (Trello), Database (Notion), Issue+Team (Linear), Action item + Meeting (Fellow). This is the hard "where does a task live" boundary.
- **Section / heading**: a flat subdivision *inside* a container (Todoist Sections, Things Headings, Asana Sections, TickTick Sections). Doubles as board columns / group-by rows.
- **Label / tag**: cross-cutting, many-to-many (Todoist Labels, Things Tags, Asana/ClickUp Tags, Linear Labels, Notion multi-select, Trello Labels). The key primitive for "organize the same task multiple ways."
- **Priority**: 4-level in Todoist/TickTick; a custom-field template in Asana; native field in ClickUp/Linear; binary star in To Do; absent in Things.
- **Status / workflow state**: native customizable primitive in ClickUp and Linear; approximated by Sections + complete flag in Asana; a Status property in Notion.
- **Date buckets / smart lists**: system-defined auto-views (Today, Upcoming, Inbox, My Day, Anytime/Someday). Usually fixed, not user-authored.
- **Custom fields**: typed attributes (select, number, date, person, currency) in Asana, ClickUp, Notion, Trello.
- **View**: a saved projection with layout + groupBy + filter + sort in Notion, Linear, Asana, ClickUp.
- **Goal / objective**: a higher-level target that tasks/projects roll up into (Asana Goals, ClickUp Goals, Linear Initiatives, Notion via Relations+Rollups).

---

## 4. Per-tool / per-paradigm sections

### 4.1 Todoist (project-centric with a filter query language)

Core unit is the **Project**; every task lives in a project or the Inbox. Projects nest into sub-projects up to 3 indent levels ([sub-projects](https://www.todoist.com/help/articles/create-a-sub-project-in-todoist-aTA15C70)). **Sections** subdivide a project, max 20, one flat level ([sections](https://www.todoist.com/help/articles/introduction-to-sections-rOrK0aEn)). **Labels** (`@label`) are the cross-project tag; **priorities** are 4 levels p1-p4 ([filters intro](https://www.todoist.com/help/articles/introduction-to-filters-V98wIH)). System views Inbox / Today / Upcoming span all projects ([workspaces FAQ](https://www.todoist.com/help/articles/team-workspaces-faq-dCQNAHDjU)).

Customization is strong for a "fixed-structure" tool. The Display menu lets you **group by** Date, Date added, Deadline, Priority, or Label and **sort by** Manual, Name, Date, Date added, Deadline, or Priority; grouping/sorting is per-user, and enabling a grouping disables manual drag-reorder ([sort or group tasks](https://www.todoist.com/help/articles/sort-or-group-tasks-in-todoist-WFWD0hrb)). **Saved filters** use a real query language: `&` (AND), `|` (OR), `!` (NOT), `()` grouping, plus keywords `p1`-`p4`, `@label`, `#Project` (`##Project` to include sub-projects), `today`/`overdue`/`no date`, `search:`, `assigned to:`. Example: `(p1 | p2) & 14 days` ([filters intro](https://www.todoist.com/help/articles/introduction-to-filters-V98wIH)). Layouts: **List, Board (Kanban), Calendar**, cycled with Shift+V ([board](https://www.todoist.com/help/articles/use-the-board-layout-in-todoist-AiAVsyEI), [calendar](https://www.todoist.com/help/articles/use-the-calendar-layout-in-todoist-lPHRQTu0o)).

Work/personal separation: **Team Workspaces** (Business) sit alongside private "My Projects" ([team workspaces FAQ](https://www.todoist.com/help/articles/team-workspaces-faq-dCQNAHDjU)). No native goal roll-up (Karma/productivity trends only; confirmed absence). Sub-tasks nest to 4 indent levels ([sub-tasks](https://www.todoist.com/help/articles/introduction-to-sub-tasks-kMamDo)). Signature UX: natural-language **Quick Add** (`Q`) parsing dates ("tomorrow at 4pm", "every 3rd Tuesday"), `#Project`, `@label`, `p1`, `+assignee` ([quick add](https://www.todoist.com/help/articles/use-task-quick-add-in-todoist-va4Lhpzz)).

### 4.2 TickTick (list-centric, most built-in view types)

Core unit is the **List**; documented hierarchy is Folder > List > Section > Task > Subtask ([lists](https://help.ticktick.com/articles/7055782283059396608)). **Folders** group lists, created by dragging one list onto another ([folders](https://help.ticktick.com/articles/7055782296019795968)). **Tags** are cross-list and support parent (nested) tags plus "Tag Section" grouping ([tags](https://help.ticktick.com/articles/7055782255804809216)). Priority is 4 levels ([filters](https://help.ticktick.com/articles/7055782240994721792)). Built-in smart lists: Today, Tomorrow, Next 7 Days, Inbox, Assigned to Me ([lists](https://help.ticktick.com/articles/7055782283059396608)).

TickTick ships the most out-of-the-box layouts: **List, Kanban, Timeline, Calendar**, and a distinctive **Eisenhower Matrix** 4-quadrant view with customizable placement rules ([kanban](https://help.ticktick.com/articles/7055782381696843776), [timeline](https://help.ticktick.com/articles/7055782353376903168), [calendar](https://help.ticktick.com/articles/7055782085826445312), [matrix](https://help.ticktick.com/articles/7055782055577124864)). **Advanced filters** support AND/OR multi-statement queries and are a Premium feature ([filters](https://help.ticktick.com/articles/7055782240994721792)). No workspace-level work/personal split (lists/folders only); no goal roll-up (Habits feature instead). Subtasks nest ~5 levels (this exact number is TickTick-blog-sourced; the help center confirms multilevel tasks without the number: [multilevel tasks](https://help.ticktick.com/articles/7055782219767349248)).

### 4.3 Microsoft To Do (fixed lists + smart lists, deliberately simple)

Core unit is the **List**; **list groups** are a single container level above lists in the sidebar ([organize lists](https://support.microsoft.com/en-gb/office/organize-your-lists-14eb65d0-d1b1-4321-83e5-5f952196ce1a)). Built-in **smart lists**: My Day, Important, Planned, All, Completed, Assigned to me, Flagged email, plus the default Tasks list; users cannot author custom smart lists but can toggle built-ins in Settings ([welcome](https://support.microsoft.com/en-us/office/welcome-to-microsoft-to-do-762cbbf9-7fc1-48e5-b619-005622da89d0), [To Do in Outlook](https://support.microsoft.com/en-us/office/manage-tasks-with-to-do-in-outlook-6e8a991b-ea62-4009-a7f7-62b70a57ec18)). **My Day** is an ephemeral daily list holding references that reset nightly ([My Day](https://support.microsoft.com/en-us/office/my-day-and-suggestions-fc09a1b9-0854-4906-b166-f480ee97a139)). **Steps** are flat subtasks (no nesting). There are **no tags**, no user-defined saved views, and list-only layout (no board/calendar). Importance is a binary **star**. Work/personal separation via **multiple accounts side by side** (personal + work/school), not mergeable ([multiple accounts](https://support.microsoft.com/en-us/office/using-multiple-accounts-with-microsoft-to-do-49d89f46-781a-497b-ac3c-f9ab45b0937f)). No goals. This is the "opinionated minimalism" end of the spectrum: value is in constraint, not flexibility.

### 4.4 Things 3 (two-axis model: context vs time)

Core unit is the **To-do**, captured first in the **Inbox**, then organized by **Areas** (ongoing thematic containers that never complete) and **Projects** (multi-step, with a completion ring) ([guide](https://culturedcode.com/things/guide/)). **Headings** subdivide a project only ("not available in areas or any other list": [headings](https://culturedcode.com/things/support/articles/2803577/)). **Tags** are cross-cutting with live list filtering ([features overview](https://culturedcode.com/things/support/articles/1059358/)). **Checklists** are flat sub-items inside a to-do ([features](https://culturedcode.com/things/features/)). The other axis is **time**: fixed smart lists Today (+This Evening), Upcoming, Anytime, Someday, Logbook ([today/upcoming/anytime/someday](https://culturedcode.com/things/support/articles/4001304/)). Things is explicit that these are two perspectives on the same to-dos: context (areas/projects) and time (smart lists).

Customization: tag filtering is live, not saved; the five time lists are fixed and cannot be renamed or created; no board/calendar layout, list-only. Work/personal separation is structural via Areas (single Things Cloud account per install: [sync](https://culturedcode.com/things/support/articles/2803586/)). No goals roll-up. Signature UX: the **Magic Plus** drag-to-create/position button, natural-language date entry ("Tom", "Sat", "Wed 8pm": [scheduling](https://culturedcode.com/things/support/articles/2803579/)), Quick Entry with Autofill, and **This Evening** as a same-day deferral bucket.

### 4.5 Asana (project layouts + Goals roll-up)

Chain: Organization/Workspace > Team > **Project** (core unit) > Section > Task > Subtask, with Tags, typed Custom Fields, Assignee, Due date as cross-cutting attributes ([workspaces FAQ](https://help.asana.com/s/article/workspaces-and-organizations-faq?language=en_US), [custom fields](https://help.asana.com/s/article/custom-fields?language=en_US)). Priority ships as a built-in **custom-field template** (High/Med/Low), so users experience it as semi-native ([prioritize](https://help.asana.com/s/article/manage-and-prioritize-your-tasks?language=en_US)).

Customization is a headline feature. Per-project **layouts**: List, Board, Timeline, Calendar, Gantt ([list view](https://help.asana.com/hc/en-us/articles/14104942767259-List-view)). **Group by** Section (default), Assignee, Due date, Priority, or any Custom Field; **sort**, multi-filter, and **saved default views** ([My Tasks](https://help.asana.com/s/article/my-tasks), [filter and sort custom fields](https://help.asana.com/s/article/filtering-and-sorting-custom-fields)). **My Tasks** is a personal cross-project aggregate with its own sections and rules. **Portfolios** roll up multiple projects; advanced search saves cross-project reports (both real, but exact mechanics not re-fetched this pass).

**Asana Goals** are company/team objectives broken into sub-goals; progress is **Automatic** (calculated from a chosen source: sub-goals, projects, or tasks, measured as percentage / numeric total / currency total) or **Manual** ([progress and connecting work to goals](https://help.asana.com/s/article/progress-status-and-connecting-work-to-goals?language=en_US), [tracking goals](https://help.asana.com/s/article/setting-and-tracking-progress-towards-goals?language=en_US)). Projects and tasks link to a goal as "supporting work." **Multi-homing**: the same task lives in multiple projects with synced edits, no duplication ([multi-home](https://help.asana.com/s/article/how-to-multi-home-tasks?language=en_US)). Subtasks nest multiple levels (Asana's own docs are internally inconsistent about the max, so treat "5 levels" as unconfirmed). UX: natural-language dates, drag reorder, group collapse, multi-select bulk edit ([bulk edit](https://help.asana.com/s/article/how-to-bulk-select-and-edit-tasks?language=en_US)), and **Rules** (trigger + actions: [rules](https://help.asana.com/s/article/rules?language=en_US)).

### 4.6 ClickUp (deepest hierarchy, most layouts, heterogeneous Goals)

Chain: Workspace > Space > Folder (optional, sub-folders allowed) > **List** (core unit) > Task > Subtask > nested subtask ([hierarchy](https://help.clickup.com/hc/en-us/articles/13856392825367-Intro-to-the-Hierarchy), [spaces](https://help.clickup.com/hc/en-us/articles/6309466958103-Intro-to-Spaces), [folders](https://help.clickup.com/hc/en-us/articles/6311450560407-What-are-Folders), [lists](https://help.clickup.com/hc/en-us/articles/6311877646999-Intro-to-Lists)). **Status** is a first-class customizable workflow primitive (per Space/List), plus Tags and typed Custom Fields.

Views: "over a dozen" including List, Board, Calendar, Gantt, Timeline (Gantt and Timeline are distinct), Workload, Table, Activity, Map, Mind Map, plus Doc/Chat/Whiteboard/Form; addable at Space/Folder/List level and saved as private or shared objects ([intro to views](https://help.clickup.com/hc/en-us/articles/6329880717719-Intro-to-views), [task views](https://help.clickup.com/hc/en-us/articles/6310172583831-Everything-You-Need-to-Know-About-Task-Views)). **Group by** Status (default), Assignee, Priority, Tags, Due date, Custom field, or None. **All Tasks** ("Everything") is a Workspace-wide aggregate ([view all tasks](https://help.clickup.com/hc/en-us/articles/6309783246103-View-all-your-tasks)).

Work/personal separation happens either at the Workspace boundary or one level down via Spaces ([individual workspace](https://help.clickup.com/hc/en-us/articles/9563959684119-Set-up-your-individual-Workspace)). **ClickUp Goals** hold measurable **Targets** of four types: Number, True/False, Currency, and Task (a Task target can bind to a single task, subtask, or an entire List and auto-tracks completion); Goal percentage averages across Targets, and Goal Folders roll up many goals ([create a goal](https://help.clickup.com/hc/en-us/articles/6325733579671-Create-a-Goal)). **Tasks in Multiple Lists** (a toggleable ClickApp) is the multi-homing analog ([tasks in multiple lists](https://help.clickup.com/hc/en-us/articles/6309958824727-Tasks-in-Multiple-Lists)). UX: drag across statuses/lists, group collapse, Bulk Action Toolbar, natural-language dates, and Automations (trigger + action).

### 4.7 Linear (keyboard-first, first-class Custom Views, Initiatives)

Core unit is the **Issue**, "the fundamental unit of work" ([conceptual model](https://linear.app/docs/conceptual-model)). Hierarchy: Workspace > **Teams** (own their workflows, cycles, labels; support sub-teams) > Projects (shared outcome, contain Milestones) and Cycles (time-boxed sprints) > Issues > Sub-issues. **Initiatives** sit above projects as workspace-level goals ([initiatives](https://linear.app/docs/initiatives)). Issues carry assignee, priority, labels, estimate, due date, and move through team-defined **workflow states**.

Customization is the differentiator. **Group by** status, assignee, project, priority, cycle, label, parent, team, customer, release, SLA status, plus Focus (My Issues only); **ordering** by Status, Manual, Priority, created, updated, due date, link count; **layouts** List and Board (Cmd/Ctrl+B) with **sub-grouping** in both ([display options](https://linear.app/docs/display-options), [board layout](https://linear.app/docs/board-layout)). **Custom Views** are first-class: save any filtered board/list (Alt/Opt+V), share with the team, set as personal or workspace default ([custom views](https://linear.app/docs/custom-views)).

**Initiatives** roll up project progress with health signals (on track / at risk / off track) and rolled-up active-project status ([initiatives](https://linear.app/docs/initiatives)); Milestones are project-level stages ([projects](https://linear.app/docs/projects)). **Sub-issues** inherit parent team/priority/project (not labels); all-sub-issues-done can auto-complete the parent ([parent and sub-issues](https://linear.app/docs/parent-and-sub-issues)). Separate **issue relations**: blocked/blocking/related/duplicate ([relations](https://linear.app/docs/issue-relations)). Signature UX: **command menu** (Cmd/Ctrl+K), keyboard-first navigation (C to create, X to select, G-then-letter to navigate), multi-select bulk edit ([select issues](https://linear.app/docs/select-issues)).

### 4.8 Fellow (meeting-first action items)

Fellow is meeting-centric: action items are born inside meeting and 1-on-1 notes, and the **Meeting / Note Series** is the core organizing unit ([action item page](https://help.fellow.ai/en/articles/4144380-action-item-page)). A central **Action Items page** compiles every item with its source meeting, assignees, and due date ([organize action items](https://help.fellow.ai/en/articles/4495787-organize-action-items)). On that page you can **group by** Due Date, Meeting/Note Series, Custom (user-defined drag-and-drop buckets), or None; **sort** by Custom/Due Date/Date Created; and filter Show completed / Show archived ([organize action items](https://help.fellow.ai/en/articles/4495787-organize-action-items)). There is no documented saved-view system beyond these toggles, no board layout, and action items are flat (no sub-items) [both inferred from absence in docs].

Work/personal separation is by **Workspace** (separate accounts per domain, with Switch Workspace: [navigating workspaces](https://help.fellow.app/en/articles/3782965-navigating-between-workspaces)). Fellow's OKR-style **Objectives** feature exists but is now marked a **Legacy Feature** ([objectives legacy](https://help.fellow.app/en/articles/5647913-objectives)); do not assume full current support. Signature UX: AI meeting recap that suggests action items, assign-from-notes, and carry-over of incomplete items across meetings.

### 4.9 Notion (the database-with-many-views paradigm)

Notion is the reference implementation of the flexible model. A **database is a collection of pages**; every row is a full page, and **properties** are the typed schema: Title, Text, Number, Select, **Multi-select (tags)**, Status, Date, Person, Relation, Rollup, Formula, Checkbox, Files, and more ([intro to databases](https://www.notion.com/help/intro-to-databases), [properties](https://www.notion.com/help/database-properties)). The paradigm: **one database, many views** ([views, filters, sorts and groups](https://www.notion.com/help/views-filters-and-sorts)).

Anatomy of a Notion **view** (the object to model on):

| Field | Holds | Detail |
|---|---|---|
| Layout | One of 7 renderers | Table, Board, Timeline, Calendar, List, Gallery, Chart |
| Group by | A single property | Board defaults to Status, else select/person/multi-select/relation ([board](https://www.notion.com/help/boards)) |
| Sub-group | A second grouping property nested in each group | "A second layer of grouping" |
| Filter | Predicate over properties | AND/OR filter groups nestable up to three layers deep |
| Sort | Ordered (property, direction) list | Multi-key, priority-ordered |
| Visible properties | Per-view show/hide + order | Independent per view |
| Layout sub-options | Renderer-specific | e.g. Board card size; Calendar/Timeline date property |

Four load-bearing properties for our design: (1) a **View is a projection, not a copy** (the database is the single source of truth); (2) **group-by is orthogonal to layout** (same `groupBy` drives Board columns and Table row-groups); (3) **filter is a nestable boolean tree**, not a flat list; (4) **property visibility is per-view**, so it lives on the View, not the schema. Goals are modeled natively via **Relations + Rollups**: a Tasks database relates to a Goals database, and a rollup computes percent-complete ([relations and rollups](https://www.notion.com/help/relations-and-rollups)). **Sub-items** provide in-database parent/child nesting ([sub-items and dependencies](https://www.notion.com/help/tasks-and-dependencies)). Separation via Workspaces / Teamspaces / Private sections ([teamspaces](https://www.notion.com/help/intro-to-teamspaces)).

### 4.10 Trello (kanban: the List is the grouping)

Structure: Workspace > Board > List > Card > Checklist ([cards and lists](https://support.atlassian.com/trello/docs/add-and-customize-cards-and-lists/)). The **canonical grouping is the List itself**: cards are arranged left-to-right and you reorganize by dragging cards between lists. Card attributes are a fixed built-in set (Labels, Members, Due dates) plus optional **Custom Fields** (Checkbox, Date, Dropdown, Number, Text; Standard plan+; max 50/board: [custom fields](https://support.atlassian.com/trello/docs/using-custom-fields/)). **Checklists are not subtasks** (in-card item lists; advanced checklists can assign a person/due date on paid plans: [checklists](https://support.atlassian.com/trello/docs/adding-checklists-to-cards/)); there are no nested cards.

Grouping flexibility is low: the standard board has no "group by label/member," and Table view is flat ([table view](https://support.atlassian.com/trello/docs/single-board-table-view/)). Instead, flexibility comes from **saved, persistent filters** ("stays in place until you dismiss it, even if you leave the board": [filtering](https://support.atlassian.com/trello/docs/filtering-for-cards-on-a-board/)). Additional layouts (Calendar, Timeline, Dashboard, Map, Workspace Table/Calendar) are mostly **Premium** ([workspace views](https://support.atlassian.com/trello/docs/workspace-views/)). No native goal roll-up (Dashboard metrics or third-party Power-Ups only). Separation via Workspaces (+ Premium board collections). Trello's lesson: a rigid but extremely legible model where drag-between-lists is the entire interaction, and re-pivoting is replaced by filtering.

---

## 5. Cross-cutting analysis (answering the seven questions)

**Q1. Grouping primitives and the core unit.** Every tool has exactly one hard container ("core unit": project, list, issue, card, database, action item). Above it sit optional org layers (workspace, team, space, folder). Below/across it sit soft axes: sections, tags/labels, priority, status, assignee, due date, custom fields. The tools that feel most flexible (Notion, ClickUp, Asana, Linear) are precisely those that expose the most *soft axes* and let a view pivot on them.

**Q2. Customization of grouping.** Clear split. Fixed-structure tools (To Do, Things, Trello board, Fellow) offer little-to-no choice of grouping axis and single or few layouts. Reconfigurable tools let the user choose `groupBy` from a menu of axes, switch layout independently (list/board/calendar/timeline/table), and **save the result as a named view** (Notion, Linear, Asana, ClickUp). Todoist and TickTick are the middle ground: choosable group/sort and multiple layouts, but grouping axes are a fixed short list and saved "views" are really saved *filters*.

**Q3. Work vs personal separation.** Three mechanisms, often combined: (a) **separate accounts** (Microsoft To Do side-by-side personal + work/school; Fellow separate account per workspace domain); (b) **separate workspaces/orgs** under one login with hard data isolation (Asana Org vs Workspace, ClickUp/Notion/Linear/Trello multiple workspaces); (c) **structural containers within one space** (Things Areas, ClickUp Spaces, Todoist personal vs Team Workspace, Notion Private/Teamspace sections). The trend for team tools is workspace-level isolation plus a "My Tasks/My Issues" personal cross-cut inside each.

**Q4. Grouping by goal/objective.** Four tools have real goal roll-up. **Asana Goals**: automatic progress from sub-goals, projects, or tasks, or manual, measured as percent/number/currency. **ClickUp Goals**: heterogeneous Targets (Number, Currency, True/False, Task-bound) averaged into a goal percentage; a Task target can bind to an entire List. **Linear Initiatives**: roll up project health above projects; Milestones are project-level stages. **Notion**: no dedicated goal object, but Relations + Rollups model it natively and generically. The pattern: goals are a *separate object* that references tasks/projects as "supporting work" and computes a rollup; tasks are not "moved into" a goal, they are *linked* to it (many-to-many-ish). To Do, Things, Todoist, TickTick, Trello, and (currently) Fellow have no roll-up.

**Q5. Nested vs flat.** Universal shape: a shallow container hierarchy plus a leaf task tree. Subtasks nest 4-5 levels where supported (Todoist 4, TickTick ~5, Asana/ClickUp multi-level, Linear sub-issues typically 2), while the lightest tools keep leaves flat (To Do steps, Things checklists, Trello checklists, Fellow). Sections/headings are almost always a single flat level. Notion is unusual: because a row is a page, nesting can be arbitrarily deep via sub-pages and nested databases. Practical takeaway: users rarely need more than ~2-3 levels of task nesting; deep nesting is a power-user edge case and a data-model tax.

**Q6. UX patterns worth stealing.**
- **Natural-language quick-add** with inline tokens: Todoist `#project @label p1 +assignee` and dates ("tomorrow 4pm"), Things date parsing, TickTick `#tag`. High-leverage, universally loved.
- **Drag-to-reorder / drag-between-groups** (kanban): Trello and Notion boards; note Todoist disables manual drag when a grouping is active (a real UX tension to design around).
- **Layout toggle** on the same data (Linear Cmd+B; Todoist Shift+V; ClickUp/Notion/Asana tabs).
- **Collapsible sections/groups** everywhere; group collapse is table stakes.
- **Multi-select bulk edit** (Linear Shift+click then bulk change any field; Asana/ClickUp bulk toolbars).
- **Command palette** and keyboard-first navigation (Linear Cmd+K, G-then-letter).
- **Sub-grouping** (Notion, Linear): a second axis inside each group, cheap to add once you have one groupBy.
- **Persistent filters** (Trello): a filter that survives navigation feels like a lightweight saved view.
- **Ephemeral daily buckets** (To Do My Day, Things Today/This Evening): a "planning surface" distinct from the permanent structure.

**Q7. Data-model implications.** The flexible tools converge on the same three-part model:
1. **Items with typed attributes.** Tasks plus a set of properties (native columns for common ones: status, priority, assignee, due date; plus user-defined **custom fields** for the rest).
2. **Many-to-many tags/labels.** A join table (task_tags) so the same task can be organized along multiple orthogonal axes simultaneously. This is what makes "organize any way you want" possible without duplicating tasks.
3. **A single View abstraction.** A saved object storing `{ layout, groupBy, subGroupBy, filter (boolean tree), sort (ordered keys), visibleProperties, scope }` that *projects* over the item set. Views never copy data; they are pure presentation state. Optionally, a **multi-homing** join (task can belong to multiple containers) for the Asana/ClickUp pattern, and a separate **Goal** object with a rollup for objective tracking.

---

## 6. Palouse today: current model

Verified from the codebase (Postgres + Drizzle ORM, Hono API, Next.js web):

- **Stack**: monorepo (pnpm + Turbo). Schema in TypeScript at `packages/db/src/schema/*.ts`; SQL migrations in `packages/db/migrations/`. Task query logic in `packages/core/src/tasks/service.ts`; DTOs in `packages/shared/src/task.ts`; API route `apps/api/src/routes/tasks.ts`; task UI in `apps/web/src/app/tasks/page.tsx`.
- **`tasks` table** (`packages/db/src/schema/tasks.ts`): `id`, `workspace_id` (FK, the tenant boundary), `title`, `description_md`, `status` (enum: open/in_progress/blocked/done/archived), `priority` (int 0-4, 0=Urgent), `due_at`, `assignee_user_id` (scalar), `parent_task_id` (self-FK, the only structural grouping today), plus external-sync fields. Related: `task_assignments` (richer user/agent assignees), `task_comments`, `task_sources`.
- **Containers today**: `workspaces` (under `organizations`) with `memberships` (roles owner/admin/member/viewer). Active workspace stored client-side (`palouse.activeWorkspaceId`), switcher in `app-shell.tsx`.
- **What does NOT exist**: no `projects`, `tags`/`labels`, `sections`, `views`/`saved_views`, `filters`, or `custom_fields` tables. Grep-confirmed. Task list filtering is ephemeral client-side (`status` + `search` in React state); API `listTasksQuery` supports only `workspaceId`, `status`, `assigneeUserId`, `search`, `limit`, `offset`, always ordered `updated_at desc`. The web list is a single flat `<ul>` with no grouping.
- **Adjacent concepts**: `agent_handoffs` (fully modeled work-delegation state machine) and a UI "Inbox" that is just the label for the default task list (`inbox/page.tsx` redirects to `/tasks`). Sidebar has placeholder "Projects" and "Objectives" pages: Projects' Coming Soon copy literally says "group related tasks into projects and move them through stages," confirming grouping is the intended next step.

So Palouse's only real grouping axes today are **workspace** (hard container) and **parent_task_id** (subtask tree). Everything else is a flat attribute. This is a greenfield insertion point.

---

## 7. Recommendations for Palouse

The brief proposes: a single **View** abstraction (saved views with configurable `groupBy + filter + sort + layout`) plus **tags/labels** as the many-to-many primitive. **This is the right core.** It matches where every flexible tool has landed (Notion, Linear, Asana, ClickUp), and it fits Palouse's greenfield state cleanly. Below is a critique and a concrete refinement.

### 7.1 What the proposal gets right
- **View as projection, not container.** Tasks stay in the workspace (and optionally a project); a View only stores presentation state and re-pivots the same rows. No duplication, no sync problem. This is Notion's key insight and it is the correct default.
- **Tags as the many-to-many axis.** A `task_tags` join is what lets one task be "work + urgent + client-Acme" at once and be grouped/filtered along any of those. Without it, users are forced into a single hierarchy (the To Do / Things trap).
- **groupBy orthogonal to layout.** Store one `groupBy` and let layout be a separate renderer, so "group by priority" works identically as a list with headers or a board with columns.

### 7.2 Refinements and cautions

1. **Separate the axes from the View.** A View references axes (properties); it does not own them. Model three things:
   - **Native fields** on `tasks` (already present: status, priority, due_at, assignee) as first-class group/filter/sort axes.
   - **Tags** (`tags` + `task_tags` join, workspace-scoped, many-to-many).
   - **Custom fields** (optional, phase 2): `custom_field_defs` (workspace-scoped, typed: select/number/date/person) + `task_custom_values`. This is what lets grouping stay flexible without schema migrations every time a user wants a new axis. Asana/ClickUp/Notion all rely on this; it is the difference between "flexible" and "flexible forever."

2. **Make `filter` a nestable boolean tree, not a flat list.** Notion and Todoist both support AND/OR nesting. Store filter as a recursive JSON node `{ op: AND|OR, children: [...] } | { field, condition, value }`, validated with a Zod schema in `packages/shared`. A flat `Filter[]` will need a painful migration later.

3. **Make `sort` an ordered multi-key list.** `[{ field, dir }]` where array order = priority. Cheap now, expensive to retrofit.

4. **Add `subGroupBy` from day one (nullable).** It is a tiny addition to the schema and the single most requested "power" feature (Notion, Linear both have it). Even if the UI ships later, reserve the field.

5. **Decide the layout set deliberately, ship a subset.** The full menu is List, Board, Calendar, Timeline, Table. Recommended tracer-bullet order (consistent with the "thin end-to-end slice" principle): **List with group headers first**, then **Board** (reuses `groupBy` as columns; pairs naturally with the existing `status` enum and the Projects "move through stages" copy), then Calendar (uses `due_at`), then Table/Timeline. Store `layout` as an enum and `layoutOptions` as JSON for renderer-specific settings (board card size, calendar date field).

6. **Watch the drag-reorder vs grouping tension.** Todoist disables manual drag when grouping is active because manual order and computed grouping conflict. Plan for a `manual_order` (fractional index / lexorank-style string) on tasks, scoped per container, and define the rule: manual order applies within a group; switching groupBy re-sorts. Do not bolt this on later.

7. **Views need a scope and a sharing model.** A View should have: `scope` (workspace-wide vs a specific project/container vs personal), `owner_user_id`, and `visibility` (private / shared-with-workspace / workspace-default). Linear's "personal default vs workspace default" is the pattern to copy. Palouse already has `memberships` with roles, so gate "set workspace default" to admins.

8. **Introduce Projects as an optional soft container, not a hard one.** The sidebar already promises Projects. Model a project as an optional `project_id` on tasks (nullable FK), plus consider **multi-homing** (a `task_projects` join) only if the Asana/ClickUp "one task in several projects" behavior is desired. Recommendation: start with a single nullable `project_id` (simpler, covers 90% of need); reserve multi-homing as a later join-table migration. Keep the **workspace** as the only hard boundary.

9. **Goals/Objectives: model as a separate linked object, later.** The sidebar promises Objectives. Do not fold goals into the View system. Follow the universal pattern: an `objectives` table plus a `task_objectives` (or `objective_supporting_work`) link, with a computed rollup (percent of linked tasks done, or a manual value). This is Asana/Linear/Notion's shape. It is a phase-3 concern; the View + tags + custom-fields core does not depend on it.

10. **Do not over-nest.** Palouse already has `parent_task_id`. Cap effective subtask depth at ~2-3 in the UI even if the data model allows more; the research shows deep nesting is a rarely-used power feature that complicates rollups and rendering.

### 7.3 Proposed data model (concrete)

```
-- Cross-cutting axis: tags (many-to-many)
tags            ( id, workspace_id FK, name, color, unique(workspace_id, name) )
task_tags       ( task_id FK, tag_id FK, primary key(task_id, tag_id) )

-- Optional soft container (phase 1: single-home)
projects        ( id, workspace_id FK, name, slug, archived_at )
-- tasks.project_id  uuid null references projects(id)   -- add column

-- Custom fields (phase 2)
custom_field_defs   ( id, workspace_id FK, name, type[select|number|date|person|text], options jsonb, ... )
task_custom_values  ( task_id FK, field_id FK, value jsonb, primary key(task_id, field_id) )

-- The View abstraction
views (
  id                uuid pk,
  workspace_id      FK,
  owner_user_id     FK,
  name              text,
  scope             enum[workspace | project | personal],
  scope_project_id  uuid null,          -- when scope = project
  visibility        enum[private | shared | workspace_default],
  layout            enum[list | board | calendar | timeline | table],
  group_by          text null,          -- field key: 'status'|'priority'|'assignee'|'due_bucket'|'tag'|'project'|'cf:<id>'
  sub_group_by      text null,
  filter            jsonb null,         -- recursive boolean tree {op, children} | {field, condition, value}
  sort              jsonb not null default '[]',  -- ordered [{field, dir}]
  visible_fields    jsonb null,         -- per-view show/hide + order
  layout_options    jsonb null,         -- renderer-specific (card size, calendar date field)
  created_at, updated_at
)
-- manual task order lives on tasks (fractional index per container), not on views
```

Field-key convention (`status`, `priority`, `cf:<uuid>`, `tag`) lets `group_by`/`sort`/`filter` reference native fields, tags, and custom fields uniformly, so one code path handles all axes. This is the single most important design decision: a **uniform "field reference" string** across group/sort/filter is what makes the system feel infinitely flexible while staying one abstraction.

### 7.4 Suggested build order (tracer bullets)
1. **Slice 1**: tags + `task_tags`; native-field group/sort/filter; one saved **View** with **List layout + group headers**; ship end-to-end (schema, `packages/shared` Zod DTOs, `packages/core` query builder, `apps/api/src/routes/tasks.ts` or a new `views.ts`, and the `apps/web` list UI). Pause for feedback.
2. **Slice 2**: Board layout (reuse `group_by` as columns), drag-to-reorder with `manual_order`, collapsible groups, multi-select bulk edit.
3. **Slice 3**: custom fields; sub-grouping; Calendar layout; view sharing/defaults.
4. **Slice 4**: Projects as soft container; then Objectives with rollup.

### 7.5 One dissenting consideration
A pure View system can feel *too* open-ended for new users (the "blank Notion database" problem). Mitigate by shipping 2-3 default system Views out of the box (e.g. "By status" board, "Due today" list, "By priority" list), the way To Do ships My Day/Planned and Todoist ships Today/Upcoming. Users get value with zero configuration, and power users discover that those defaults are just Views they can clone and edit. This combines Trello's legibility with Notion's flexibility, which is the sweet spot for a work-execution app.

---

## Sources
All URLs are official help centers / product docs, inline above. Notable pages:
Todoist filters https://www.todoist.com/help/articles/introduction-to-filters-V98wIH ,
sort/group https://www.todoist.com/help/articles/sort-or-group-tasks-in-todoist-WFWD0hrb ;
TickTick lists https://help.ticktick.com/articles/7055782283059396608 ;
Microsoft To Do welcome https://support.microsoft.com/en-us/office/welcome-to-microsoft-to-do-762cbbf9-7fc1-48e5-b619-005622da89d0 ;
Things guide https://culturedcode.com/things/guide/ ;
Asana goals https://help.asana.com/s/article/progress-status-and-connecting-work-to-goals?language=en_US ,
My Tasks https://help.asana.com/s/article/my-tasks ;
ClickUp views https://help.clickup.com/hc/en-us/articles/6329880717719-Intro-to-views ,
goals https://help.clickup.com/hc/en-us/articles/6325733579671-Create-a-Goal ;
Linear display options https://linear.app/docs/display-options ,
custom views https://linear.app/docs/custom-views ,
initiatives https://linear.app/docs/initiatives ;
Fellow organize action items https://help.fellow.ai/en/articles/4495787-organize-action-items ;
Notion views/filters/sorts/groups https://www.notion.com/help/views-filters-and-sorts ,
relations and rollups https://www.notion.com/help/relations-and-rollups ;
Trello filtering https://support.atlassian.com/trello/docs/filtering-for-cards-on-a-board/ .

### Caveats and flagged claims
- Asana subtask max nesting depth ("5 levels") is unconfirmed; Asana's own docs are internally inconsistent. Only "multi-level nesting exists" is certain.
- TickTick's "5-level" subtask figure is vendor-blog-sourced; the help center confirms multilevel tasks without the number.
- Microsoft To Do natural-language date parsing is not documented in official pages (unverified).
- Things collapsible headings not confirmed in official docs.
- Fellow saved-views absence, flat action items, and recurring-meeting auto carry-over are inferred from doc absence; Fellow Objectives is officially marked Legacy.
- Linear natural-language date input is widely reported but not doc-verified in fetched pages.
- "No goal roll-up" for To Do, Things, Todoist, TickTick, Trello is confirmed by absence (no official feature), not a positive statement.
