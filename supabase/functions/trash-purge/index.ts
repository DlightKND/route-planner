import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8' },
});

Deno.serve(async (req) => {
  if (req.headers.get('x-trash-secret') !== Deno.env.get('TRASH_PURGE_SECRET')) {
    return json({ error: 'forbidden' }, 403);
  }
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key) return json({ error: 'Supabase environment is missing' }, 500);

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const cutoff = new Date(Date.now() - 7 * 86400000).toISOString();
  const { data: photos, error: photoError } = await supabase
    .from('job_photos')
    .select('path,jobs!inner(deleted_at)')
    .lte('jobs.deleted_at', cutoff);
  if (photoError) return json({ error: photoError.message }, 500);

  const paths = (photos || []).map((row) => row.path).filter(Boolean);
  for (let i = 0; i < paths.length; i += 100) {
    const { error } = await supabase.storage.from('job-photos').remove(paths.slice(i, i + 100));
    if (error) return json({ error: error.message, removed: i }, 500);
  }
  const { data, error } = await supabase.rpc('trash_purge_due');
  if (error) return json({ error: error.message, filesRemoved: paths.length }, 500);
  return json({ ...data, filesRemoved: paths.length, cutoff });
});
