# Unified GPS journal and presence review

The journal combines started trips and unassigned GPS records. Linked source records are deduplicated against loaded trips. Existing unassigned-track creation, linking, charge confirmation/cancellation and source merge operations remain unchanged. The admin/logist journal scope is retained; engineer review screens keep their existing read-only permissions. No schema or RLS changes are required.

Trip selection reads the existing `trip_workbench_read`, retained track, task links and stay allocations. Decisions use `trip_presence_save_tasks` with the workbench revision. Rebuild uses the existing source-digest/revision operation. Only the selected stop is submitted. Other pending stops do not prevent saving it. Rejected en-route stops need no request or crew.

Review retains original interval boundaries and native field nodes. GPS evidence is immutable; each recovery part is bounded independently. Task distribution opens one editor and applies to the draft without confirming the visit. Cancel restores the original draft. Review counts come from stored decisions, not draft choices.

Mileage differentiates measured GPS, road estimates and unknown/straight-line gaps. Unknown estimates are excluded from the GPS/road subtotal. Activity separates movement, stops and unknown time; recovery is a separate overlay. Accepted presence overlapping known motion is reported for review and cannot be confirmed from the journal.

Desktop uses trip list, stop list and editor where space permits. Intermediate widths use sequential stop navigation. Phones use list, trip and stop states; period and search controls are collapsed by default. Warm theme tokens, the native rail, flat selection and existing role checks remain in use.

Validation covers deduplication, unknown mileage exclusion, recovery boundaries, route/presence conflicts, allocation drafts, independent en-route saving, reader permissions and browser scenarios across five widths and both themes.
