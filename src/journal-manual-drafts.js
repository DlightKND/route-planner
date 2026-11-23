import {intervalText} from './core/journal-display.js';

export const manualDraftFields='id,revision,stay_from,stay_to,job_id,crew_ids,reason,jobs(clients(name))';

const kyivDateTime=new Intl.DateTimeFormat('sv-SE',{
 timeZone:'Europe/Kyiv',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'
});
const localTime=value=>value?kyivDateTime.format(new Date(value)).replace(' ','T'):'';

export function manualVisitPartyFields(jobs,people,{job,crew=[]}={}){
 const engineers=people.filter(person=>person.role==='engineer'&&person.active!==false);
 return [
  {key:'job',label:'Заявка и объект',type:'select',required:true,value:job,
   options:[{value:'',label:'Выберите заявку'},...jobs.map(item=>({value:item.id,label:(item.clients?.name||'Заявка')+' · №'+item.id.slice(0,8)}))]},
  {key:'crew',label:'Присутствовавшие инженеры',type:'select',multiple:true,required:true,value:crew,
   options:engineers.map(person=>({value:person.id,label:person.full_name||'Инженер'}))}
 ];
}

export function manualVisitTimeFields(draft,source){
 const min=localTime(source.started_at),max=localTime(source.ended_at||source.last_ts);
 return [
  {key:'from',label:'Начало',type:'datetime-local',required:true,value:localTime(draft?.stay_from),min,max},
  {key:'to',label:'Окончание',type:'datetime-local',required:true,value:localTime(draft?.stay_to),min,max},
  {key:'reason',label:'Причина отсутствия GPS',type:'textarea',required:true,value:draft?.reason}
 ];
}

export function renderManualVisitDrafts(root,rows,{onCreate,onEdit,onRemove,onConfirm}){
 const doc=root.ownerDocument;
 root.replaceChildren();
 if(!onCreate&&!rows.length)return;
 root.className='journal-source-choices journal-manual-drafts';
 const header=doc.createElement('header'),title=doc.createElement('h3');
 title.textContent=onCreate?'Ручные посещения':'Ручные посещения до привязки GPS';
 header.append(title);root.append(header);

 function button(label,action){
  const control=doc.createElement('button');
  control.type='button';control.className='btn sm ghost';control.textContent=label;
  control.onclick=()=>action(control);
  return control;
 }
 if(onCreate)header.append(button('Добавить посещение без GPS',onCreate));
 if(!rows.length)return;
 const list=doc.createElement('ul');list.className='gps-source-stops';
 for(const draft of rows){
  const row=doc.createElement('li');row.className='gps-source-stop';
  const main=doc.createElement('div'),interval=doc.createElement('strong'),job=doc.createElement('span'),reason=doc.createElement('p');
  interval.textContent=intervalText(draft.stay_from,draft.stay_to);
  job.textContent=draft.jobs?.clients?.name||'Заявка для уточнения';
  reason.textContent=draft.reason;
  main.append(interval,job);row.append(main);
  const actions=doc.createElement('div');actions.className='journal-manual-draft-actions';
  if(onEdit)actions.append(button('Изменить',control=>onEdit(draft,control)));
  if(onRemove)actions.append(button('Удалить',control=>onRemove(draft,control)));
  if(onConfirm)actions.append(button('Проверить посещение',control=>onConfirm(draft,control)));
  row.append(actions,reason);list.append(row);
 }
 root.append(list);
}
