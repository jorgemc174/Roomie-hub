-- Los cambios hechos en "Configurar tareas" (nombre, dificultad, plazo) deben verse
-- también en las instancias abiertas del periodo en curso, no solo en las futuras.
-- Nunca reescribir migraciones anteriores: se redefine la función del trigger aquí.
begin;
 
create or replace function public.invalidate_chore_future() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if row(new.name,new.description,new.difficulty,new.active,new.recurrence,new.interval_count,new.anchor_date,new.assignment_mode,new.deadline_days,new.deadline_time,new.deadline_timezone)
 is distinct from row(old.name,old.description,old.difficulty,old.active,old.recurrence,old.interval_count,old.anchor_date,old.assignment_mode,old.deadline_days,old.deadline_time,old.deadline_timezone) then
  perform 1 from public.homes where id=new.home_id for update;
  perform public.cancel_future_chores(new.home_id,new.id,'definition_changed',public.home_local_date(new.home_id));
  -- Instancias abiertas que ya empezaron (periodo en curso): sincronizar sus copias.
  -- Las completadas y canceladas son histórico y no se tocan.
  update public.chore_instances set
   task_name=new.name,
   difficulty=new.difficulty,
   deadline_at=case when new.deadline_days is null then null
    else (period_start+new.deadline_days+new.deadline_time) at time zone new.deadline_timezone end,
   updated_at=now()
  where chore_id=new.id and completed_at is null and cancelled_at is null
   and (task_name,difficulty,deadline_at) is distinct from (new.name,new.difficulty,
    case when new.deadline_days is null then null
     else (period_start+new.deadline_days+new.deadline_time) at time zone new.deadline_timezone end);
 end if;
 return new;
end $$;
 
-- Reparar instancias abiertas que ya quedaron desincronizadas antes de esta migración.
update public.chore_instances i set task_name=c.name,difficulty=c.difficulty,updated_at=now()
from public.chores c
where c.id=i.chore_id and i.completed_at is null and i.cancelled_at is null
 and (i.task_name,i.difficulty) is distinct from (c.name,c.difficulty);
 
revoke all on function public.invalidate_chore_future() from public,anon,authenticated;
commit;