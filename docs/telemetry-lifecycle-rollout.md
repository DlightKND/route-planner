# Telemetry lifecycle: decision engine, not yet activated

The pure reducer in `src/core/trip-lifecycle.js` is the first implementation of the next lifecycle stage. It is intentionally not imported by the application and does not replace production RPCs or triggers. It emits proposed events; only a future transactional server adapter may apply them.

## Contract

- Each stream is one vehicle, one fixed depot and one journey. The caller must retain raw observations independently of reducer state.
- Policy is explicit and depot-specific: entry radius, exit margin, departure dwell, return dwell, maximum message gap. No production defaults are inferred.
- The adapter supplies all eligible trip IDs, accounting for schedule and competing active trips. Membership is captured at departure and must remain a single unchanged candidate throughout confirmation.
- A first observation outside the depot cannot establish a departure. A gap before departure requires a new observed inside position. Missing or conflicting evidence produces review events.
- A confirmed start uses the first observed outside time. A confirmed return uses the first observed inside time, not the later confirmation time. Movement out of the entry radius during return dwell cancels the candidate and continues the same journey.
- Gaps break continuous-presence proof. No timer or planned date can produce a finish without fresh positions. Invalid positions cannot advance a transition.
- Engineer buttons emit signals only. They never create/delete the measured start, end, GPS or presence.
- Repeated timestamps do not repeat lifecycle transitions. Late packets remain available to the future review/replay adapter but never rewind live state.
- Ambiguous/unassigned departure is sticky until manager resolution; a later plan edit cannot silently bind old observations.

## Validation on 2026-09-22

17 deterministic tests cover departure, return, repeated exit, gaps, invalid packets, late/duplicate timestamps, assignment changes including temporary ambiguity, button signals and immutable inputs.

A read-only production sample contains 965 buffered positions across two sessions (484 and 481). Identifiers and coordinates were removed before replay; only relative milliseconds and distance to each session's fixed reference depot were used. Under existing global 5,000 m / 300 m / 60 minute departure settings, both streams start outside and contain no inside sample. There are 23 gaps over five minutes (11 and 12); longest gap is 63,553 seconds. Replay correctly emits review/gap events and proposes neither a start nor a finish. The 60 minute return dwell used for this experiment is a test policy, not an approved production setting. These samples cannot calibrate entry/exit boundaries or prove automatic completion.

## Remaining integration

1. Correct/verify depot reference coordinates and collect anonymized complete inside → outside → inside sequences. Validate individual depot policies against them.
2. Persist raw observations and append-only event IDs transactionally. Define bounded retention for unresolved sessions independently of trip deletion.
3. Add the server adapter with row locks, monotonic revision checks, duplicate-event keys, manager-only resolution of ambiguity and preserved observation bindings. Start in shadow mode.
4. Replace nearest-trip guessing and age-based `trips_autoclose_stale`; replace cancel/reassign semantics only after immutable sessions are in place. The old production behavior remains until that migration is tested and applied.
5. Connect buttons as signals and display unresolved cases to managers.
6. Implement final atomic approval of kilometres, attendance, performed scope, frozen rates/economics and odometer deltas, including idempotent retry and revision correction.

Do not call this reducer alone complete automatic trip accounting.

## Published foundation

PR #53 and release #54 are merged. The live site build stamp is `dc190d6`; successful Pages run: https://github.com/DlightKND/route-planner/actions/runs/35693254871.

Production migration history uses MCP-generated versions:

| Repository migration | Applied version | Name |
| --- | --- | --- |
| 20260921133835 | 20260922060059 | trip_workbench |
| 20260921191539 | 20260922060112 | trip_access_guards |

Do not blindly run `db push` against the differing timestamps. Compare definitions/history first. Both migrations were checked against the full reconstructed public application schema in PGlite (30 tables, 22 triggers, 67 RLS policies), with exact auth helper functions and a stub auth.users table. This was not a full hosted Supabase/Auth/PostgREST staging stack. Production workbench reads and settings read-only grants were verified separately.
