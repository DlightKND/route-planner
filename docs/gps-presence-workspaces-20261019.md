# GPS journal and presence review workspaces

Implementation branch: feat/gps-presence-review-workspaces. Review: https://github.com/DlightKND/route-planner/pull/178.

The journal uses a filtered chronological list and a selected GPS route pane. Search, vehicle selection, gap filtering, explicit merge selection, independent desktop scrolling, and a mobile list/detail navigation are implemented. Only managers load telemetry and resolution controls; engineers retain access to their own recorded charges. Existing RPCs, optimistic revision checks, rates, period intersection rules, and merge eligibility are retained. GPS forms appear in the selected pane on desktop and as a modal on mobile.

Presence uses a stop queue and a selected review pane. Existing field nodes and GPS recovery constraints are retained. Each save submits only the selected stop. En-route decisions use the existing rejected/nonattendance result with an explicit history reason; there is no new database classification or change to economic rules. Unknown stops can remain pending. Recovered intervals are editable within their bounds, observed GPS is immutable, invalid totals and allocation shares block confirmation. Drafts remain in the current session, partitioned by user/trip/stay and invalidated if source data changes. Read-only roles have no decision controls.

Upstream main 3419e857988d6c3e79446d5af65762c0e5b4c0ac and its presence maps were merged. No schema migrations.

Validation: production build, ESLint, full unit suite and full America/Los_Angeles time-zone suite passed on the first PR revision. Browser regression checks cover both themes, desktop/tablet/mobile, role permissions, recovery and resolution flows. Visual checks identified mobile list navigation and desktop inline form footer issues; these are corrected in the follow-up revision. Final CI results and screenshots are recorded on PR #178.

Release: repository upload, PR and publication were explicitly authorized by the user. Merge with a [deploy] commit only after passing checks and visual inspection. No schema migrations or changes to economic rules.
