import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';

const id=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
let db;const q=async(s,a=[])=>(await db.query(s,a)).rows;
const as=async n=>{await q("select set_config('test.uid',$1,true)",[n?id(n):'']);await db.exec('set local role authenticated');};
const plan={title:'Проверка',work_mode:'onsite',engineer_ids:[id(3)],lead_engineer:id(3),instructions:''};

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(file('./fixtures/trip-workbench-base.sql'));
  await db.exec("alter table jobs add column status text not null default 'open'; grant select,update on jobs to authenticated; grant select on trips to authenticated; create table trip_revision_history(id bigint generated always as identity primary key,trip_id uuid,revision integer,recorded_at timestamptz default now(),actor_id uuid,reason text,snapshot jsonb); alter table trip_revision_history enable row level security; revoke all on trip_revision_history from public,anon,authenticated; grant select on trip_revision_history to authenticated; create policy trip_history_manager on trip_revision_history for select to authenticated using (user_role() in ('admin','logist')); create schema dlight_private;");
  await db.exec("alter function job_point(uuid) set search_path=public");
  await db.exec(file('../supabase/migrations/20260922190447_service_orders.sql'));
  await db.exec(file('../supabase/migrations/20260923212724_entity_activity_comments.sql'));
},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{
  await db.exec('begin');
  await q("insert into profiles values($1,'admin',true),($2,'engineer',true),($3,'engineer',true)",[1,3,4].map(id));
  await q("insert into clients values($1,'Клиент',50,30)",[id(20)]);
  await q('insert into jobs(id,client_id) values($1,$2)',[id(10),id(20)]);
  await q("insert into trips(id,lead_engineer,engineer_ids,status) values($1,$2,$3,'assigned')",[id(30),id(3),[id(3)]]);
});
afterEach(async()=>{await db.exec('rollback');});

it('records request creation and changed fields in a timeline',async()=>{
  const history=await q('select event,changed_fields,snapshot from job_history where job_id=$1 order by id',[id(10)]);
  expect(history).toHaveLength(1);
  expect(history[0].event).toBe('Создана заявка');
  await as(1);
  await q("update jobs set status='planned' where id=$1",[id(10)]);
  const [change]=await q('select event,changed_fields from job_history where job_id=$1 order by id desc limit 1',[id(10)]);
  expect(change.event).toBe('Статус: open → planned');
  expect(change.changed_fields.status).toEqual({from:'open',to:'planned'});
});

it('stamps comments with the authenticated author and current database time',async()=>{
  await as(3);
  const old='2000-01-01T00:00:00Z';
  const [comment]=await q('insert into trip_comments(trip_id,author_id,created_at,body) values($1,$2,$3,$4) returning author_id,created_at,body',[id(30),id(4),old,'  На объекте  ']);
  expect(comment.author_id).toBe(id(3));
  expect(comment.body).toBe('На объекте');
  expect(new Date(comment.created_at).getUTCFullYear()).toBeGreaterThan(2020);
  await expect(q("update trip_comments set body='изменено' where trip_id=$1",[id(30)])).rejects.toThrow(/permission denied/);
});

it('limits task and trip comments and trip history to assigned engineers',async()=>{
  await as(1);
  const order=(await q('select service_order_save(null,null,$1,$2,$3) id',[plan,[id(10)],[]]))[0].id;
  await db.exec('reset role');
  await as(3);
  expect(await q('select * from trip_comments where trip_id=$1',[id(30)])).toHaveLength(0);
  expect(await q('select * from trip_revision_history where trip_id=$1',[id(30)])).toHaveLength(0);
  await q("insert into trip_comments(trip_id,body) values($1,'Доступ есть')",[id(30)]);
  await q("insert into service_order_comments(order_id,body) values($1,'Задание принято')",[order]);
  expect(await q('select * from service_order_comments where order_id=$1',[order])).toHaveLength(1);
  await db.exec('reset role');
  await as(4);
  await expect(q("insert into service_order_comments(order_id,body) values($1,'Нет доступа')",[order])).rejects.toThrow();
});
