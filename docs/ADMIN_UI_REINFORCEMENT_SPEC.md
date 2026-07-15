# Admin UI Reinforcement Spec

## Purpose

This document translates the admin UI audit into an implementation-ready reinforcement plan for PromotionSure's admin surface.

It is meant to guide the next build phase without weakening:

- admin publishing workflow rules
- durable admin URLs
- bulk import behavior
- readiness validation
- audit visibility
- admin/candidate boundary rules

This is a reinforcement spec, not a request to clone the reference UI exactly.

## Source Inputs

This spec is based on:

- the current admin route and workspaces in `src/pages/Admin.jsx`
- the admin forms in `src/components/admin/`
- the visual direction in `docs/UI_VISUAL_DIRECTION.md`
- the workflow rules in `docs/ADMIN_CONTENT_MANAGEMENT.md`
- the architecture guidance in `docs/APP_INFORMATION_ARCHITECTURE.md`
- the current shared styling in `src/App.css` and `src/index.css`
- the current admin regression tests in `tests/e2e/admin.spec.js`

## Reference UI: What We Should Actually Borrow

The reference admin works because it feels like a calm operational tool. The key takeaways are:

- stable shell with strong orientation
- consistent drill-down from list to detail to focused edit
- soft but disciplined card rhythm
- compact metrics that clarify health and status
- green used as an authority accent, not decorative saturation
- restrained modals that feel native to the same system
- dense but readable content management views

We should not copy:

- exact layout geometry
- exact icon set
- exact table composition
- exact modal proportions
- exact typography treatment

## Current Admin: What Is Already Strong

The current admin implementation is operationally strong and should be protected during redesign.

### Functional strengths

- `ModuleCatalogue` already behaves like an operational register.
- `ModuleWorkspace` already supports module lifecycle management without exposing raw database mechanics.
- `PracticeSetWorkspace` already has a strong editorial workflow:
  - upload questions
  - add single question
  - validate readiness
  - move draft to review
  - publish
  - archive
- question correction flow is appropriately separated from direct live edits
- audit activity is already available
- durable URLs are already implemented
- Playwright coverage already protects core admin flows

### Product strengths

- admin actions reflect real business rules
- destructive paths are narrow and explicit
- readiness checks are tied closely to publication
- import workflow is preview-first and transaction-safe

These are core assets. The redesign must improve clarity, not replace the workflow model.

## Current Admin: Main Problems To Solve

### 1. The shell is too light for the amount of responsibility it carries

The current topbar-only structure makes the admin feel like a page, not a workspace. Orientation is weaker than it should be once the user drills into modules and sets.

### 2. Visual hierarchy is flatter than the workflow deserves

The admin supports high-stakes content actions, but the UI still often reads like:

- heading
- card
- buttons
- table/list

The reference works better because each screen answers:

- where am I
- what is the state
- what needs attention
- what is the next safe action

### 3. Action emphasis is too even

Too many actions share similar visual weight. On question rows especially, the eye has to work too hard to separate:

- safe inspection
- routine editing
- progression actions
- destructive actions

### 4. Summary signal is underused

The current UI has the right data but does not consistently surface it in the strongest way.

Examples:

- module detail should foreground operational metrics sooner
- set detail should present stage and readiness as one coherent progression block
- activity should support scanning patterns faster

### 5. Styling debt will slow future changes

The admin styles exist in duplicated blocks inside `src/App.css`, including a later override block and older patterns that are no longer fully used.

This is the biggest implementation risk.

### 6. Some richer admin patterns exist in CSS but are not actually used

There are dormant or half-migrated patterns such as:

- metric strip styles
- legacy module card/grid styles
- older preview list styles

This suggests the current UI evolved by override instead of consolidation.

## Reinforcement Goals

### Primary goals

- make the admin feel like one coherent workspace
- strengthen orientation at every route depth
- improve action hierarchy and review confidence
- preserve the existing workflow contract
- reduce styling debt so future changes are safer

### Secondary goals

- improve desktop scanning
- preserve mobile usability
- make state and readiness easier to parse
- reduce visual noise without making the admin feel sparse

### Non-goals

- do not change database behavior
- do not change admin permissions
- do not introduce fake dashboard analytics
- do not merge admin and candidate shells
- do not invent sections with no current product need

## Target Information Architecture

The admin should become a three-layer workspace:

1. Persistent shell
2. Screen-level summary
3. Task-level content area

### Layer 1: Persistent shell

The shell should include:

- left rail for primary admin destinations
- compact top utility bar
- stable content width and scroll rhythm
- consistent page padding and section spacing

Primary rail items for now:

- Content
- Activity

