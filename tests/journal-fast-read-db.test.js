import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const file=p=>readFileSync(new URL(p,import.meta.url),'utf8');
it('reads a complete journal snapshot without revision history and preserves responsibility and anonymous boundaries',async()=>{
 const db=new PGlite();try{
  await db.exec(file('./fixtures/trip-workbench-base.sql'));await db.exec(file('../supabase/migrations/20260921133835_trip_workbench.sql'));
  await db.exec(`create schema if not exists dlight_private;grant usage on schema dlight_private to authenticated;
    alter table trips add column owner_id uuid;
    create function dlight_private.responsibility_manager(kind text,entity uuid) returns boolean language sql stable security definer set search_path='' as $$ select coalesce(public.user_role()='admin' or (public.user_role()='logist' and exists(select 1 from public.trips where id=entity and owner_id=auth.uid())),false) $$;
    insert into profiles(id,role) values('00000000-0000-4000-8000-000000000001','admin'),('00000000-0000-4000-8000-000000000002','logist'),('00000000-0000-4000-8000-000000000003','engineer');
    insert into trips(id,owner_id) values('00000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000000002');
    insert into trip_stays(trip_id,stay_from,stay_to) values('00000000-0000-4000-8000-000000000010','2026-10-21T08:00Z','2026-10-21T09:00Z');
    alter table trip_revision_history rename to unavailable_history;`);
  await db.exec(file('../supabase/migrations/20261022060627_journal_fast_read.sql'));
  const read=async(uid,role='authenticated',trip='00000000-0000-4000-8000-000000000010')=>{await db.query("select set_config('test.uid',$1,false)",[uid]);await db.exec('set role '+role);try{return (await db.query('select public.trip_journal_read($1) value',[trip])).rows[0].value;}finally{await db.exec('reset role');}};
  for(const uid of ['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002']){const data=await read(uid);expect(data.stays).toHaveLength(1);expect(data.history).toEqual([]);expect(data.history_deferred).toBe(true);expect(data.trip.owner_id).toBe('00000000-0000-4000-8000-000000000002');}
  await expect(read('00000000-0000-4000-8000-000000000003')).rejects.toThrow('Доступ только менеджеру');await expect(read('')).rejects.toThrow('Доступ только менеджеру');await expect(read('','anon')).rejects.toThrow('permission denied');await expect(read('00000000-0000-4000-8000-000000000002','authenticated','00000000-0000-4000-8000-000000000099')).rejects.toThrow('Доступ только менеджеру');
 }finally{await db.close();}
},20000);
