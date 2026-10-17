// The same reviewed result supplies the map and financial mileage.
export function validatedTrackFact(m) {
  if (!m || !Number.isFinite(m.km) || m.km < 0 || !m.verdict
      || m.verdict.startsWith('трек недостоверен')) return null;
  const note=[];
  if(m.dropped?.length) note.push('вырезано аномалий: '+m.dropped.length
    +' из '+(m.dropped.length+(m.points?.length||0))+' точек');
  if(m.roadKm) note.push('по дорогам: '+Math.round(m.roadKm)+' км');
  if(m.lineKm) note.push('прямыми, маршрут не строился: '+Math.round(m.lineKm)+' км');
  if(m.jitterKm>=0.5) note.push('дрожание на стоянке: '+m.jitterKm.toFixed(1)+' км');
  return {km:Math.round(m.km*10)/10,source:'track',note:note.join('; ')};
}

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