Optional support slot:

- Docs or Help

The shell should not pretend there are sections like Users or Reports unless those are actually implemented.

### Layer 2: Screen-level summary

Each admin route should begin with a stable summary block that answers:

- current entity
- current state
- primary next action
- one-line support context

### Layer 3: Task-level content

This is where tables, set rows, question rows, import preview, and edit forms live.

The task area should be visually subordinate to the screen summary, but denser and more operational.

## Screen-by-Screen Reinforcement Plan

### 1. Content Catalogue

Current route:

- `/admin`

Keep:

- search
- filter chips
- module register layout
- create module action

Reinforce with:

- compact summary strip above filters:
  - total modules
  - needs attention
  - live
  - retired
- stronger section framing between:
  - page title
  - summary strip
  - search/filter controls
  - module register
- more deliberate module row hierarchy:
  - left: title and health note
  - middle: status and content/sales facts
  - right: manage/open action

Visual rule:

The catalogue should remain an operational register, not become a marketing grid.

### 2. Module Detail

Current route:

- `/admin/modules/:moduleId`

Keep:

- breadcrumbs
- status badge
- price visibility
- add practice set
- settings
- usage and access disclosure
- unused module delete path

Reinforce with:

- stronger summary card at top
- four-metric strip directly below hero:
  - practice sets
  - candidate attempts
  - active access
  - published sets
- clearer grouping of:
  - overview
  - practice sets
  - secondary access/usage info
  - danger zone

Practice set rows should look like progression items, not just neutral list entries.

### 3. Practice Set Detail

Current route:

- `/admin/modules/:moduleId/sets/:setId`

Keep:

- lifecycle-aware top actions
- readiness block
- set settings disclosure
- question bank
- empty draft delete state

Reinforce with:

- stage-aware top summary:
  - Draft
  - In review
  - Published
  - Archived
- readiness card that visually connects to the next transition action
- clearer separation between:
  - set progression
  - question management
  - set configuration

Upload and add-question controls should feel like editorial entry points, not generic buttons.

### 4. Question Bank

Keep:

- filters
- preview
- correction flow
- remove/discard rules
- show-more pagination

Reinforce with:

- more structured row anatomy:
  - position
  - state metadata
  - question text
  - answer summary
  - action cluster
- clearer distinction between published rows and correction rows
- action grouping by risk:
  - inspect
  - edit/correct
  - publish correction
  - destructive text action

Preview should stay easy to reach because it is the safest confidence-building action.

### 5. Module Create/Edit Modal

Keep:

- same fields
- same validation logic
- advanced disclosure
- sticky action footer

Reinforce with:

- more deliberate header and helper copy
- stronger section dividers
- lighter visual density for advanced fields
- more explicit pricing and sales state treatment

### 6. Question Editor

Keep:

- focused editor replacement view
- correction safety note
- answer option selector
- advanced metadata disclosure

Reinforce with:

- more editorial composition
- stronger content-first order
- compact metadata band
- clearer difference between:
  - new question
  - edit question
  - correction

### 7. Import Panel

Keep:

- template download
- browser validation
- preview before import
- transaction-safe final import

Reinforce with:

- stronger step framing:
  - choose file
  - review issues
  - inspect preview
  - commit import
- cleaner preview table styling
- more obvious blocked vs ready state

### 8. Activity View

Current route:

- `/admin/activity`

Keep:

- search
- actor/time/action/entity/details model
- expandable metadata

Reinforce with:

- denser operational scan pattern
- stronger log action chips
- clearer time/actor alignment
- more readable expanded metadata cards

The goal is faster scanning, not decorative styling.

## Visual System Rules For The Admin

### Tone

The admin should feel:

- official
- calm
- precise
- operational
- trustworthy

It should not feel:

- startup-analytics heavy
- salesy
- playful
- decorative

### Layout rules

- use a steady content width
- maintain a consistent top summary rhythm
- reserve stronger visual emphasis for state and progression
- use cards and tables intentionally, not everywhere at once

### Color rules

- keep the existing green, cream, white, ink system
- use green for next-safe action and positive state
- use amber for review or caution states
- use red only for destructive or critical warning states
- keep most surfaces neutral

### Typography rules

- keep `Public Sans`
- slightly tighten admin headings
- reduce oversized hero feeling in authenticated admin routes
- use compact uppercase labels sparingly for metadata and state

### Component density rules

- catalogue and activity may be denser than candidate screens
- question editor and modals should be calmer and more spacious
- mobile should stack cleanly without becoming giant-card-heavy

## Design Tokens And CSS Structure Plan

### Immediate cleanup rule

