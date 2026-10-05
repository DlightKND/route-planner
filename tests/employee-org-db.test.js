import {afterAll,beforeAll,beforeEach,afterEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const as=async n=>{await q("select set_config('test.uid',$1,true)",[n?id(n):'']);await db.exec('set local role authenticated');};
const fails=async(sql,args,message)=>{
  await q('savepoint expected_error');
  let error;
  try { await q(sql,args); } catch (e) { error=e; }
  await q('rollback to savepoint expected_error');
  await q('release savepoint expected_error');
  expect(error,`Expected SQL to fail with ${message}`).toBeTruthy();
  expect(String(error)).toContain(message);
};

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(readFileSync(new URL('./fixtures/trip-workbench-base.sql',import.meta.url),'utf8'));
  await db.exec("create schema dlight_private; create type public.user_role as enum('admin','logist','engineer'); alter table public.profiles add column full_name text; alter table public.profiles alter column role type public.user_role using role::public.user_role; create or replace function public.user_role() returns text language sql stable security definer set search_path=public as $$ select role::text from profiles where id=auth.uid() and active $$; alter table public.profiles enable row level security; grant select,update on public.profiles to authenticated; create policy profiles_admin_all on public.profiles for all to authenticated using (public.user_role()='admin') with check (public.user_role()='admin'); create policy profiles_mgr_read on public.profiles for select to authenticated using (public.user_role() in ('admin','logist'));");
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923144500_employee_org_structure.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20261005185611_account_profile_org_read.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('begin');
  await q("insert into profiles(id,role,active) values($1,'admin',true),($2,'engineer',true),($3,'engineer',true),($4,'engineer',false)",[id(1),id(2),id(3),id(4)]);
});
afterEach(async()=>{await db.exec('rollback');});

it('backfills existing profiles and creates an org row for new accounts',async()=>{
  expect(await q('select profile_id from employee_org order by profile_id')).toEqual([id(1),id(2),id(3),id(4)].sort().map(profile_id=>({profile_id})));
  await q("insert into profiles(id,role,active) values($1,'engineer',true)",[id(5)]);
  expect(await q('select profile_id,manager_id,job_title from employee_org where profile_id=$1',[id(5)])).toEqual([{profile_id:id(5),manager_id:null,job_title:''}]);
});

it('saves employee, app role, job title and direct manager atomically',async()=>{
  await as(1);
  await q("select public.employee_org_save($1,$2,$3::public.user_role,$4,$5)",[id(2),'Инженер 2','engineer','Сервисный инженер',id(1)]);
  expect(await q('select full_name,role::text role from profiles where id=$1',[id(2)])).toEqual([{full_name:'Инженер 2',role:'engineer'}]);
  expect(await q('select manager_id,job_title from employee_org where profile_id=$1',[id(2)])).toEqual([{manager_id:id(1),job_title:'Сервисный инженер'}]);
});

it('rejects self-management and any indirect reporting cycle',async()=>{
  await as(1);
  await q("select public.employee_org_save($1,'Сотрудник 2','engineer'::public.user_role,'Инженер',$2)",[id(2),id(1)]);
  await q("select public.employee_org_save($1,'Сотрудник 3','engineer'::public.user_role,'Инженер',$2)",[id(3),id(2)]);
  await fails("select public.employee_org_save($1,'Администратор','admin'::public.user_role,'Руководитель',$2)",[id(1),id(3)],'цикл');
  await fails("select public.employee_org_save($1,'Сотрудник 2','engineer'::public.user_role,'Инженер',$2)",[id(2),id(2)],'самого себя');
  expect(await q('select profile_id,manager_id from employee_org where profile_id=any($1::uuid[]) order by profile_id',[[id(1),id(2),id(3)]])).toEqual([
    {profile_id:id(1),manager_id:null},{profile_id:id(2),manager_id:id(1)},{profile_id:id(3),manager_id:id(2)}
  ]);
});

it('requires an active existing manager and validates role, title and employee name',async()=>{
  await as(1);
  await fails("select public.employee_org_save($1,'Сотрудник 2','engineer'::public.user_role,'',$2)",[id(2),id(4)],'активного руководителя');
  await fails("select public.employee_org_save($1,' ','engineer'::public.user_role,'',null)",[id(2)],'имя сотрудника');
  await fails("select public.employee_org_save($1,'Сотрудник 2','engineer'::public.user_role,repeat('x',121),null)",[id(2)],'120 символов');
});

it('restricts directory reads and all direct writes to authorized app roles',async()=>{
  await as(3);
  expect(await q('select * from employee_org')).toEqual([]);
  await q("update employee_org set job_title='сам себе' where profile_id=$1",[id(3)]);
  await db.exec('reset role');await as(1);
  expect((await q('select job_title from employee_org where profile_id=$1',[id(3)]))[0].job_title).toBe('');
  await db.exec('reset role');await as(3);
  await fails("insert into employee_org(profile_id) values($1)",[id(5)],'row-level security');
  await db.exec('reset role');
  await as(1);
  expect(await q('select * from employee_org')).toHaveLength(4);
});

it('denies the save RPC to engineers and anonymous callers',async()=>{
  await as(2);
  await fails("select public.employee_org_save($1,'Сотрудник 3','engineer'::public.user_role,'',null)",[id(3)],'Только администратор');
  await q("select set_config('test.uid','',true)");
  await fails("select public.employee_org_save($1,'Сотрудник 3','engineer'::public.user_role,'',null)",[id(3)],'Только администратор');
});

it('reads only the caller, direct manager and active direct reports under an engineer session',async()=>{
  await q("update profiles set full_name='Сотрудник '||right(id::text,1)");
  await q('update employee_org set manager_id=$1 where profile_id=$2',[id(1),id(2)]);
  await q('update employee_org set manager_id=$1 where profile_id=any($2::uuid[])',[id(2),[id(3),id(4)]]);
  await as(2);
  const org=(await q('select account_org_read() as org'))[0].org;
  expect(org.manager.id).toBe(id(1));expect(org.reports.map(p=>p.id)).toEqual([id(3)]);
  expect(JSON.stringify(org)).not.toContain(id(4));
  expect(await q('select * from employee_org')).toEqual([]);
});
it('rejects anonymous and inactive profile reads and cannot accept another profile ID',async()=>{
  await as(4);await fails('select account_org_read()',[],'активная');
  await q('reset role');await q("select set_config('test.uid','',true)");
  await fails('select account_org_read()',[],'активная');
  expect((await q("select has_function_privilege('anon','public.account_org_read()','execute') as allowed"))[0].allowed).toBe(false);
  expect((await q("select prosecdef,array_to_string(proconfig,',') as config from pg_proc where oid='public.account_org_read()'::regprocedure"))[0]).toEqual({prosecdef:true,config:'search_path=""'});
  await fails('select account_org_read($1::uuid)',[id(1)],'does not exist');
});
