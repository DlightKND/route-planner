import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
let db, tid;
const query = async (sql,args=[]) => (await db.query(sql,args)).rows;
const revision = async () => (await query('select workbench_revision from trips where id=$1',[tid]))[0].workbench_revision;
const save = async (patch,ids,rev,reason='Изменение плана') => query('select trip_plan_save($1,$2,$3,$4,$5) id',[tid,rev??await revision(),patch,ids,reason]);
beforeAll(async()=>{
  db = new PGlite();
  await db.exec(readFileSync(new URL('./fixtures/trip-workbench-base.sql',import.meta.url),'utf8'));
  await db.exec(readFileSync(new URL('../supabase/migrations/20260921133835_trip_workbench.sql',import.meta.url),'utf8'));
  await query("insert into profiles values($1,'admin',true),($2,'engineer',true),($3,'admin',false)",[uuid(1),uuid(2),uuid(3)]);
  await query("select set_config('test.uid',$1,false)",[uuid(1)]);
  await query("insert into clients values($1,'Объект А',50,30),($2,'Объект Б',51,31)",[uuid(10),uuid(11)]);
  await query('insert into jobs(id,client_id) values($1,$2),($3,$4)',[uuid(20),uuid(10),uuid(21),uuid(11)]);
  const rows=await query("select trip_plan_save(null,0,$1,$2,'Создание') id",[{status:'assigned',engineer_ids:[uuid(2)],main_job_id:uuid(20),econ_snapshot:{km:240},route_stops:[{name:'А',lat:50,lng:30}]},[uuid(20),uuid(21)]]);
  tid=rows[0].id;
},30000);
afterAll(async()=>{await db?.close();});

