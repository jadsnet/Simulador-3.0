-- V7.9.0 — Visitar amigo: contexto completo em modo somente leitura
-- Execute este arquivo uma vez no SQL Editor do Supabase.

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text not null,
  is_discoverable boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.user_profiles add column if not exists daily_goal integer not null default 20;

alter table public.user_profiles enable row level security;

drop policy if exists "profiles_authenticated_read" on public.user_profiles;
create policy "profiles_authenticated_read"
on public.user_profiles for select
to authenticated
using (is_discoverable or user_id = auth.uid());

drop policy if exists "profiles_insert_own" on public.user_profiles;
create policy "profiles_insert_own"
on public.user_profiles for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "profiles_update_own" on public.user_profiles;
create policy "profiles_update_own"
on public.user_profiles for update
to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create or replace function public.sync_user_public_profile()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.user_profiles(user_id,email,display_name)
  values (
    new.id,
    coalesce(new.email,'usuario@sem-email.local'),
    coalesce(nullif(new.raw_user_meta_data->>'display_name',''), split_part(coalesce(new.email,'Usuário'),'@',1))
  )
  on conflict (user_id) do update
  set email=excluded.email,
      display_name=coalesce(nullif(public.user_profiles.display_name,''),excluded.display_name),
      updated_at=now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_public_profile on auth.users;
create trigger on_auth_user_public_profile
after insert or update of email on auth.users
for each row execute function public.sync_user_public_profile();

insert into public.user_profiles(user_id,email,display_name)
select id,coalesce(email,'usuario@sem-email.local'),
       coalesce(nullif(raw_user_meta_data->>'display_name',''),split_part(coalesce(email,'Usuário'),'@',1))
from auth.users
on conflict (user_id) do update
set email=excluded.email,updated_at=now();

create or replace function public.get_friend_progress_summary(target_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  visitor_id uuid := auth.uid();
  target_profile public.user_profiles%rowtype;
  totals jsonb;
  active_progress jsonb;
  recent_history jsonb;
  bank_library jsonb;
  study_days jsonb;
begin
  if visitor_id is null then
    raise exception 'Usuário não autenticado.';
  end if;

  select * into target_profile
  from public.user_profiles
  where user_id=target_user_id
    and (is_discoverable or user_id=visitor_id);

  if not found then
    raise exception 'Perfil não encontrado ou indisponível para visita.';
  end if;

  select jsonb_build_object(
    'simulations',count(*),
    'answered',coalesce(sum(answered_questions),0),
    'correct',coalesce(sum(correct_answers),0),
    'accuracy',case when coalesce(sum(answered_questions),0)>0
      then round(coalesce(sum(correct_answers),0)::numeric*100/coalesce(sum(answered_questions),1))
      else 0 end,
    'studySeconds',coalesce(sum(elapsed_seconds),0),
    'lastActivity',max(finished_at)
  ) into totals
  from public.quiz_history
  where user_id=target_user_id;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'bankName',bank_name,
      'answered',answered_count,
      'total',question_count,
      'percent',case when question_count>0 then round(answered_count::numeric*100/question_count) else 0 end,
      'savedAt',saved_at
    ) order by saved_at desc
  ),'[]'::jsonb) into active_progress
  from (
    select coalesce(qb.name,'Banco de questões') bank_name,
      (select count(*) from jsonb_object_keys(coalesce(qp.answers,'{}'::jsonb))) answered_count,
      jsonb_array_length(coalesce(qp.question_order,'[]'::jsonb)) question_count,
      coalesce(qp.client_updated_at,qp.updated_at) saved_at
    from public.quiz_progress qp
    left join public.question_banks qb on qb.id=qp.bank_id
    where qp.user_id=target_user_id
    order by coalesce(qp.client_updated_at,qp.updated_at) desc
    limit 50
  ) progress_rows;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'bankName',bank_name,
      'historyId',history_id,
      'score',score,
      'correct',correct_answers,
      'total',total_questions,
      'studySeconds',elapsed_seconds,
      'finishedAt',finished_at,
      'reviewData',review_data,
      'answerAudit',answer_audit,
      'bankSignature',bank_signature
    ) order by finished_at desc
  ),'[]'::jsonb) into recent_history
  from (
    select id history_id,coalesce(bank_name,'Banco de questões') bank_name,score,correct_answers,
      total_questions,elapsed_seconds,finished_at,
      coalesce(answers->'reviewData','[]'::jsonb) review_data,
      coalesce(answers->'answerAudit','[]'::jsonb) answer_audit,
      coalesce(answers->>'bankSignature','') bank_signature
    from public.quiz_history
    where user_id=target_user_id
    order by finished_at desc
  ) history_rows;

  select coalesce(jsonb_agg(jsonb_build_object(
    'name',coalesce(name,'Banco de questões'),
    'questionCount',coalesce(question_count,0),
    'updatedAt',updated_at,
    'localBankId',local_bank_id
  ) order by updated_at desc),'[]'::jsonb) into bank_library
  from public.question_banks where user_id=target_user_id;

  select coalesce(jsonb_agg(day_key order by day_key),'[]'::jsonb) into study_days
  from (select distinct finished_at::date::text day_key from public.quiz_history where user_id=target_user_id) days;

  return jsonb_build_object(
    'profile',jsonb_build_object(
      'userId',target_profile.user_id,
      'displayName',target_profile.display_name,
      'email',target_profile.email,
      'dailyGoal',target_profile.daily_goal,
      'createdAt',target_profile.created_at
    ),
    'totals',coalesce(totals,'{}'::jsonb),
    'progress',active_progress,
    'recentHistory',recent_history,
    'banks',bank_library,
    'studyDays',study_days,
    'readOnly',true
  );
end;
$$;

revoke all on function public.get_friend_progress_summary(uuid) from public;
grant execute on function public.get_friend_progress_summary(uuid) to authenticated;
grant select,insert,update on public.user_profiles to authenticated;
