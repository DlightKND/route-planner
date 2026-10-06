import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db;const q=async(sql,args=[])=> (await db.query(sql,args)).rows;
const as=async(n,role='authenticated')=>{await q("select set_config('test.uid',$1,true)",[n?id(n):'']);await db.exec('set local role '+role);};
const read=async ids=>(await q('select public.legacy_personal_schedule_read($1::uuid[]) data',[ids]))[0].data;
beforeAll(async()=>{
 db=new PGlite();await db.exec(readFileSync(new URL('./fixtures/trip-workbench-base.sql',import.meta.url),'utf8'));
 await db.exec("create schema dlight_private; grant usage on schema dlight_private to authenticated; alter table trips add column day_plan jsonb; create table service_orders(id uuid primary key,legacy_trip_id uuid); alter table trips enable row level security; grant select,update on trips to authenticated; create policy trips_read on trips for select to authenticated using(lead_engineer=auth.uid() or auth.uid()=any(engineer_ids));");
 await db.exec(readFileSync(new URL('../supabase/migrations/20261006060446_legacy_personal_schedule_read.sql',import.meta.url),'utf8'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
 await db.exec('begin');
 await q("insert into profiles values($1,'engineer',true),($2,'engineer',true),($3,'engineer',false),($4,'admin',true)",[id(1),id(2),id(3),id(4)]);
 await q("insert into jobs(id,assigned_engineer) values($1,$2),($3,$4)",[id(11),id(1),id(12),id(2)]);
 for(const n of [21,22,23,24]){
  await q("insert into trips(id,status,date_from,day_plan,route_stops,econ_snapshot) values($1,'done','2026-09-21',$2,$3,$4)",[id(n),{start:{d:'2026-09-21',t:7}},[{type:'job',lat:50,lng:30,name:'private contact',phone:'private phone'}],{driveH:4,revenue:100000,cost:50000,legs:[{a:'50,30',b:'51,31',h:2,km:100,cost:999}]}]);
  await q('insert into service_orders values($1,$2)',[id(n+100),id(n)]);
  await q('insert into trip_jobs values($1,$2,0)',[id(n),n===22?id(12):id(11)]);
 }
 await q("update trips set engineer_ids=array[$1]::uuid[] where id=$2",[id(2),id(23)]);
 await q("update trips set status='planned' where id=$1",[id(24)]);
});
afterEach(async()=>{await db.exec('rollback');});
it('returns the assigned engineer’s completed legacy schedule while keeping normal trip RLS and finances closed',async()=>{
 await as(1);expect(await q('select id from trips')).toEqual([]);
 const rows=await read([id(21),id(22),id(23),id(24)]);expect(rows.map(x=>x.id)).toEqual([id(21)]);
 expect(rows[0].engineer_ids).toEqual([]);expect(rows[0].lead_engineer).toBeNull();expect(rows[0].schedule_only).toBe(true);
 expect(rows[0].econ_snapshot).toEqual({driveH:4,legs:[{a:'50,30',b:'51,31',h:2}]});
 expect(rows[0].route_stops).toEqual([{type:'job',lat:50,lng:30}]);
 expect(JSON.stringify(rows)).not.toMatch(/revenue|cost|phone|private contact/);
 expect(await q('update trips set day_plan=null where id=$1 returning id',[id(21)])).toEqual([]);
});
it('does not expose unrequested, deleted, unarchived or reassigned-request trips',async()=>{
 expect(await read([])).toEqual([]);
 await q('update trips set deleted_at=now() where id=$1',[id(21)]);await as(1);expect(await read([id(21)])).toEqual([]);
 await db.exec('reset role');await q('update trips set deleted_at=null where id=$1',[id(21)]);await q('delete from service_orders where legacy_trip_id=$1',[id(21)]);
 await as(1);expect(await read([id(21)])).toEqual([]);
});
it.each([null,3,4])('returns no supplemental schedule for anonymous identity, inactive staff or manager (%s)',async n=>{
 await as(n);expect(await read([id(21),id(22)])).toEqual([]);
});
it('denies the RPC to the anon database role',async()=>{
 await as(null,'anon');await expect(read([id(21)])).rejects.toThrow('permission denied');
});
