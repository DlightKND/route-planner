# Journal reference alignment — 23 October 2026

Implements the user's 18-item audit against the three attached journal/trip/stop references, preserving the later two-state attendance control and green GPS/orange reconstructed roads.

- Explicit server-saved versus draft decision state; context-bound acknowledgement before confirming zero accepted minutes; no automatic recovery acceptance.
- Trip overview before stop selection, date-aware intervals and Kyiv calendar-day boundaries, disclosure timeline inside the trip.
- Known object names, mileage composition and route-specific filter wording; full-width queue search.
- Compact footer, visible location preview, separate saved decision with evidence, crew and task hours.
- Scale-dependent stop clusters and group choices; no route refit when saving attendance.
- Allocation totals, labelled time shares, preserved cancel/apply draft semantics.
- History retains individual events and hides revision numbers in details; old snapshots do not pretend to identify one changed stop.

No database migration, roles, source intervals, routing provider, server save/revision contract or financial calculation changed. New structured history events remain a separate server enhancement; old events are rendered honestly.

Validation checkpoint: lint and production build passed locally; display helpers and controller tests added/updated. Chromium reference captures and full CI are required before release. Initial local Chromium cannot launch in the restricted process environment; visual verification uses the repository's Chromium Actions runner, never a claimed local browser pass.
