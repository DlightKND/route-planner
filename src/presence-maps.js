import {mountGpsTrackMap} from './gps-track-map.js';
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const coordinates=stay=>stay.lat!=null&&stay.lng!=null&&String(stay.lat).trim()!==''&&String(stay.lng).trim()!==''&&Number.isFinite(+stay.lat)&&Number.isFinite(+stay.lng)&&Math.abs(+stay.lat)<=90&&Math.abs(+stay.lng)<=180;

export function presenceLocationHTML(stay,index,tripId){
 if(!coordinates(stay))return '<p class="hint presence-location-missing">Координаты стоянки не записаны</p>';
 const label='Стоянка '+(index+1);
 return `<figure class="presence-location" data-presence-location="${esc(stay.id)}"><div class="presence-map-placeholder"><span>Место стоянки</span></div><figcaption><b>${label}</b><span>${(+stay.lat).toFixed(5)}, ${(+stay.lng).toFixed(5)}</span><a href="#/trip/${encodeURIComponent(tripId)}/map" data-presence-map-open="${esc(stay.id)}" aria-label="${label}: открыть на карте">Открыть на карте ↗</a></figcaption></figure>`;
}

export function mountPresenceMaps(root,stays,{leaflet,makeBase,observe=globalThis.IntersectionObserver,mount=mountGpsTrackMap}={}){
 const entries=new Set(),byId=new Map(stays.filter(coordinates).map(s=>[String(s.id),s]));let observer,disposed=false;
 const draw=figure=>{
  if(disposed||!root.contains(figure))return;
  const stay=byId.get(figure.dataset.presenceLocation),fallback=figure.querySelector('.presence-map-placeholder');if(!stay||!fallback)return;
  const entry=mount(fallback,[{lat:+stay.lat,lng:+stay.lng,ts:stay.stay_from}],{leaflet,makeBase,color:'#dc2626',label:figure.querySelector('b').textContent+' · место на карте',className:'presence-location-map',endpoints:false,mapOptions:{zoomControl:false,dragging:false,touchZoom:false,doubleClickZoom:false,boxZoom:false,keyboard:false}});
  if(entry)entries.add(entry);else fallback.textContent='Подложка карты недоступна';
 };
 if(observe)observer=new observe(rows=>{for(const row of rows)if(row.isIntersecting){observer.unobserve(row.target);draw(row.target);}});
 root.querySelectorAll('[data-presence-location]').forEach(figure=>observer?observer.observe(figure):draw(figure));
 return {destroy(){disposed=true;observer?.disconnect();for(const entry of entries)entry.destroy();entries.clear();}};
}
