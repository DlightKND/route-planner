const DAY=86400000;
const time=iso=>Date.parse(iso+'T00:00:00Z');
const iso=value=>new Date(value).toISOString().slice(0,10);
export function summaryPreset(date,unit){
 const d=new Date(time(date));
 if(unit==='month')return {from:iso(Date.UTC(d.getUTCFullYear(),d.getUTCMonth(),1)),to:iso(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0))};
 const start=+d-((d.getUTCDay()+6)%7)*DAY;
 return {from:iso(start),to:iso(start+(unit==='fortnight'?13:6)*DAY)};
}
export function summaryUnit(range){
 for(const unit of ['week','fortnight','month']){
  const p=summaryPreset(range.from,unit);if(p.from===range.from&&p.to===range.to)return unit;
 }
 return 'custom';
}
export function shiftSummaryPeriod(range,direction){
 if(summaryUnit(range)==='month'){
  const d=new Date(time(range.from));return summaryPreset(iso(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+direction,1)),'month');
 }
 const offset=(time(range.to)-time(range.from)+DAY)*direction;
 return {from:iso(time(range.from)+offset),to:iso(time(range.to)+offset)};
}
export function summaryPeriodLabel({from,to}){
 const short=d=>d.slice(8,10)+'.'+d.slice(5,7);
 return short(from)+(from.slice(0,4)!==to.slice(0,4)?'.'+from.slice(0,4):'')+' — '+short(to)+'.'+to.slice(0,4);
}
