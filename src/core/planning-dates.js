export const planningDate=value=>/^\d{4}-\d{2}-\d{2}$/.test(value||'')?value.slice(8,10)+'.'+value.slice(5,7)+'.'+value.slice(0,4):'';
export function planningPeriod(from,to){return from?planningDate(from)+(to&&to!==from?' — '+planningDate(to):''):to?'До '+planningDate(to):'Период не задан';}
export function planningWarnings({requestDue,from,to,trips=[]}){
 const warnings=[];
 if(requestDue&&to&&to>requestDue)warnings.push('Окончание задания позже срока заявки (SLA). Согласуйте срок с заказчиком.');
 if(requestDue&&from&&from>requestDue&&!warnings.length)warnings.push('Начало задания позже срока заявки (SLA). Согласуйте новый план.');
 const outside=trips.filter(t=>!t.deleted_at&&t.date_from&&((from&&t.date_from<from)||(to&&(t.date_to||t.date_from)>to)));
 if(outside.length)warnings.push('Выезды вне периода задания: '+outside.length+'. Проверьте даты связанных выездов.');
 return warnings;
}
