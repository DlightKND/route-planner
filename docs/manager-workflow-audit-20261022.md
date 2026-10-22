# Manager workflow audit — 22 October 2026

Source: `manager-workflow-ux-audit.pdf`, findings M1–M7, against main `ab8f1e1a`.

| Finding | Change | Regression evidence |
| --- | --- | --- |
| M1 — request edits outside delegated listener | Deadline/note and request context dialogs have explicit Save and Cancel, pending/error state and retry. Serialization reads committed values until explicit save. | Native-dialog tests; real-app browser save/reopen for deadline, note, status and team. |
| M2 — canceled values leak to later saves | Snapshot and restore values, selected options, dependent select options, checkbox state and local request flags on any uncommitted close. | Cancel all four fields, then save another field; canceled changes must not reach RPC. |
| M3 — manager cannot change active task planning | Separate planning-only RPC and date/team editor in draft, assigned, in progress, paused and review. Require reason, revision and existing manager authority. Record history under lock. | Real SQL PGlite tests across five stages, permissions, stale versions and invalid data; role-based UI and browser tests. |
| M4 — transfer precedes draft resolution | Save/discard/continue choice runs before assignment. Saved task reload supplies latest revision. Failed assignment explicitly distinguishes a saved plan or local result draft. | Preflight cancellation, save ordering, fresh expected revision, handoff failure. |
| M5 — manager rescheduling sends a request | Manager action opens the actual plan editor. Save Plan performs existing plan validation/save. Engineer action remains an explicitly named request. | Browser test asserts manager plan RPC, engineer request RPC and unchanged unrelated dates. |
| M6 — routine actions buried in menu | Inline deadline/team actions, visible active Pause/Review, contextual Resume/Return labels, visible trip date action. Rare actions remain in menu. | DOM tests, PC/mobile screenshots and browser workflows. |
| M7 — mobile hierarchy and missing date context | Request summary then tasks; client reference collapses on mobile. Task cards include period. Task summary shows period/team/request SLA before briefing, including a new task. | New-task SLA and request hierarchy tests; date-warning unit test; responsive screenshots. |

## Contracts preserved

- Request SLA, task period and trip dates remain separate. Warnings explain inconsistencies; no automatic propagation.
- The planning-only RPC changes only dates, planned team, lead and revision. It never rewrites scope, recorded quantities, accepted presence, request SLA or trip crew.
- Authorization uses the existing active global administrator/logistician or entity owner/curator rule. An ordinary assigned engineer proposes a deadline; assignment alone never grants manager planning rights.
- Completed/canceled task planning is read-only. Five working stages support explicit manager changes.
- Results remain a separately submitted workflow. “Save and continue” stores an unsubmitted result as a local browser draft and says so explicitly.
- No production customer records are used for write tests. Database fixtures and browser backend writes are isolated.

## Validation

Run `npm run lint`, `npm test`, `npm run test:tz`, `npm run smoke` and the Playwright manager workflow matrix. Inspect both themes and small phone widths. The CI job stores each significant manager workflow screenshot; the broad existing matrix checks other roles and screens.

Deployment requires applying `20261022110733_manager_task_organization.sql` before publishing the UI. Verify private-definer/public-invoker security, execute privileges and advisors after migration.
