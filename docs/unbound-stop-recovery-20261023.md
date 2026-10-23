# Restore the existing gap-minus-road stop proposals

The rebuild operation already subtracts routed travel time from telemetry gaps, protects regularly observed GPS time, and leaves recovered time for manager approval. It mistakenly required a linked request object as the proposal's location, even when GPS explicitly recorded an idle fix before the gap. Trips therefore retained reconstructed road geometry while omitting the corresponding stop proposal.

## Changes

- A corroborated idle fix followed by a GPS gap can anchor an unassigned stop. The existing cached road response supplies travel time; reconstruction subtracts that time and proposes the remaining interval at the idle location.
- The stop starts unconfirmed, with no request and zero locked GPS minutes. It does not accrue attendance. The manager chooses a request and crew and may accept only the needed recovered minutes, using the existing confirmation flow.
- The reconstructed road occupies only its estimated travel interval, after the proposed stop, rather than the entire GPS gap. Mileage and road geometry still come from the same routing response.
- The global ORS call budget remains unchanged. An idle origin avoids irrelevant route queries via unrelated request objects and reuses the route already obtained for mileage validation.
- The server accepts an unassigned proposal only when an actual idle message, its location, consecutive gap endpoints, corroborating samples, editable recovery bounds, and the matching road interval are present. Invented locations, locked GPS time and inflated recovered intervals are rejected.
- Stop status participates in the GPS source digest. A status change during reconstruction invalidates the captured source just like a changed coordinate.
- Older open clients must refresh before rebuilding a trip that contains these proposals, so their older algorithm cannot withdraw restored or approved stops.
- Existing request-based recovery, scope checks, guarded revisions, protected GPS and explicit odometer behavior remain intact.

## Verification and production case

Unit/database/browser tests cover unassigned proposals, road-cache reuse at the call limit, matching recovery and travel intervals, manual acceptance, repeated saves and forged origins.

For the reported 20–23 October trip, replay of already-saved road responses yields six additional eligible proposals, including 21 October 16:24 (107.647 recovered minutes) and 22 October 11:22 (126.228 recovered minutes). These are estimates for review, not confirmed attendance. The short 20 October 16:24 gap leaves less than the configured ten-minute minimum after travel and should not create a long-stop proposal.
