import {afterAll,beforeAll,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;
const q=async(sql,args=[]) => (await db.query(sql,args)).rows;
const as=async n=>{await q("select set_config('test.uid',$1,true)",[n?id(n):'']);await db.exec('set local role authenticated');};
const fails=async(sql,args,pattern)=>{
  await q('savepoint expected_error');let error;
  try{await q(sql,args);}catch(e){error=e;}
  await q('rollback to savepoint expected_error');await q('release savepoint expected_error');
  expect(error).toBeTruthy();expect(String(error)).toMatch(pattern);
};

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(readFileSync(new URL('./fixtures/trip-workbench-base.sql',import.meta.url),'utf8'));
  await db.exec("create schema dlight_private; create type public.user_role as enum('admin','logist','engineer'); alter table public.profiles alter column role type public.user_role using role::public.user_role; create or replace function public.user_role() returns text language sql stable security definer set search_path=public as $$ select role::text from profiles where id=auth.uid() and active $$; alter table public.profiles enable row level security; create policy profiles_admin_all on public.profiles for all to authenticated using (public.user_role()='admin') with check (public.user_role()='admin'); create table public.job_parts(id uuid primary key,job_id uuid,name text,sku text,unit text,qty numeric,price numeric,cost numeric,created_at timestamptz default now(),created_by uuid);");
  await q("insert into profiles(id,role,active) values($1,'admin',true),($2,'logist',true),($3,'engineer',true)",[id(1),id(2),id(3)]);
  await q("insert into job_parts(id,job_id,name,sku,unit,qty,price,cost,created_by) values($1,$4,'Клапан','A-1','шт',1,120,70,$5),($2,$4,'Клапан','A-1','шт',2,120,70,$5),($3,$4,'Шланг','','м',3,90,45,$5)",[id(11),id(12),id(13),id(21),id(1)]);
  await db.exec(readFileSync(new URL('../supabase/migrations/20260923154000_stock_catalog.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>{await db?.close();});

it('backfills each legacy material snapshot without merging repeated names or SKUs',async()=>{
  const rows=await q('select name,sku,unit,price,cost,legacy_part_id from stock_catalog order by legacy_part_id');
  expect(rows).toHaveLength(3);
  expect(rows.slice(0,2).map(x=>x.legacy_part_id)).toEqual([id(11),id(12)]);
  expect(rows[0]).toMatchObject({name:'Клапан',sku:'A-1',unit:'шт',price:'120.00',cost:'70.00'});
  expect(rows[2]).toMatchObject({name:'Шланг',sku:'',unit:'м',price:'90.00',cost:'45.00'});
});

it('keeps staff read access while restricting edits and inserts to dispatch managers',async()=>{
  await db.exec('begin');await as(3);
  expect(await q('select id from stock_catalog')).toHaveLength(3);
  await q("update stock_catalog set price=1 where id=$1",[id(11)]);
  await fails("insert into stock_catalog(name) values('Новая')",[],'row-level security');
  await db.exec('rollback');
  await db.exec('begin');await as(2);
  await q("insert into stock_catalog(name,unit) values('Новая позиция','шт')");
  expect(await q("select count(*)::int n from stock_catalog where name='Новая позиция'")).toEqual([{n:1}]);
  await db.exec('rollback');
});

it('stamps price validity only when catalog values change',async()=>{
  await db.exec('begin');await as(1);
  const before=(await q('select current_since from stock_catalog where legacy_part_id=$1',[id(11)]))[0].current_since;
  await q("update stock_catalog set active=false where legacy_part_id=$1",[id(11)]);
  expect((await q('select current_since from stock_catalog where legacy_part_id=$1',[id(11)]))[0].current_since).toEqual(before);
  await q("update stock_catalog set cost=cost+5 where legacy_part_id=$1",[id(11)]);
  expect((await q('select current_since from stock_catalog where legacy_part_id=$1',[id(11)]))[0].current_since).not.toEqual(before);
  await db.exec('rollback');
});
