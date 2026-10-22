# Long-trip journal loading: 22 October 2026

## Confirmed costs

Read-only production diagnostics found trips with 23–29 stops, 1,624–2,210 track segments and 77–108 revisions. Their most recent history snapshots occupied 3.7–5.8 MB as JSON; the track itself occupied about 0.6 MB. Opening the stop review previously transferred all of this history before displaying any stop.

The timeline filtered every source interval at every boundary and repeatedly parsed the same timestamps. On the timing-only interval data from a four-day trip (no coordinates or customer details retained in the repository), the original timeline calculation took 1,377 ms and the replacement took 7 ms, returning identical 1,668 intervals. A separate synthetic input with 1,624 segments, 1,548 motion intervals and 23 stops reduced complete timeline HTML generation from 3,672 ms to about 28 ms. These are local computation measurements, not end-to-end phone loading times.

The reviewed API logs also contained slow responses: the largest observed origin times were 10.1 seconds for track reads, 3.0 seconds for the workbench RPC and 3.9 seconds for allocation reads. These maxima are across requests in the log window and must not be added as if they belong to one opening. They do not establish the entire cause of a reported 60-second wait.

## Changes

- A lightweight journal snapshot omits revision history entirely, including its database query. Its privileged reader stays in the private schema and retains exactly the existing workbench responsibility gate. The public RPC is an invoker wrapper. Existing full workbench RPC and RLS reader fallback remain available.
- The Documents pane loads history only on demand; retries and stale-view guards do not replace the stop draft.
- Interval sweep replaces repeated whole-track scans. Identical adjacent visual spans merge before HTML generation. A reusable Kyiv time formatter avoids thousands of formatter constructions.
- GPS segments share one Leaflet multi-polyline layer; disconnected segments stay disconnected. Non-GPS issues retain individual selection. A hidden overview does not initialize its map.
- Clicking an already mounted trip reuses its detail. Explicit list refresh still reloads fresh data.
- Jobs and task allocations load in parallel; allocation IDs use batches of 100.
- Selected-stop calculations read only the selected form. Draft capture visits only modified stops.

## Validation

Regression coverage checks interval equivalence and precedence, linear timestamp parsing on 5,000 intervals, confidence/gap boundaries, lazy history, compatibility fallback, selected-trip reuse, role boundaries and independent recovery decisions. The database test removes the history table before calling the lightweight reader, proving opening does not depend on history access. The browser scenario uses 29 stops, 2,200 segments and 100 bulky revisions and checks bounded timeline DOM, on-demand history and a single GPS layer.

Remaining latency depends on network transfer of the track, current backend response time and device speed. No claim of a specific end-to-end loading time is made without measurement on the affected device.
