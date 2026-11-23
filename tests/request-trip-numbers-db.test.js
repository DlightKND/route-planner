import {it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
const migration=readFileSync(new URL('../supabase/migrations/20261123160000_request_trip_numbers.sql',import.meta.url),'utf8');
it('numbers existing requests and trips without firing row triggers and keeps numbers immutable',async()=>{
 const db=new PGlite();try{
  await db.exec(`create schema dlight_private;
   create table public.jobs(id uuid primary key default gen_random_uuid(),notes text,created_at timestamptz default now());
   create table public.trips(id uuid primary key default gen_random_uuid(),status text default 'planned',created_at timestamptz default now());
   create table public.service_orders(id uuid primary key,title text);
   create table public.trigger_log(name text);
   create function public.forbid() returns trigger language plpgsql as $$ begin insert into public.trigger_log values(tg_table_name);raise exception 'row trigger fired on %',tg_table_name; end $$;
   create trigger jobs_guard before update on public.jobs for each row execute function public.forbid();
   create trigger trips_guard before update on public.trips for each row execute function public.forbid();
   insert into public.jobs(notes) values('a'),('b');insert into public.trips(status) values('planned'),('done'),('finished');
   create function dlight_private.entity_finance_read(p_scope text,p_id uuid) returns jsonb language sql as $$ select jsonb_build_object('trips',(select jsonb_agg(jsonb_build_object('id',id)) from public.trips),'lines','[]'::jsonb) $$;
   create function dlight_private.finance_planned_road(p_trip uuid) returns jsonb language sql as $$ select '[]'::jsonb $$;
   create function dlight_private.responsibility_manager(kind text,id uuid) returns boolean language sql as $$ select true $$;`);
  await db.exec(migration);
  expect((await db.query('select count(*)::int n from public.trigger_log')).rows[0].n).toBe(0);
  const jobs=(await db.query('select number from public.jobs order by number')).rows.map(r=>Number(r.number));
  expect(jobs).toEqual([1,2]);
  await db.exec(`insert into public.jobs(notes) values('c')`);
  expect(Number((await db.query(`select number from public.jobs where notes='c'`)).rows[0].number)).toBe(3);
  await expect(db.exec(`insert into public.trips(number) values(99)`)).rejects.toThrow();
  const read=(await db.query(`select dlight_private.entity_finance_read_planned_road('trip',gen_random_uuid()) r`)).rows[0].r;
  expect(read.trips.map(t=>Number(t.number)).sort()).toEqual([1,2,3]);
 }finally{await db.close();}
},20000);