Before major visual reinforcement, admin styles should be isolated from the large shared `src/App.css` tangle.

### Recommended structure

- keep shared global tokens in `src/index.css`
- keep shared generic app styles in `src/App.css`
- move admin-specific styles into one dedicated file, for example:
  - `src/styles/admin.css`

### Admin token groups to formalize

- layout widths
- section gaps
- table row heights
- card radii
- badge sizing
- modal widths
- action button tiers
- admin shadows
- state color pairings

### Cleanup tasks

- remove duplicate admin style blocks
- remove unused admin patterns if not adopted
- rename any ambiguous admin classes only if needed for clarity
- keep class names stable where tests rely on them unless selectors are updated together

## Recommended Component Refactor Plan

The current `src/pages/Admin.jsx` is doing too much. The reinforcement work should include splitting the page into route-level workspace components.

### Proposed component map

- `AdminShell`
- `AdminRail`
- `AdminHeader`
- `AdminSummaryStrip`
- `AdminModuleCatalogue`
- `AdminModuleRow`
- `AdminModuleOverview`
- `AdminMetricStrip`
- `AdminPracticeSetList`
- `AdminPracticeSetRow`
- `AdminReadinessCard`
- `AdminQuestionBank`
- `AdminQuestionRow`
- `AdminActivityList`

### Existing components to keep and refine

- `AdminModuleForm`
- `AdminQuestionForm`
- `AdminImportPanel`
- `AdminConfirmDialog`

### State logic guidance

Keep the current data and mutation logic local until visual reinforcement is stable. Do not combine a visual redesign with a large state-management rewrite in the same pass.

## File-Level Build Plan

### Phase 1: Safe foundation

- create `docs/ADMIN_UI_REINFORCEMENT_SPEC.md`
- extract admin CSS to a dedicated file
- remove duplicate admin style blocks from `src/App.css`
- verify no visual regression in current admin flows

### Phase 2: Shell and catalogue

- introduce `AdminShell` layout
- add left rail and utility header
- redesign content catalogue summary and register spacing
- keep route behavior unchanged

### Phase 3: Module and set detail

- add module metric strip
- rebuild practice-set row presentation
- strengthen set overview and readiness treatment

### Phase 4: Question workspace

- redesign question bank rows
- tighten action hierarchy
- polish question preview and editor layout
- refine import panel steps and preview table

### Phase 5: Activity and finishing pass

- redesign activity scan pattern
- verify mobile breakpoints
- clean accessibility labels if structure changed
- update tests and snapshots as needed

## Acceptance Criteria

The redesign should be considered successful when:

- the admin feels like a stable workspace rather than a loose page collection
- every route has clearer orientation and stronger next-action hierarchy
- the content catalogue remains operational and scan-friendly
- readiness and publication flow are easier to understand at a glance
- destructive actions are visually de-emphasized relative to safe actions
- no workflow behavior is weakened
- mobile remains usable and free of horizontal overflow
- admin styling is no longer duplicated in large override blocks

## Testing Plan

### Must keep passing

- admin create/delete unused content flow
- admin import/review/publish flow
- admin accessibility smoke test
- breakpoint layout tests
- durable URL test
- admin isolation from candidate experience

### Additional checks to add during redesign

- rail navigation active-state behavior
- module metric strip visibility and responsive stacking
- readiness card state visibility for ready and blocked cases
- question row action grouping at mobile widths
- modal layout and footer actions at mobile widths

## Key Risks

### Risk 1: visual redesign accidentally changes workflow semantics

Mitigation:

- keep business logic and RPC interactions untouched during UI refactor

### Risk 2: CSS cleanup breaks unrelated candidate screens

Mitigation:

- isolate admin styles first
- avoid broad selector changes in shared files

### Risk 3: desktop improvement harms mobile density

Mitigation:

- keep mobile-first breakpoints explicit
- test catalogue, module, set, and modal views on narrow widths throughout

### Risk 4: component splitting changes behavior under route transitions

Mitigation:

- refactor incrementally
- keep route contract and navigation paths unchanged

## Build Order Recommendation

Use this exact order:

1. isolate and clean admin styling
2. introduce admin shell
3. redesign content catalogue
4. redesign module detail
5. redesign practice-set detail and readiness treatment
6. redesign question bank and import panel
7. redesign activity
8. run full regression and polish

## Bottom Line

The current admin already has the right workflow model. The work now is to give it the visual structure, hierarchy, and maintainability that match its product importance.

The admin should emerge from this effort as:

- a calm operations workspace
- a clearer editorial tool
- a safer publishing surface
- a more maintainable UI system

That is the target for the next implementation phase.
