# Supabase deployment

The trash purge uses an Edge Function because deleting rows from
`storage.objects` in SQL does not delete the underlying files.

Deploy it with one random shared secret stored in both Edge Functions and
Vault (never commit the value):

```bash
SECRET="$(openssl rand -base64 36)"
supabase secrets set TRASH_PURGE_SECRET="$SECRET" \
  --project-ref anqfbljgfimoaziztdxe
supabase functions deploy trash-purge --project-ref anqfbljgfimoaziztdxe
```

Store `$SECRET` in Vault as `trash_purge_secret`, then apply
`migrations/20260910100000_job_trip_trash.sql`. The migration schedules the
function daily at 03:10 UTC. A manual call without the shared header is denied.
