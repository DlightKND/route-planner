import {setButtonBusy} from './ui/button-state.js';
import {distanceText,intervalText,timelineDays,clusterScreenPoints} from './core/journal-display.js';
import {activityTimeline,routeAmounts,presenceRoadConflicts,stopTitle} from './core/gps-journal.js';
import {TRACK_STYLE,trackLineStyle} from './core/track-style.js';
import {presenceBounds} from './core/trip-presence-recovery.js';
import {haversineKm} from './core/track.js';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num=distanceText;
const clockFormat=new Intl.DateTimeFormat('ru-RU',{timeZone:'Europe/Kyiv',hour:'2-digit',minute:'2-digit'});
const clock=t=>t?clockFormat.format(new Date(t)):'—';
const pointKm=([lat,lng],[otherLat,otherLng])=>haversineKm({lat,lng},{lat:otherLat,lng:otherLng});
const routePoints=segment=>{
 const coords=(segment.line||[]).filter(p=>Array.isArray(p)&&p.length>=2).map(p=>[p[1],p[0]]);
 return coords.length>=2?coords:segment.fromPt&&segment.toPt?[[segment.fromPt.lat,segment.fromPt.lng],[segment.toPt.lat,segment.toPt.lng]]:[];
};
function sectionGeometry(segments,section){
 const start=Date.parse(section.start_at),end=Date.parse(section.end_at);
 return segments.flatMap(segment=>{
  const from=Date.parse(segment.fromTs),to=Date.parse(segment.toTs);
  if(!Number.isFinite(from)||!Number.isFinite(to)||to<start||from>end||to===start&&from<to||from===end&&from<to)return [];
  if(from===to&&(!section.id.includes('~finish')||!segment.why?.startsWith('возвращение на финиш')))return [];
  const coords=routePoints(segment);
  if(!coords.length||!coords.flat().every(Number.isFinite))return [];
  const prefix=[0];
  coords.slice(1).forEach((point,i)=>prefix.push(prefix[i]+pointKm(coords[i],point)));
  const total=prefix.at(-1),a=Math.max(from,start),b=Math.min(to,end);
  const ratio=t=>to===from?1:(t-from)/(to-from);
  const fromKm=to===from?0:ratio(a)*total,toKm=ratio(b)*total;
  const length=toKm-fromKm;
  const at=km=>{
   const i=Math.min(coords.length-2,Math.max(0,prefix.findIndex(n=>n>=km)-1));
   const f=prefix[i+1]>prefix[i]?(km-prefix[i])/(prefix[i+1]-prefix[i]):0;
   return coords[i].map((x,j)=>x+(coords[i+1][j]-x)*f);
  };
  return [{from:a,to:b,start:fromKm,length,
   coords:[at(fromKm),...coords.filter((_,i)=>prefix[i]>fromKm&&prefix[i]<toKm),at(toKm)],at}];
 });
}
export function timelineHTML(trip,track,stays){
 const parts=[];for(const part of activityTimeline(trip,track,stays)){const last=parts.at(-1);if(last&&last.kind===part.kind&&last.recovery===part.recovery&&last.stopId===part.stopId&&last.conflict===part.conflict){last.to=part.to;last.width+=part.width;}else parts.push({...part});}if(!parts.length)return '<p class="hint">Хронология появится после получения данных о поездке.</p>';
 const start=parts[0].from,end=parts.at(-1).to,ticks=[];
 for(let t=Math.ceil(start/3600000)*3600000;t<end;t+=3600000)ticks.push('<span style="left:'+((t-start)/(end-start)*100)+'%">'+clock(t)+'</span>');
 const days=timelineDays(start,end);
 return '<details class="journal-timeline-disclosure"><summary aria-label="Хронология поездки: '+esc(intervalText(start,end))+'"><span class="journal-timeline-caption">'+(days.length>1?esc(intervalText(start,end)):clock(start)+'<b>'+clock(end)+'</b>')+'</span><span class="journal-mini-band" aria-hidden="true">'+parts.map(p=>'<span class="'+p.kind+(p.recovery?' recovery':'')+'" style="width:'+p.width+'%"></span>').join('')+'</span></summary><div class="journal-timeline">'+(days.length>1?'<div class="journal-time-days">'+days.map(d=>'<span style="left:'+d.left+'%;width:'+d.width+'%">'+esc(d.label)+'</span>').join('')+'</div>':'')+'<div class="journal-time-labels"><span>'+clock(start)+'</span>'+ticks.join('')+'<span>'+clock(end)+'</span></div><div class="journal-time-band" aria-label="Хронология поездки">'+parts.map(p=>'<button type="button" class="journal-time-part '+p.kind+(p.recovery?' recovery':'')+(p.conflict?' conflict':'')+'" style="left:'+p.left+'%;width:'+p.width+'%" '+(p.stopId?'data-journal-stop="'+esc(p.stopId)+'"':'disabled')+' title="'+esc(intervalText(p.from,p.to)+' · '+({stop:'Остановка',drive:'Движение',unknown:'Нет GPS'}[p.kind])+(p.recovery?' · восстановление':''))+'"><span class="sr-only">'+esc(intervalText(p.from,p.to))+(p.stopId?' · Остановка '+(stays.findIndex(s=>s.id===p.stopId)+1):'')+'</span></button>').join('')+'</div>'+(stays.length?'<details class="journal-timeline-stops"><summary>Выбрать остановку · '+stays.length+'</summary><div>'+stays.map((s,i)=>'<button type="button" data-journal-stop="'+esc(s.id)+'"><strong>Остановка '+(i+1)+'</strong><span>'+esc(intervalText(s.stay_from,s.stay_to))+'</span></button>').join('')+'</div></details>':'')+'<div class="journal-legend"><span class="drive">Движение по GPS</span><span class="stop">Остановка</span><span class="unknown">Нет GPS</span><span class="recovery">Восстановленное время</span></div></div></details>';

}
export function wireJournalTimeline(root){
 const labels=root.querySelector('.journal-time-labels'),disclosure=root.querySelector('.journal-timeline-disclosure');if(disclosure)disclosure.open=root.dataset.timelineExpanded?root.dataset.timelineExpanded==='true':false;const toggle=e=>{if(e.target===disclosure){if(!root.classList.contains('journal-timeline-floating'))root.dataset.timelineExpanded=String(disclosure.open);fit();}};if(disclosure&&root.classList.contains('journal-timeline-floating'))disclosure.open=true;root.addEventListener('toggle',toggle,true);
 function fit(){if(!labels||!labels.clientWidth)return;const ticks=[...labels.children],last=ticks.at(-1);if(ticks.length<2)return;let edge=ticks[0].getBoundingClientRect().right;const limit=last.getBoundingClientRect().left;
  for(const tick of ticks.slice(1,-1)){tick.hidden=false;const box=tick.getBoundingClientRect();tick.hidden=box.left<edge+12||box.right>limit-12;if(!tick.hidden)edge=box.right;}
 }
 const observer=labels&&typeof ResizeObserver!=='undefined'?new ResizeObserver(fit):null;observer?.observe(labels);fit();
 const close=e=>{if(e.target.closest('[data-journal-stop]')){const choices=root.querySelector('.journal-timeline-stops');if(choices)choices.open=false;}};root.addEventListener('click',close);
 // Floating map timeline (mockup v65): the caption names the interval under the pointer or focus.
 const describe=e=>{const caption=root.querySelector('.map-current-stop'),part=e.target.closest?.('.journal-time-part');if(!caption)return;caption.textContent=part&&e.type!=='pointerleave'&&e.type!=='focusout'?part.title:caption.dataset.idle||'';};
 for(const type of ['pointerover','focusin','pointerleave','focusout'])root.addEventListener(type,describe);
 return {fit,destroy(){observer?.disconnect();root.removeEventListener('click',close);root.removeEventListener('toggle',toggle,true);for(const type of ['pointerover','focusin','pointerleave','focusout'])root.removeEventListener(type,describe);}};
}
export function mountJournalRoute(root,{trip,track,stays,leaflet:L,makeBase,onStop,onRebuild,onExpand,canEdit,mini=false,selectedStopId=null,jobs=[]}){
 const data=track?.data||track||{},amounts=routeAmounts(track),segments=data.segments||[],issues=segments.map((s,i)=>({...s,index:i})).filter(s=>s.kind!=='track'),conflicts=stays.flatMap(s=>presenceRoadConflicts(s,track).map(m=>({stay:s,...m})));
 const percent=v=>amounts.total>0&&v!=null?' · '+Number(v/amounts.total*100).toLocaleString('ru-RU',{maximumFractionDigits:1})+'%':'';
 const problemCount=amounts.unknown.length+conflicts.length+(amounts.gps==null?1:0);const problemLabel=count=>count?'Требуют внимания: '+count:'Посмотреть восстановленные участки: '+issues.length;
 root.innerHTML='<div class="journal-route-map" role="region" aria-label="Маршрут поездки"></div>'+(mini?'<button class="btn ghost journal-expand-map" data-expand-map>Развернуть маршрут</button>':'<aside class="journal-route-quality"><section class="journal-route-metrics"><h2>Качество маршрута</h2>'+(data.preview?'<p class="hint journal-track-preview">Показан GPS без дорожной проверки. Для достройки используйте «Проверить и достроить трек».</p>':'')+'<dl><div><dt>GPS · измеренный путь</dt><dd>'+num(amounts.gps)+percent(amounts.gps)+'</dd></div><div><dt>Восстановлено · расчёт</dt><dd>'+num(amounts.restored)+percent(amounts.restored)+'</dd></div><div><dt>Итого учтено</dt><dd>'+num(amounts.total)+'</dd></div></dl><button type="button" class="btn ghost" data-route-problems>' +problemLabel(problemCount)+'</button>'+(canEdit?'<button type="button" class="btn amber" data-route-rebuild>Проверить и достроить трек</button>':'')+'</section><details class="journal-route-issues" open><summary>Ключевые участки ('+issues.length+')</summary>'+issues.map(s=>'<button type="button" data-route-issue="'+s.index+'"><strong>'+(s.kind==='road'?'Восстановленная дорога · '+num(s.km):'Разрыв GPS · не измерено')+'</strong><span>'+esc(intervalText(s.fromTs,s.toTs))+'</span><small>'+esc(s.why||(s.kind==='road'?'Расчётный маршрут при потере GPS':'Разрыв не измерен · требуется проверка'))+'</small></button>').join('')+'</details>'+conflicts.map((c,i)=>'<button class="journal-conflict" data-route-conflict="'+i+'"><strong>Конфликт времени · Остановка '+(stays.indexOf(c.stay)+1)+'</strong><span>'+esc(intervalText(c.from,c.to))+' · движение пересекается с принятым присутствием</span><small>Пересмотрите восстановленное время. GPS-время защищено.</small></button>').join('')+'<details class="journal-route-explainer"><summary>Условные обозначения и точность</summary><div class="journal-map-legend"><span class="measured">GPS · измеренный путь</span><span class="rebuilt">Восстановленная дорога · расчёт</span><span class="gap">Неизвестный участок</span><span class="hypothesis">Предполагаемое присутствие · условный знак</span></div><p class="hint">Неизмеренные разрывы в сумму не входят. Достройка дороги не подтверждает присутствие и выполнение заданий.</p></details></aside>');
 const problems=root.querySelector('[data-route-problems]');if(problems)problems.onclick=()=>{const details=root.querySelector('.journal-route-issues');details.open=true;const target=root.querySelector('[data-route-conflict]')||root.querySelector('[data-route-issue]')||details.querySelector('summary');target.scrollIntoView?.({block:'nearest'});target.focus({preventScroll:true});};
 const button=root.querySelector('[data-route-rebuild]');if(button)button.onclick=async()=>{button.disabled=true;setButtonBusy(button,true);try{await onRebuild();}finally{setButtonBusy(button,false);if(button.isConnected)button.disabled=false;}};
 let map,stopLayer,activeStopId=selectedStopId,roadLayer,roadMarker,pickRoad;
 let drawStops=()=>{};const box=root.querySelector('.journal-route-map'),lines=new Map(),markers=new Map();
 // Leaflet restores window scroll after focus, but not this nested route scroller.
 const keepPointerFocus=e=>{if(!e.target.closest?.('.journal-map-stop'))return;box.focus({preventScroll:true});e.preventDefault();};box.addEventListener('mousedown',keepPointerFocus,true);
 try{if(!L)throw Error('Карта недоступна');map=L.map(box,{scrollWheelZoom:!mini,dragging:!mini,zoomControl:!mini,attributionControl:true});makeBase().addTo(map);const layers=[];
  const gpsLines=[];segments.forEach((s,i)=>{const coords=routePoints(s);if(!coords.length)return;if(s.kind==='track'){gpsLines.push(coords);return;}const line=L.polyline(coords,trackLineStyle(s.kind)).addTo(map);layers.push(line);lines.set(i,line);});
  if(gpsLines.length)layers.push(L.polyline(gpsLines,trackLineStyle('track')).addTo(map));
  const validStops=stays.map((stay,index)=>({stay,index})).filter(({stay})=>stay.lat!=null&&stay.lng!=null&&Number.isFinite(Number(stay.lat))&&Number.isFinite(Number(stay.lng)));
  stopLayer=L.layerGroup().addTo(map);
  drawStops=()=>{if(!map)return;stopLayer.clearLayers();markers.clear();const points=validStops.map(item=>({...item,...map.latLngToContainerPoint([Number(item.stay.lat),Number(item.stay.lng)])}));
   for(const group of clusterScreenPoints(points)){const first=group[0],lat=group.reduce((sum,p)=>sum+Number(p.stay.lat),0)/group.length,lng=group.reduce((sum,p)=>sum+Number(p.stay.lng),0)/group.length;
    const selected=group.some(p=>p.stay.id===activeStopId),approved=group.every(p=>p.stay.status==='approved'),hypothesis=group.every(p=>presenceBounds(p.stay)?.gps===0),name=group.length>1?'Выбрать остановку из группы: '+group.length:'Остановка '+(first.index+1)+': '+stopTitle(first.stay,jobs,first.index);
    const marker=L.marker([lat,lng],{autoPanOnFocus:false,icon:L.divIcon({className:['journal-map-stop',group.length>1?'grouped':'',selected?'selected':'',approved?'confirmed':'',hypothesis?'hypothesis':''].filter(Boolean).join(' '),html:group.length>1?'×'+group.length:String(first.index+1),iconSize:[44,44],iconAnchor:[22,22]})}).addTo(stopLayer).bindTooltip(esc(name));marker.getElement()?.setAttribute('aria-label',name);
    if(group.length===1)marker.on('click',()=>onStop?.(first.stay.id));else marker.on('click',()=>{
     box.querySelector('.journal-map-group-panel')?.remove();const panel=root.ownerDocument.createElement('section');panel.className='journal-map-group-panel';panel.setAttribute('role','region');panel.setAttribute('aria-label','Остановки в выбранной группе');
     panel.innerHTML='<header><strong>Остановки · '+group.length+'</strong><button type="button" class="btn ghost" aria-label="Закрыть группу">×</button></header><div class="journal-map-stop-choices">'+group.map(p=>'<button type="button" data-map-stop="'+esc(p.stay.id)+'">'+(p.index+1)+' · '+esc(stopTitle(p.stay,jobs,p.index))+' · '+esc(intervalText(p.stay.stay_from,p.stay.stay_to))+'</button>').join('')+'</div>';
     L.DomEvent.disableClickPropagation(panel);L.DomEvent.disableScrollPropagation(panel);box.append(panel);panel.querySelector('header button').onclick=()=>panel.remove();panel.querySelectorAll('[data-map-stop]').forEach(button=>button.onclick=()=>{panel.remove();onStop?.(button.dataset.mapStop);});
    });group.forEach(p=>markers.set(p.stay.id,marker));
   }
  };
  const bounds=L.latLngBounds(validStops.map(({stay})=>[Number(stay.lat),Number(stay.lng)]));for(const layer of layers)bounds.extend(layer.getBounds());
  if(bounds.isValid()){map.fitBounds(bounds,{padding:[28,28],maxZoom:15});drawStops();map.on('zoomend',drawStops);}else{map.remove();map=null;box.innerHTML='<p class="hint">Сохранённого маршрута пока нет. Остановки доступны для проверки.</p>';}

 }catch{map?.remove();map=null;box.innerHTML='<p class="hint">Карта недоступна. Данные маршрута и остановок сохранены.</p>';}
 function focus(index){const line=lines.get(index);lines.forEach(l=>l.setStyle({weight:l===line?7:TRACK_STYLE.weight}));if(map&&line)map.fitBounds(line.getBounds(),{padding:[40,40],maxZoom:15});root.querySelectorAll('[data-route-issue]').forEach(b=>b.classList.toggle('is-selected',Number(b.dataset.routeIssue)===index));}
 function focusRoad(section){
  roadLayer?.remove();roadLayer=null;if(!map||!section)return;
  const parts=sectionGeometry(segments,section);if(!parts.length)return;
  roadLayer=L.polyline(parts.map(part=>part.coords),{color:'#266fe0',weight:7,opacity:.9}).addTo(map);
  roadLayer.on('click',event=>pickRoad?.(event.latlng,parts));
  map.fitBounds(roadLayer.getBounds(),{padding:[40,40],maxZoom:15});
 }
 function markRoadCut(section,time,onSelect){
  roadMarker?.remove();roadMarker=null;pickRoad=null;
  if(!map||!section)return;
  const parts=sectionGeometry(segments,section),part=parts.find(piece=>piece.from<=time&&piece.to>=time);
  if(part&&part.to>part.from)roadMarker=L.circleMarker(part.at(part.start+part.length*(time-part.from)/(part.to-part.from)),
   {radius:6,weight:3,color:'#fff',fillColor:'#266fe0',fillOpacity:1,interactive:false}).addTo(map);
  pickRoad=(point,geometry)=>{
   let closest=null;
   for(const piece of geometry){
    let passed=0;
    for(let i=1;i<piece.coords.length;i++){
     const [a,b]=piece.coords.slice(i-1,i+1),p=map.latLngToLayerPoint(a),q=map.latLngToLayerPoint(b),at=map.latLngToLayerPoint(point);
     const delta=q.subtract(p),length=pointKm(a,b),norm=delta.x**2+delta.y**2;
     const ratio=norm?Math.max(0,Math.min(1,((at.x-p.x)*delta.x+(at.y-p.y)*delta.y)/norm)):0;
     const miss=at.distanceTo(p.add(delta.multiplyBy(ratio)));
     if(piece.length>0&&(!closest||miss<closest.miss))closest={miss,time:piece.from+(piece.to-piece.from)*(passed+ratio*length)/piece.length};
     passed+=length;
    }
   }
   if(closest)onSelect(closest.time);
  };
 }
 root.querySelectorAll('[data-route-issue]').forEach(b=>b.onclick=()=>focus(Number(b.dataset.routeIssue)));root.querySelectorAll('[data-route-conflict]').forEach(b=>b.onclick=()=>onStop?.(conflicts[Number(b.dataset.routeConflict)].stay.id));root.querySelector('[data-expand-map]')?.addEventListener('click',()=>onExpand?.());
 const observer=map&&typeof ResizeObserver!=='undefined'?new ResizeObserver(()=>map.invalidateSize({pan:false})):null;observer?.observe(box);
 function refreshPresence(){
  drawStops();
  const current=stays.flatMap(s=>presenceRoadConflicts(s,track).map(m=>({stay:s,...m}))),quality=root.querySelector('.journal-route-quality');if(!quality)return;
  root.querySelectorAll('[data-route-conflict]').forEach(b=>b.remove());
  const problems=root.querySelector('[data-route-problems]');if(problems)problems.textContent=problemLabel(amounts.unknown.length+current.length+(amounts.gps==null?1:0));
  const legend=root.querySelector('.journal-route-explainer');for(const conflict of current){const button=root.ownerDocument.createElement('button');button.className='journal-conflict';button.dataset.routeConflict='';button.textContent='Конфликт времени · Остановка '+(stays.indexOf(conflict.stay)+1)+' · '+clock(conflict.from)+'–'+clock(conflict.to);button.onclick=()=>onStop?.(conflict.stay.id);legend.before(button);}
 }
 return {select(id){activeStopId=id;for(const marker of new Set(markers.values()))marker.getElement()?.classList.toggle('selected',markers.get(id)===marker);},refreshPresence,focus,focusRoad,markRoadCut,destroy(){box.removeEventListener('mousedown',keepPointerFocus,true);observer?.disconnect();map?.off('zoomend',drawStops);map?.remove();}};
}

// Overview placement (mockup v65): the timeline floats over the bottom of the map, always expanded,
// with the legend on top and a caption; elsewhere it returns to its collapsible strip.
export function floatJournalTimeline(host,floating){
 if(!host)return;host.classList.toggle('journal-timeline-floating',!!floating);
 const disclosure=host.querySelector('.journal-timeline-disclosure');
 if(disclosure)disclosure.open=floating?true:host.dataset.timelineExpanded==='true';
 let caption=host.querySelector('.map-current-stop');
 if(floating&&!caption){caption=host.ownerDocument.createElement('p');caption.className='map-current-stop';caption.setAttribute('aria-live','polite');caption.dataset.idle='Наведите на участок или выберите стоянку в списке';caption.textContent=caption.dataset.idle;(host.querySelector('.journal-timeline')||host).append(caption);}
 if(caption)caption.hidden=!floating;
}
