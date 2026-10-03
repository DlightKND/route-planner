// A small staff directory for assignments and history. Full profiles remain
// protected by their existing RLS policies.
export async function loadEntityPeople(db){
  const result=await db.rpc('entity_people');
  if(!result.error)return result.data||[];
  // Keep compatibility with projects that have not received this draft yet.
  if(!['PGRST202','42883'].includes(result.error.code))throw result.error;
  const fallback=await db.from('profiles').select('id,full_name,role,active');
  if(fallback.error)throw fallback.error;
  return fallback.data||[];
}

export function entityPersonLabel(person){
  if(!person)return 'Пользователь недоступен';
  const roles={admin:'Администратор',logist:'Диспетчер',engineer:'Инженер'};
  const name=String(person.full_name||'').trim()
    ||`${roles[person.role]||'Сотрудник'} · ${String(person.id).slice(0,8)}`;
  return name+(person.active===false?' (неактивен)':'');
}
