import { beforeAll, afterAll, beforeEach, afterEach, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const file = p => readFileSync(new URL(p, import.meta.url), 'utf8');
let db;
const q = async (sql, args=[]) => (await db.query(sql,args)).rows;
const as = async (id, role='authenticated') => {
  await q("select set_config('test.uid',$1,true)",[id ? uuid(id) : '']);
  await db.exec(`set local role ${role}`);
};
beforeAll(async () => {
  db = new PGlite();
  await db.exec(file('./fixtures/trip-workbench-base.sql'));
  await db.exec(`
    alter table clients add deleted_at timestamptz;
    create table equipment(id uuid,client_id uuid,deleted_at timestamptz);
    alter table settings add ors_proxy text;
    create view settings_public as select id,ors_proxy from settings;
    alter table settings enable row level security;
    grant select,update on settings to authenticated;
    create policy settings_mgr on settings to authenticated using (user_role() in ('admin','logist')) with check (user_role() in ('admin','logist'));
    grant all on settings_public to authenticated;
    grant update(ors_proxy),insert(ors_proxy) on settings_public to authenticated;
    create table vehicles(id uuid primary key,odometer numeric);
    create table vehicle_odometer_log(vehicle_id uuid,value_km numeric,previous_km numeric,note text,created_by uuid);
    create table vehicle_state(vehicle_id uuid,trip_id uuid);
    create table trip_tracking_sessions(id uuid default gen_random_uuid(),trip_id uuid unique,vehicle_id uuid,depot_id uuid,
      state text,planned_start_at timestamptz,capture_from timestamptz,actual_started_at timestamptz,start_source text,updated_at timestamptz);
    create table trip_tracking_points(session_id uuid,vehicle_id uuid,ts timestamptz,lat float8,lng float8,speed numeric,status text);
    create table trip_reschedules(trip_id uuid,status text,dec_at timestamptz);
    create function trip_planned_start_at(trips) returns timestamptz language sql as $$select $1.date_from::timestamptz$$;
    create function trip_fact_km(uuid) returns numeric language sql as $$select 42::numeric$$;
  `);
  await db.exec(file('./fixtures/trip-access-before.sql'));
  await db.exec(file('../supabase/migrations/20260921191539_trip_access_guards.sql'));
  await q("insert into profiles values($1,'admin',true),($2,'logist',true),($3,'engineer',true),($4,'admin',false),($5,'engineer',false)",[1,2,3,4,5].map(uuid));
},30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => {
  await db.exec('begin');
  await q("insert into trips(id,lead_engineer,engineer_ids,status,date_from) values($1,$2,$3,'assigned','2026-09-21')",[uuid(10),uuid(3),[uuid(3)]]);
  await q('insert into vehicle_positions values(1,$1,now(),50,30)',[uuid(10)]);
  await q('insert into vehicles values($1,100)',[uuid(20)]);
  await q("insert into clients(id,name) values($1,'Test object')",[uuid(30)]);
});
afterEach(async () => { await db.exec('rollback'); });

const managerCalls = [
  ['soft_delete_client','select soft_delete_client($1)',[uuid(30)]],
  ['restore_deleted','select restore_deleted($1)',['2026-09-21T10:00:00Z']],
  ['trash_restore',"select trash_restore('trips',$1)",[uuid(10)]],
  ['trash_delete_forever',"select trash_delete_forever('trips',$1)",[uuid(10)]],
  ['trip_tracking_cancel','select trip_tracking_cancel($1)',[uuid(10)]],
  ['trip_tracking_reassign','select trip_tracking_reassign($1,$2)',[uuid(10),uuid(11)]],
  ['vehicle_odometer_set','select vehicle_odometer_set($1,200,null)',[uuid(20)]],
];
describe.sequential('closed access to legacy trip operations', () => {
  it.each([1,2,3])('preserves settings reads and denies view writes for profile %s',async id => {
    await as(id);
    expect(await q('select * from settings_public')).toHaveLength(1);
    await expect(q("update settings_public set ors_proxy='https://attacker.test' where id=true")).rejects.toThrow('permission denied');
  });
  it('revokes both table and independent column grants',async () => {
    const [p]=await q(`select has_table_privilege('authenticated','settings_public','INSERT') ins,
      has_table_privilege('authenticated','settings_public','DELETE') del,
      has_column_privilege('authenticated','settings_public','ors_proxy','UPDATE') upd,
      has_column_privilege('authenticated','settings_public','ors_proxy','INSERT') col_ins`);
    expect(p).toEqual({ins:false,del:false,upd:false,col_ins:false});
  });
  it.each(managerCalls)('denies inactive administrator in %s',async (_name,sql,args) => {
    await as(4);
    await expect(q(sql,args)).rejects.toThrow('Недостаточно прав');
  });
  it.each(managerCalls)('denies missing profile in %s',async (_name,sql,args) => {
    await as(99);
    await expect(q(sql,args)).rejects.toThrow('Недостаточно прав');
  });
  it.each(managerCalls)('denies engineer in %s',async (_name,sql,args) => {
    await as(3);
    await expect(q(sql,args)).rejects.toThrow('Недостаточно прав');
  });
  it.each(managerCalls)('denies anonymous execution of %s',async (_name,sql,args) => {
    await as(null,'anon');
    await expect(q(sql,args)).rejects.toThrow('permission denied');
  });
  it.each([1,2])('allows active manager %s to change odometer, restore and soft-delete',async id => {
    await as(id);
    expect((await q('select vehicle_odometer_set($1,200,null) value',[uuid(20)]))[0].value).toBe('200.0');
    const [{ts}]=await q('select soft_delete_client($1) ts',[uuid(30)]);
    await q('select restore_deleted($1)',[ts]);
    await q("select trash_restore('trips',$1)",[uuid(10)]);
    expect((await q('select trip_tracking_cancel($1) state',[uuid(10)]))[0].state).toBe('not_found');
    expect((await q('select trip_tracking_reassign($1,$2) state',[uuid(10),uuid(11)]))[0].state).toBe('not_found');
  });
  it('does not erase a live trip track through permanent deletion',async () => {
    await as(1);
    await db.exec('savepoint attempt');
    await expect(q("select trash_delete_forever('trips',$1)",[uuid(10)])).rejects.toThrow('не находится в корзине');
    await db.exec('rollback to savepoint attempt; reset role');
    expect(await q('select * from vehicle_positions')).toHaveLength(1);
    expect(await q('select * from trips')).toHaveLength(1);
  });
  it('still deletes a discarded trip and its track for a manager',async () => {
    await q('update trips set deleted_at=now() where id=$1',[uuid(10)]);
    await as(2);
    await q("select trash_delete_forever('trips',$1)",[uuid(10)]);
    await db.exec('reset role');
    expect(await q('select * from trips')).toHaveLength(0);
    expect(await q('select * from vehicle_positions')).toHaveLength(0);
  });
  it('requires an active owner even when auth.uid matches',async () => {
    await as(5);
    expect((await q('select is_owner_or_mgr($1) allowed',[uuid(5)]))[0].allowed).toBe(false);
  });
  it.each(['trip_start','trip_finish'])('denies inactive team member through %s',async fn => {
    await q("update trips set lead_engineer=$1,engineer_ids=$2,status='in_progress' where id=$3",[uuid(5),[uuid(5)],uuid(10)]);
    await as(5);
    await expect(q(`select ${fn}($1)`,[uuid(10)])).rejects.toThrow('Это не ваш выезд');
  });
  it.each(['trip_start','trip_finish'])('denies a foreign trip with NULL crew through %s',async fn => {
    await q('update trips set lead_engineer=null,engineer_ids=null where id=$1',[uuid(10)]);
    await as(3);
    await expect(q(`select ${fn}($1)`,[uuid(10)])).rejects.toThrow('Это не ваш выезд');
  });
  it('allows the active second engineer to start and finish',async () => {
    await q('update trips set lead_engineer=null where id=$1',[uuid(10)]);
    await as(3);
    expect((await q('select trip_start($1) state',[uuid(10)]))[0].state).toBe('started');
    expect((await q('select trip_finish($1) state',[uuid(10)]))[0].state).toBe('finished');
  });
});
