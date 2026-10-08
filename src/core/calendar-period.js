const day=86400000;
const zoned=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
function utcDate(value){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Укажите корректные даты периода');
 const time=Date.parse(value+'T00:00:00Z');
 if(!Number.isFinite(time)||new Date(time).toISOString().slice(0,10)!==value)throw Error('Укажите корректные даты периода');return time;
}
function midnight(time){
 const p=Object.fromEntries(zoned.formatToParts(time).map(p=>[p.type,p.value]));
 const local=Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second);
 return new Date(time-(local-time)).toISOString();
}
// The UI includes both dates. Queries use an exclusive next-day upper bound.
export function calendarPeriodBounds({from,to}){
 const a=utcDate(from),b=utcDate(to);if(a>b)throw Error('Начало периода позже конца');
 return {from:midnight(a),until:midnight(b+day)};
}