describe.sequential('transactional trip workbench migration',()=>{
  it('stores a dispatch baseline after all job links exist',async()=>{
    const [t]=await query('select * from trips where id=$1',[tid]);
    expect(t.plan_baseline.source).toBe('before_execution');
    expect(t.plan_baseline.plan.job_ids).toHaveLength(2);
    expect(t.main_job_id).toBe(uuid(20));
  });
  it('removes a planned job without deleting attendance or GPS; restores main job last',async()=>{
    await query("update trips set started_at=now(),status='in_progress',fact_km=120 where id=$1",[tid]);
    await query("insert into trip_stays(id,trip_id,job_id,stay_from,stay_to,minutes_raw) values($1,$2,$3,'2026-09-21 09:00Z','2026-09-21 12:00Z',180)",[uuid(30),tid,uuid(21)]);
    await query('insert into vehicle_positions values(1,$1,now(),50,30)',[tid]);
    await save({main_job_id:uuid(20),notes:'Б отменена'},[uuid(20)]);
    expect((await query('select fact_km,main_job_id from trips where id=$1',[tid]))[0]).toEqual({fact_km:'120',main_job_id:uuid(20)});
    expect(await query('select * from vehicle_positions')).toHaveLength(1);
    expect((await query('select job_id from trip_stays'))[0].job_id).toBe(uuid(21));
    expect(await query('select * from trip_job_history where trip_id=$1',[tid])).toHaveLength(1);
  });
  it('rejects stale edits without changing current data',async()=>{
    const rev=await revision();await save({notes:'Новое'},[uuid(20)],rev);
    await expect(save({notes:'Старое'},[uuid(20),uuid(21)],rev)).rejects.toThrow('другой вкладке');
    expect((await query('select notes from trips where id=$1',[tid]))[0].notes).toBe('Новое');
  });
  it('rolls back a bad job list and rejects factual fields in the plan API',async()=>{
    const rev=await revision();
    await expect(save({notes:'Потерять'},[uuid(999)])).rejects.toThrow('Недоступная');
    await expect(save({fact_km:0},[uuid(20)])).rejects.toThrow('не относится');
    expect(await revision()).toBe(rev);
  });
  it('does not reassign old presence to a new team',async()=>{
    const before=(await query('select crew_ids from trip_stays where id=$1',[uuid(30)]))[0];
    await save({engineer_ids:[uuid(1)]},[uuid(20)]);
    expect((await query('select crew_ids from trip_stays where id=$1',[uuid(30)]))[0]).toEqual(before);
  });
  it('allows manager to verify presence at an excluded job',async()=>{
    await query('select trip_presence_save($1,$2,$3,$4)',[tid,await revision(),[{id:uuid(30),job_id:uuid(21),crew_ids:[uuid(1),uuid(2)],minutes_mgr:180,status:'approved'}],'Присутствовали вдвоём']);
    expect((await query('select crew_ids,minutes_mgr,crew_source from trip_stays where id=$1',[uuid(30)]))[0]).toMatchObject({crew_ids:[uuid(1),uuid(2)],minutes_mgr:'180',crew_source:'manager'});
  });
  it('refreshing detector preserves approved attendance',async()=>{
    await query("insert into trip_stays_raw values($1,'2026-09-21 09:00Z','2026-09-21 12:10Z',51,31)",[tid]);
    await query('select trip_presence_detect($1,$2)',[tid,await revision()]);
    expect((await query('select minutes_mgr,status from trip_stays where id=$1',[uuid(30)]))[0]).toEqual({minutes_mgr:'180',status:'approved'});
  });
  it('server totals count people, including presence at removed jobs',async()=>{
    expect((await query('select trip_fact_hours($1) hours',[tid]))[0].hours).toBe('6.00');
    expect((await query('select * from trip_fact_hours_by_job($1)',[tid]))[0]).toEqual({job_id:uuid(21),hours:'6.00'});
  });
  it('plan updates do not replace recorded economics of a started trip',async()=>{
    const before=(await query('select econ_snapshot from trips where id=$1',[tid]))[0];
    await save({econ_snapshot:{km:85,revenue:1}},[uuid(20)]);
    const [after]=await query('select econ_snapshot,plan_econ_snapshot from trips where id=$1',[tid]);
    expect(after.econ_snapshot).toEqual(before.econ_snapshot);expect(after.plan_econ_snapshot.km).toBe(85);
  });
  it('rolls back invalid presence and preserves audit count',async()=>{
    const rev=await revision();
    await expect(query('select trip_presence_save($1,$2,$3,$4)',[tid,rev,[{id:uuid(30),job_id:uuid(21),crew_ids:[uuid(2)],minutes_mgr:900,status:'approved'}],'Ошибка'])).rejects.toThrow('длительность');
    expect(await revision()).toBe(rev);
  });
  it('does not present partial attendance as complete fact',async()=>{
    await query("insert into trip_stays(id,trip_id,stay_from,stay_to,minutes_raw) values($1,$2,'2026-09-21 12:10Z','2026-09-21 12:30Z',20)",[uuid(31),tid]);
    expect((await query('select trip_fact_hours($1) hours',[tid]))[0].hours).toBeNull();
    await query('delete from trip_stays where id=$1',[uuid(31)]);
  });
  it('does not break cascade purge of a trip with job links',async()=>{
    const [other]=await query("select trip_plan_save(null,0,'{}',$1,'Новый') id",[[uuid(20)]]);
    await query('delete from trips where id=$1',[other.id]);
    expect(await query('select * from trip_jobs where trip_id=$1',[other.id])).toHaveLength(0);
  });
  it('saves plan and presence together or rolls both back',async()=>{
    const rev=await revision();
    const rows=[{id:uuid(30),job_id:uuid(21),crew_ids:[uuid(1),uuid(2)],minutes_mgr:999,status:'approved'}];
    await expect(query('select trip_plan_save($1,$2,$3,$4,$5,$6)',[tid,rev,{notes:'Не сохранять'},[uuid(20)],'Совместная правка',rows])).rejects.toThrow('длительность');
    expect(await revision()).toBe(rev);
    expect((await query('select notes from trips where id=$1',[tid]))[0].notes).not.toBe('Не сохранять');
    rows[0].minutes_mgr=180;
    await query('select trip_plan_save($1,$2,$3,$4,$5,$6)',[tid,rev,{notes:'Совместно'},[uuid(20)],'Совместная правка',rows]);
    expect((await query('select notes from trips where id=$1',[tid]))[0].notes).toBe('Совместно');
    expect((await query('select note from trip_stays where id=$1',[uuid(30)]))[0].note).toBe('Совместная правка');
  });
  it('denies engineers, inactive managers and anonymous callers',async()=>{
    for(const id of [uuid(2),uuid(3)]){
      await query("select set_config('test.uid',$1,false)",[id]);
      await expect(query('select trip_workbench_read($1)',[tid])).rejects.toThrow('менеджеру');
      await expect(save({},[uuid(20)])).rejects.toThrow('менеджер');
    }
    await query("select set_config('test.uid','',false)");
    await db.exec('set role anon');
    await expect(query('select trip_workbench_read($1)',[tid])).rejects.toThrow('permission denied');
    await db.exec('reset role');await query("select set_config('test.uid',$1,false)",[uuid(1)]);
  });
  it('exposes history read-only under RLS',async()=>{
    await db.exec('set role authenticated');
    expect((await query('select * from trip_revision_history')).length).toBeGreaterThan(0);
    await expect(query("delete from trip_revision_history")).rejects.toThrow('permission denied');
    await db.exec('reset role');
  });
});
