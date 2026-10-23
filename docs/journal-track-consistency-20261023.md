# Track consistency and attendance control — 23 October 2026

## Diagnosis

- The trip journal read only `trip_tracks`. Unlike the main map, it had no GPS preview when a review had never been saved.
- Both explicit rebuild entry points already called `measureTripKm`, but their surrounding save/refresh handling was duplicated. The journal did not implement a separate reconstruction algorithm.
- `makeReach` converted ORS authentication, quota, network and maintenance failures into `null`. The calculation could then save a GPS-only/straight-line result and report success, replacing previously reconstructed roads.
- The main map discarded saved reconstruction for active trips and on live GPS refresh, rebuilding without ORS. Merely refreshing could remove the reconstructed roads from the display.
- Main-map road lines were solid purple, unlike dashed orange journal roads.

Read-only production checks confirmed that saved reviews do contain road segments (including the latest finished trip). No production trip was recalculated or modified during diagnosis. No authenticated browser session was available; visual regression checks use the synthetic backend.

## Result

- One compact, outlined segmented attendance control. Dark active segment in light theme; inverse contrast in dark theme; 44 px minimum touch targets. Two states and existing save/permission semantics are preserved.
- Both maps call the same track resolver. Retained reviews require no raw GPS read on completed trips; absent reviews receive an explicitly labelled read-only GPS preview, without ORS or financial/attendance writes.
- Active trips retain reviewed roads and append only new GPS telemetry, without re-routing or changing saved mileage. New telemetry remains a preview until explicit validation.
- Both explicit buttons use `recalculateFactTrack`: fresh source snapshot, validation/reconstruction, guarded durable save, scoped attendance totals and completed-trip economics. Explicit odometer replacement remains a deliberate trip-card operation; journal rebuilding preserves an odometer fact.
- ORS infrastructure failures, missing configuration and malformed replies abort before saving. Previous geometry and mileage remain intact. Actual “no route” replies remain evidence for GPS validation; they are not conflated with infrastructure failures.
- Shared map line styles: measured GPS green; reconstructed road orange `#d87619` dashed `7 6`; unknown gap gray `#8b8e96` dashed `7 6`; width 4. Main-map measured GPS retains its five-step green speed ramp.
- Attendance decisions continue to update the selected stop locally without reloading track geometry.

## Verification

Regression coverage includes persisted review without raw GPS, absent-review preview, active-trip reconstruction plus live tail, shared save entry points, ORS errors/no-route distinction and unchanged evidence/permission rules. Browser scenarios check initial preview, reconstruction geometry and reload, failure without writes, main-map line styles, and compact attendance control at desktop/mobile widths in both themes.
