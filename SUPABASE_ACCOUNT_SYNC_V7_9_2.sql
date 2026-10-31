-- Simulador Academy V7.9.2
-- Corrige sincronização multiusuário e salva bancos completos antes do primeiro simulado.
-- Execute todo este arquivo no SQL Editor do Supabase.

begin;

alter table public.question_banks
  add column if not exists snapshot jsonb not null default '{}'::jsonb;

alter table public.question_banks enable row level security;
alter table public.quiz_progress enable row level security;
alter table public.quiz_history enable row level security;

grant select, insert, update, delete on public.question_banks to authenticated;
grant select, insert, update, delete on public.quiz_progress to authenticated;
grant select, insert, update, delete on public.quiz_history to authenticated;

-- Remove políticas antigas dessas três tabelas exclusivas do aplicativo.
-- Assim uma política antiga/restritiva não bloqueia contas recém-criadas.
do $$
declare policy_row record;
begin
  for policy_row in
    select schemaname, tablename, policyname
    from pg_policies
    where schemaname='public'
      and tablename in ('question_banks','quiz_progress','quiz_history')
  loop
    execute format('drop policy if exists %I on %I.%I',
      policy_row.policyname,policy_row.schemaname,policy_row.tablename);
  end loop;
end $$;

create policy "question_banks_owner_all"
on public.question_banks for all to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check ((select auth.uid()) is not null and (select auth.uid()) = user_id);

create policy "quiz_progress_owner_all"
on public.quiz_progress for all to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.question_banks bank
    where bank.id=quiz_progress.bank_id and bank.user_id=(select auth.uid())
  )
);

create policy "quiz_history_owner_all"
on public.quiz_history for all to authenticated
using ((select auth.uid()) is not null and (select auth.uid()) = user_id)
with check (
  (select auth.uid()) is not null
  and (select auth.uid()) = user_id
  and exists (
    select 1 from public.question_banks bank
    where bank.id=quiz_history.bank_id and bank.user_id=(select auth.uid())
  )
);

create index if not exists question_banks_user_id_idx on public.question_banks(user_id);
create index if not exists quiz_progress_user_id_idx on public.quiz_progress(user_id);
create index if not exists quiz_history_user_id_idx on public.quiz_history(user_id);

commit;

-- Diagnóstico: as três linhas devem mostrar rowsecurity = true.
select relname, relrowsecurity
from pg_class
where oid in (
  'public.question_banks'::regclass,
  'public.quiz_progress'::regclass,
  'public.quiz_history'::regclass
)
order by relname;
