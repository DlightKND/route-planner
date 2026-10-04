-- Run on QA after independent_request_task_stages. All fixtures roll back.
begin;
do $check$
declare
 request_id uuid; task_id uuid; client_id uuid; dispatcher uuid; engineer uuid;
 rev integer; failed boolean; parent_state text;
begin
 select id into dispatcher from public.profiles where role='logist' and active=true order by id limit 1;
 select id into engineer from public.profiles where role='engineer' and active=true order by id limit 1;
 select j.client_id into client_id from public.jobs j where j.deleted_at is null and j.client_id is not null order by j.id limit 1;
 if dispatcher is null or engineer is null or client_id is null then raise exception 'Fixture prerequisites missing'; end if;
 perform set_config('request.jwt.claim.sub',dispatcher::text,true);
 insert into public.jobs(client_id,status,notes) values(client_id,'open','UX stage gate rollback check') returning id into request_id;
 task_id:=public.service_order_save_one(null,null,jsonb_build_object('title','UX stage gate rollback check','work_mode','depot','date_from',current_date,'date_to',current_date,'engineer_ids',jsonb_build_array(engineer),'lead_engineer',engineer),request_id,jsonb_build_array(jsonb_build_object('job_id',request_id,'kind','work','title','Synthetic work','planned_qty',1,'unit','ч')));
 select revision into rev from public.service_orders where id=task_id;
 perform set_config('role','authenticated',true);
 rev:=public.service_order_transition(task_id,rev,'assigned','QA назначение');
 perform set_config('request.jwt.claim.sub',engineer::text,true);
 failed:=false;
 begin
   perform public.service_order_transition(task_id,rev,'in_progress','');
 exception when others then
   if position('Сначала подготовь заявку' in sqlerrm)=0 then raise; end if;
   failed:=true;
 end;
 if not failed then raise exception 'Open request unexpectedly started'; end if;
 if (select revision from public.service_orders where id=task_id)<>rev or (select status from public.service_orders where id=task_id)<>'assigned' then raise exception 'Rejected start changed task'; end if;
 perform set_config('role','none',true);
 perform set_config('request.jwt.claim.sub',dispatcher::text,true);
 update public.jobs set status='planned' where id=request_id;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claim.sub',engineer::text,true);
 rev:=public.service_order_transition(task_id,rev,'in_progress','');
 if (select status from public.jobs where id=request_id)<>'planned' then raise exception 'Task start changed parent request'; end if;
 rev:=public.service_order_transition(task_id,rev,'paused','QA pause');
 rev:=public.service_order_transition(task_id,rev,'in_progress','');
 perform set_config('role','none',true);
 perform set_config('request.jwt.claim.sub',dispatcher::text,true);
 update public.jobs set status='in_progress' where id=request_id;
 perform set_config('role','authenticated',true);
 perform set_config('request.jwt.claim.sub',engineer::text,true);
 rev:=public.service_order_transition(task_id,rev,'paused','QA pause');
 rev:=public.service_order_transition(task_id,rev,'in_progress','');
 if (select status from public.jobs where id=request_id)<>'in_progress' then raise exception 'Task resume changed parent'; end if;
 rev:=public.service_order_transition(task_id,rev,'paused','QA pause');
 perform set_config('role','none',true);
 perform set_config('request.jwt.claim.sub',dispatcher::text,true);
 foreach parent_state in array array['done','cancelled'] loop
   update public.jobs set status=parent_state::public.job_status where id=request_id;
   perform set_config('role','authenticated',true);
   perform set_config('request.jwt.claim.sub',engineer::text,true);
   failed:=false;
   begin
     perform public.service_order_transition(task_id,rev,'in_progress','');
   exception when others then
     if position('Завершённая или отменённая заявка' in sqlerrm)=0 then raise; end if;
     failed:=true;
   end;
   if not failed then raise exception 'Closed request unexpectedly started'; end if;
   perform set_config('role','none',true);
   perform set_config('request.jwt.claim.sub',dispatcher::text,true);
 end loop;
 perform set_config('ux.stage_gate_verified','true',true);
end $check$;
select current_setting('ux.stage_gate_verified')::boolean as verified;
rollback;
