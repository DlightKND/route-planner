import {it,expect,vi} from 'vitest';
import {Window} from 'happy-dom';
import {mountEntityResponsibility} from '../src/entity-responsibility.js';

it('removes delegation controls immediately when the actor hands away their final authority',async()=>{
  const win=new Window();
  try{
    const root=win.document.createElement('section');
    const next={owner_id:'owner',curator_id:'other'};
    const onChange=vi.fn(),onError=vi.fn();
    const query={select(){return this;},eq(){return this;},order(){return this;},limit:async()=>({data:[]})};
    const db={from:()=>query,rpc:vi.fn().mockResolvedValue({data:next})};
    mountEntityResponsibility({root,db,kind:'order',id:'order',record:{owner_id:'owner',curator_id:'actor',revision:7},people:()=>[{id:'actor',role:'engineer',active:true},{id:'other',full_name:'Анна',active:true},{id:'inactive',full_name:'Богдан',active:false}],userId:()=> 'actor',role:()=> 'engineer',onChange,onError});
    const form=root.querySelector('form');
    expect([...form.elements.person.options].map(o=>o.value)).toEqual(['actor','other']);
    form.elements.person.value='other';form.elements.reason.value='Передаю другому куратору';
    await form.onsubmit({preventDefault(){}});
    expect(root.querySelector('form')).toBeNull();
    expect(root.querySelector('[data-curator]').textContent).toBe('Анна');
    expect(db.rpc).toHaveBeenCalledWith('entity_responsibility_assign',expect.objectContaining({p_expected:7,p_person:'other'}));
    expect(onChange).toHaveBeenCalledWith(next);
    expect(onError).not.toHaveBeenCalled();
  }finally{await win.happyDOM.close();}
});
