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

it('checks the local draft before assigning, cancels without a write and uses the refreshed revision after saving',async()=>{const win=new Window();try{const root=win.document.createElement('section');win.document.body.append(root);const db={rpc:vi.fn(async()=>({data:{owner_id:'actor',curator_id:'other',revision:4}}))},beforeAssign=vi.fn(async()=>false);const options={root,db,kind:'order',id:'o',record:{owner_id:'actor',curator_id:'actor',revision:2},people:()=>[{id:'actor',role:'logist'},{id:'other',role:'engineer'}],userId:()=> 'actor',role:()=> 'logist',showHistory:false,beforeAssign};mountEntityResponsibility(options);let form=root.querySelector('form');form.elements.person.value='other';form.elements.reason.value='Передача куратору';await form.onsubmit({preventDefault(){}});expect(db.rpc).not.toHaveBeenCalled();expect(form.elements.reason.value).toBe('Передача куратору');beforeAssign.mockResolvedValue({record:{revision:3}});await form.onsubmit({preventDefault(){}});expect(db.rpc).toHaveBeenCalledWith('entity_responsibility_assign',expect.objectContaining({p_expected:3}));expect(beforeAssign.mock.invocationCallOrder[1]).toBeLessThan(db.rpc.mock.invocationCallOrder[0]);}finally{await win.happyDOM.close();}});

it('distinguishes a saved plan from a failed responsibility assignment',async()=>{for(const kind of ['order','trip','job']){const win=new Window();try{const root=win.document.createElement('section');win.document.body.append(root);const onError=vi.fn();mountEntityResponsibility({root,db:{rpc:vi.fn(async()=>({error:{message:'Сервер отклонил передачу'}}))},kind,id:'id',record:{owner_id:'actor',curator_id:'actor',revision:2},people:()=>[{id:'other',full_name:'Другой инженер',active:true}],userId:()=> 'actor',role:()=> 'logist',showHistory:false,beforeAssign:async()=>({saved:true,record:{revision:3}}),onError});const form=root.querySelector('form');form.elements.person.value='other';form.elements.reason.value='Новый ответственный';await form.onsubmit({preventDefault(){}});expect(root.querySelector('[role=status]').textContent).toContain(kind==='order'?'Изменения задания сохранены':kind==='trip'?'План выезда сохранён':'Изменения заявки сохранены');expect(root.querySelector('[data-curator]').textContent).not.toBe('Другой инженер');expect(form.elements.reason.value).toBe('Новый ответственный');expect(onError).toHaveBeenCalledOnce();}finally{await win.happyDOM.close();}}});
