# ORS connection failure — 23 October 2026

## Observed cause

The ORS Edge Function (v11, last updated 28 August) received repeated `ECONNREFUSED` while connecting to `api.openrouteservice.org/v2/directions/driving-car/geojson` at 07:48 UTC. The exception escaped the handler, producing a runtime 500 without the function's CORS headers. Browser clients reported only `Failed to fetch`.

The request builder and trusted proxy destination were unchanged by PR #184. OPTIONS preflight on the configured proxy succeeds. An unauthenticated direct request to ORS from the diagnostic host receives the expected HTTP 401, so this evidence confirms a failure on the Supabase-to-ORS connection; it does not establish a global ORS outage.

## Change

Track the deployed ORS entrypoint in the repository. Catch upstream fetch and response-body failures, retry a transport failure once after 300 ms, and return a readable JSON/CORS 502 if connectivity remains unavailable. Bound each attempt to 30 seconds; a timeout returns 504 without retrying. ORS HTTP responses, including 429, pass through without extra retries. Pin the existing SDK import to the verified resolved version.

The fixed upstream host and three-path allowlist remain in place. User-token forwarding is limited to the staff check, the ORS key stays in the server secret, `is_staff` still gates access and gateway JWT verification remains enabled. No route geometry, optimization, avoidance settings or stored trips are changed.

## Verification

21 tests execute the actual deployed TypeScript entrypoint with mocked network/SDK boundaries, covering CORS, active-staff authorization, endpoint allowlisting, unchanged routing payloads, secret isolation, transient/persistent connection failures, timeout, body-read failure and ORS HTTP status pass-through. The existing 13 trusted-proxy tests also pass.

Live function v12 has been deployed with JWT verification enabled, and its retrieved source matches the tested file. Real successful route computation still requires an authenticated client and working Supabase-to-ORS connectivity; error-handling tests do not prove that external connectivity has recovered.

Follow-up: official ORS endpoint migration, maintenance-page handling and the independent fallback proposal are tracked in [routing-resilience-plan-20261023.md](routing-resilience-plan-20261023.md).
