// A retained, reviewed track must remain readable after raw GPS retention expires.
export async function resolveFactTrack({trip, cached, readStored, readPositions, measure}) {
  if (trip?.status !== 'in_progress') {
    const stored = cached || await readStored();
    if (stored && (stored.segments?.length || stored.points?.length)) return {measure:stored, raw:[]};
  }
  const raw = (await readPositions()).filter(p=>p.lat!=null&&p.lng!=null);
  if (!raw.length) return null;
  return {measure:await measure(raw), raw};
}
