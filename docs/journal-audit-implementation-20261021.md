# Canonical GPS journal — implementation checkpoint

Base: 4f0d985. User authorized implementation of all 30 audit findings and publication. Work is in feat/journal-audit-implementation. No subagents authorized.

One record/stop workspace replaces the presence tab editor, map editor and old stays overlay. Trip cards retain a summary and canonical deep link. Existing role/ownership checks and server operations remain. Authorized table reads may support reader roles; never grant a broader queue or telemetry access.

Order: shared source/type/draft model; precise timeline and route map; responsive stop form and saved/invalid/later states; canonical trip and orphan shells; all app entry points and URL state; compact list/metadata/filtering; tests and visual comparison; PR/merge/deploy and asset verification.

Record evidence against A01–A30 before completion. Do not claim completion while separate editors or desktop/mobile composition gaps remain.

Implementation checkpoint, PR #181 (first CI head 95861e8):
- A01/A02/A04: trip presence tab and native editor replaced by canonical route; scoped reader fallback uses existing RLS; legacy attachment and object pin operations retained, approval uses one revision-save path.
- A05/A18: record/stop/pane routes, same mounted draft on Back, sessionStorage drafts scoped to user/trip/source signature; explicit draft save differs from attendance confirmation.
- A03/A25/A26: orphan overview/route/documents shell, explicit link requirement; all lightweight monthly metadata loaded before dedup/filter/display pagination; independent attention and document state.
- A06–A15/A17/A29: wide master/detail desktop, sequential tablet/mobile, semantic sections, native stop-type control, source evidence, inline desktop allocation and mobile draft editor, saved decision, field errors and fixed footer above actual #nav.rail.
- A16/A19–A24/A27/A28: exclusion distinct from road; exact GPS/recovery intervals; numbered markers, selected timeline/route issues, symbolic hypothesis ring, conflict context, rebuild progress/result retains pane, shared history renderer.
- A30: meaningful unit tests and full CI build passed on first head. First visual pass exposed direct-link mobile navigation and overly tall header/map composition; follow-up corrects these and adds reload/draft/hypothesis/exclusion scenarios. Still awaiting second browser pass and screenshot inspection. Publication is not complete.


Visual checkpoint (160834b): review-workflows 60/60, design-review 104/104 and operations-smoke 48/48 passed. Screenshots inspected for mobile light stop/allocations, desktop expanded map and dark exclusion; no rail overlap. Full five-width, two-theme matrix still running.

Final follow-up adds canonical orphan-record URLs, a source-loading race regression, explicitly saved session-draft regression, compact source fingerprints, URL-safe metadata batches, collocated-stop map choices, and truthful excluded-decision summaries. It preserves server RPCs, RLS and calculations. These additions require one final CI pass before merge/deployment.
