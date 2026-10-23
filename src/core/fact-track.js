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

export function normalizedTrack(row) {
 const data=row?.data||row;
 return data?{points:[],dropped:[],segments:[],...data,at:data.at||row.updated_at,stored:true}:null;
}

// A retained, reviewed track must remain readable after raw GPS retention expires.
export async function resolveFactTrack({trip, cached, readStored, readPositions, measure, measureTail=measure}) {
  const stored=cached||await readStored();
  const retained=stored&&(stored.segments?.length||stored.points?.length);
  if(trip?.status!=='in_progress'&&retained)return {measure:stored,raw:[]};
  const raw=(await readPositions()).filter(p=>p.lat!=null&&p.lng!=null);
  if(!raw.length)return retained?{measure:stored,raw:[]}:null;
  if(retained&&trip?.status==='in_progress'){
    const cutoff=Date.parse(stored.presence?.source_to||stored.segments?.at(-1)?.toTs);
    if(Number.isFinite(cutoff)){
      const tail=raw.filter(p=>Date.parse(p.ts)>cutoff);
      if(!tail.length)return {measure:stored,raw};
      // The snapshot keeps every reviewed road. Only new telemetry is measured
      // without planned start/finish anchors or a second routing request.
      const anchor=raw.filter(p=>Date.parse(p.ts)<=cutoff).at(-1);
      const extra=await measureTail(anchor?[anchor,...tail]:tail);
      const joined={...stored,segments:[...(stored.segments||[]),...(extra.segments||[])],
        points:[...(stored.points||[]),...(extra.points||[])],
        dropped:[...(stored.dropped||[]),...(extra.dropped||[])],preview:true};
      for(const key of ['km','trackKm','roadKm','lineKm','jitterKm'])joined[key]=(Number(stored[key])||0)+(Number(extra[key])||0);
      return {measure:joined,raw};
    }
  }
  return {measure:{...await measure(raw),preview:true},raw};
}
