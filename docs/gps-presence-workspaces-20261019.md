# GPS journal and presence review workspaces

Implementation branch: feat/gps-presence-review-workspaces. Production has not changed.

The journal uses a filtered chronological list and a selected GPS route pane. Search, vehicle selection, gap filtering, explicit merge selection, independent desktop scrolling, and a mobile list/detail navigation are implemented. Only managers load telemetry and resolution controls; engineers retain access to their own recorded charges. Existing RPCs, optimistic revision checks, rates, period intersection rules, and merge eligibility are retained. GPS forms appear in the selected pane on desktop and as a modal on mobile.

Presence uses a stop queue and a selected review pane. Existing field nodes and GPS recovery constraints are retained. Each save submits only the selected stop. En-route decisions use the existing rejected/nonattendance result with an explicit history reason; there is no new database classification or change to economic rules. Unknown stops can remain pending. Recovered intervals are editable within their bounds, observed GPS is immutable, invalid totals and allocation shares block confirmation. Drafts remain in the current session, partitioned by user/trip/stay and invalidated if source data changes. Read-only roles have no decision controls.

Upstream main 3419e857988d6c3e79446d5af65762c0e5b4c0ac and its presence maps were merged. No schema migrations.

Validation: Vite production build and ESLint passed. Focused unit assertions passed in the output, but full suite completion and time-zone suite must still be verified. Browser tests were updated for the new structure. Local Chromium installs but terminates with SIGTRAP before page creation; cloud browser file URLs are blocked. No successful visual test run or screenshots of this implementation are claimed.

Release blocker: git push was rejected by automatic approval review, citing insufficient explicit permission for publishing code to DlightKND/route-planner. Do not bypass via GitHub API. The connected GitHub profile and repository metadata confirmed matching owner ID 289937498 and admin/push access. Ask for explicit permission for this repository before retrying push, opening PR, and CI. Main/deploy must wait for passing checks and visual inspection.

Next: run updated focused tests and all unit checks; fix discovered UI/state regressions; after explicit destination approval push branch and open PR, inspect CI screenshots in desktop/mobile and both themes, complete corrections, then merge/release with [deploy] and verify production bundle.
