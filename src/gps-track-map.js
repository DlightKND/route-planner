// Keep disconnected GPS parts separate in both the fallback and the map.
export function gpsSegments(points){
 const segments=[];let line=[],previous=null;
 for(const p of points){
  if(p.lat==null||p.lng==null||!Number.isFinite(+p.lat)||!Number.isFinite(+p.lng)||Math.abs(+p.lat)>90||Math.abs(+p.lng)>180){if(line.length)segments.push(line);line=[];previous=null;continue;}
  if(previous&&(p.part!==previous.part||new Date(p.ts)-new Date(previous.ts)>300000)){if(line.length)segments.push(line);line=[];}
  line.push(p);previous=p;
 }
 if(line.length)segments.push(line);return segments;
}

export function mountGpsTrackMap(fallback,points,{leaflet:L,makeBase,color}){
 const segments=gpsSegments(points);if(!fallback||!L||!segments.length)return null;
 const container=document.createElement('div');container.className='unassigned-preview unassigned-map';
 container.setAttribute('role','region');container.setAttribute('aria-label','Карта GPS-трека');container.tabIndex=0;
 fallback.replaceWith(container);let map,observer;
 try{
  map=L.map(container,{scrollWheelZoom:false});
  const base=makeBase();if(!base)throw Error('Нет картографической подложки');base.addTo(map);
  const layers=segments.map(segment=>{
   const coords=segment.map(p=>[+p.lat,+p.lng]);
   return (coords.length>1?L.polyline(coords,{color,weight:3,opacity:1,className:'gps-track-line'}):L.circleMarker(coords[0],{color,radius:4,className:'gps-track-point'})).addTo(map);
  });
  const first=segments[0][0],last=segments.at(-1).at(-1);
  for(const [p,label,fill] of [[first,'Начало трека','#25845a'],[last,'Конец трека','#c34e3c']]){
   L.circleMarker([+p.lat,+p.lng],{radius:5,color:'#fff',weight:2,fillColor:fill,fillOpacity:1}).addTo(map).bindTooltip(label);
  }
  map.fitBounds(L.featureGroup(layers).getBounds(),{padding:[24,24],maxZoom:16});
  if(typeof ResizeObserver!=='undefined'){observer=new ResizeObserver(()=>map.invalidateSize({pan:false}));observer.observe(container);}
  return {container,destroy(){observer?.disconnect();map.remove();}};
 }catch(error){observer?.disconnect();map?.remove();container.replaceWith(fallback);return null;}
}
