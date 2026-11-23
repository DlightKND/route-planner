// Header facts shared by request, task and trip cards (approved mockup v65).
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const metaDate=v=>/^\d{4}-\d{2}-\d{2}/.test(v||'')?v.slice(8,10)+'.'+v.slice(5,7)+'.'+v.slice(0,4):'';
export function metaPeriod(from,to){
 if(!from&&!to)return 'Не заданы';
 if(!from||!to||from===to)return metaDate(from||to);
 return metaDate(from)+' — '+metaDate(to);
}
export function crewLabel(names){
 const list=(names||[]).filter(Boolean);
 if(!list.length)return 'Не назначены';
 if(list.length===1)return list[0];
 const n=list.length,word=n%10===1&&n%100!==11?'инженер':n%10>=2&&n%10<=4&&(n%100<12||n%100>14)?'инженера':'инженеров';
 return n+' '+word;
}
export function metadataList(rows){
 return '<dl class="workflow-metadata">'+rows.filter(Boolean).map(([label,value,title])=>`<div><dt>${esc(label)}</dt><dd${title?` title="${esc(title)}"`:''}>${esc(value)}</dd></div>`).join('')+'</dl>';
}
// Requests and trips carry a sequential number once the numbering migration is applied;
// until then the short identifier keeps links readable.
const knownNumbers=new Map();
// Lists loaded with select('*') register their numbers so cards and links that only hold an id stay consistent.
export function rememberNumbers(rows){for(const row of rows||[])if(row?.id&&row.number!=null)knownNumbers.set(String(row.id),String(row.number));}
export const recordNumber=(record,id)=>{const key=String(id??record?.id??'');return record?.number!=null?String(record.number):knownNumbers.get(key)||key.slice(0,8);};
export const requestLabel=(record,id)=>'Заявка №'+recordNumber(record,id);
export const tripLabel=(record,id)=>'Выезд №'+recordNumber(record,id);
