import {describe,expect,it} from 'vitest';
import {defaultPayer,paymentView,roadPaymentView} from '../src/payment-terms.js';

const profiles=[{id:'tp-client',name:'Клиент',def_paid:true},{id:'tp-factory',name:'Производство',def_warranty:true},
 {id:'tp-service',name:'Отдел сервиса'},{id:'tp-sales',name:'Отдел продаж'}];
const job={id:'job',title:'Клиент А',local:{}};

describe('payers are tariff profiles',()=>{
 it('offers every tariff profile and defaults by warranty and client profile',()=>{
  const view=paymentView({scope:'job',item:job,profiles,editable:true});
  expect(view.options.payer).toEqual({'tp-client':'Клиент','tp-factory':'Производство','tp-service':'Отдел сервиса','tp-sales':'Отдел продаж'});
  expect(view.effective).toEqual({warranty:'paid',payer:'tp-client'});
  expect(paymentView({scope:'job',item:{...job,local:{warranty:'warranty'}},profiles}).effective).toEqual({warranty:'warranty',payer:'tp-factory'});
  expect(defaultPayer({default_profile:'tp-sales'},'paid',profiles)).toBe('tp-sales');
  expect(defaultPayer({default_profile:'tp-sales'},'warranty',profiles)).toBe('tp-factory');
  expect(defaultPayer({default_profile:'deleted'},'paid',profiles)).toBe('tp-client');
 });

 it('inherits an explicit payer down to tasks while a hand-picked work profile stays',()=>{
  const order={id:'order',number:7,job:{...job,local:{payer:'tp-service'}},local:{},works:[
   {id:'auto',tariff_profile:'tp-client',billable:true,local:{}},{id:'manual',tariff_profile:'tp-sales',billable:true,local:{}},
   {id:'warranty',tariff_profile:'tp-factory',billable:false,local:{warranty:'warranty'}}]};
  const model={scope:'order',item:order,profiles};
  expect(paymentView(model).effective.payer).toBe('tp-service');
  expect(paymentView(model,'auto').effective.payer).toBe('tp-service');
  expect(paymentView(model,'manual').effective.payer).toBe('tp-sales');
  expect(paymentView(model,'warranty')).toMatchObject({effective:{warranty:'warranty',payer:'tp-service'},exception:true});
  expect(paymentView(model,'manual').names.payer['tp-sales']).toBe('Отдел продаж');
 });

 it('switches the default payer with the warranty unless a payer was chosen',()=>{
  const order={id:'order',number:1,job,local:{warranty:'warranty'},works:[]};
  expect(paymentView({scope:'order',item:order,profiles}).effective).toEqual({warranty:'warranty',payer:'tp-factory'});
  expect(paymentView({scope:'order',item:{...order,job:{...job,local:{payer:'tp-sales'}}},profiles}).effective).toEqual({warranty:'warranty',payer:'tp-sales'});
 });

 it('marks trips with different request payers and resolves road sections per request',()=>{
  const jobs=[{...job,id:'a'},{...job,id:'b',local:{payer:'tp-sales'}}];
  const trip=paymentView({scope:'trip',item:{id:'trip',jobs,local:{}},profiles});
  expect(trip.effective.payer).toBe('mixed');
  expect(trip.names.payer.mixed).toBe('Разные плательщики');
  const road={item:{id:'trip',jobs,local:{}},tariffs:{tariff_profiles:profiles},editable:true};
  expect(roadPaymentView(road,{id:'s',shares:{b:3},local:{}}).effective.payer).toBe('tp-sales');
  expect(roadPaymentView(road,{id:'s',shares:{a:3},local:{payer:'tp-service'}})).toMatchObject({effective:{payer:'tp-service'},exception:true});
 });
});
