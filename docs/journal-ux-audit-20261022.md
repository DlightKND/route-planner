# GPS journal UX audit — October 22, 2026

Source: the user-supplied `gps-journal-ux-audit.pdf`, reviewed against main `56b827fe`. Its screenshots and original design references describe the same canonical journal/stop workspace. Existing roles, server approval operations and immutable GPS bounds continue to apply.

| ID | Result and acceptance evidence |
| --- | --- |
| 01 | New proposals start with zero accepted recovery. Numeric entry or the explicit “Учесть … мин восстановления” action accepts time. Saved decisions and user drafts restore their accepted values. GPS 180 minutes plus 0/30/60 minutes gives 6/7/8 person-hours for two people. Unit and browser save/reopen tests cover this. |
| 02 | Restoration is informational. Only pending stops, time conflicts, unmeasured gaps or unavailable tracks retain attention. Each cause has a label; route-only problems open route review. Saving the last stop refreshes review metadata and counters; the browser scenario checks Attention 0 / Reviewed 1. |
| 03 | The closed mobile queue hides the selected trip timeline, keeps period/tabs/search compact, and puts merging under the actions menu. At 360×800 the first card must begin by y=220 and two short records must be visible. Filters and selection remain available. |
| 04 | A persistent decision summary shows request, crew, GPS + accepted recovery and allocation before confirmation. Its controls focus the corresponding field. Desktop can collapse the trip list; duplicate progress is removed; long titles expand on request. Tests cover initial state, field focus and footer clearance. |
| 05 | Mobile route review places mileage composition, problem count and review actions above the map. Detailed source explanations collapse. Desktop retains its map/sidebar composition. The first viewport must contain the review actions at 360 and 390 px. |
| 06 | Stop labels use the place name or a distinct “Остановка N”, followed by address or coordinates; missing places have an honest fallback. Full client/place context remains in details and accessible names. |
| 07 | Confirmed stop text uses the existing per-theme `--green` token. Browser tests require contrast ≥4.5 against normal and selected panels in both themes. |
| 08 | Disabled amber actions use a muted surface, text and border. Existing error messages remain visible and are connected to fields with `aria-describedby`. Browser tests compare enabled/disabled colors and verify recovery after corrections. |
| 09 | Timeline labels are measured at the actual container width and intermediate labels that collide are hidden. Touch layouts offer a 44px stop chooser as well as full stop rows. Resize observers are disposed with the workspace. |

Automated acceptance lives in `tests/visual/journal-ux-audit.spec.mjs`, the existing unified-journal/recovery scenarios and focused core/UI tests. Review screenshots are captured at 360, 390, 768, 1024 and 1440 px in light and dark themes. They use deterministic GPS fixtures and map tiles; they do not establish physical-device keyboard behavior or real GPS accuracy.
