import {it,expect,vi} from 'vitest';
import {loadEntityPeople,entityPersonLabel} from '../src/entity-people.js';

it('uses the restricted directory and retains legacy projects without hiding errors',async()=>{
  const people=[{id:'a',full_name:'Анна',active:true}];
  const select=vi.fn().mockResolvedValue({data:people});
  const db={rpc:vi.fn().mockResolvedValue({data:people}),from:vi.fn(()=>({select}))};
  expect(await loadEntityPeople(db)).toEqual(people);
  expect(db.from).not.toHaveBeenCalled();
  db.rpc.mockResolvedValue({error:{code:'PGRST202'}});
  expect(await loadEntityPeople(db)).toEqual(people);
  expect(select).toHaveBeenCalledWith('id,full_name,role,active');
  db.rpc.mockResolvedValue({error:{code:'42501',message:'denied'}});
  await expect(loadEntityPeople(db)).rejects.toMatchObject({code:'42501'});
  expect(db.from).toHaveBeenCalledTimes(1);
});

it('distinguishes unnamed staff, inactive staff and inaccessible profiles',()=>{
  expect(entityPersonLabel({id:'bf1580b0-1234',full_name:'',role:'engineer',active:true})).toBe('Инженер · bf1580b0');
  expect(entityPersonLabel({id:'a',full_name:'Анна',active:false})).toBe('Анна (неактивен)');
  expect(entityPersonLabel(null)).toBe('Пользователь недоступен');
});
