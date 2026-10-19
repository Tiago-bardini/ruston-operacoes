-- =====================================================================
-- eKyte — Visão Gerencial
-- Apontamentos reais (GET /v1.0/time-trackings) + views de apoio da aba
-- "Visão Gerencial" em /ekyte.
--
-- Aplicar no SQL Editor do Supabase ANTES do deploy da rota nova de
-- /api/ekyte-sync (ela grava em ruston_ekyte_apontamentos e nas colunas
-- novas de ruston_ekyte_sync_log).
-- Idempotente: pode rodar mais de uma vez.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1) Log do sync: colunas novas
-- ---------------------------------------------------------------------
alter table public.ruston_ekyte_sync_log
  add column if not exists modo text,
  add column if not exists apontamentos_upserted integer not null default 0;

-- ---------------------------------------------------------------------
-- 2) Apontamentos (time-trackings do eKyte)
--    minutos = effort; data = dia do apontamento (startDate, senão createdIn)
-- ---------------------------------------------------------------------
create table if not exists public.ruston_ekyte_apontamentos (
  id            bigint primary key,
  task_id       bigint,
  task_title    text,
  executor_id   text,
  executor      text,
  workspace_id  text,
  workspace     text,
  phase         text,
  status        text,
  comment       text,
  data          date,
  start_date    timestamptz,
  end_date      timestamptz,
  created_in    timestamptz,
  minutos       integer not null default 0,
  payload_raw   jsonb,
  synced_at     timestamptz not null default now()
);

create index if not exists ruston_ekyte_apontamentos_data_idx     on public.ruston_ekyte_apontamentos (data);
create index if not exists ruston_ekyte_apontamentos_executor_idx on public.ruston_ekyte_apontamentos (executor_id);
create index if not exists ruston_ekyte_apontamentos_task_idx     on public.ruston_ekyte_apontamentos (task_id);

alter table public.ruston_ekyte_apontamentos enable row level security;
drop policy if exists "apontamentos leitura autenticados" on public.ruston_ekyte_apontamentos;
create policy "apontamentos leitura autenticados"
  on public.ruston_ekyte_apontamentos for select
  to authenticated using (true);
-- Escrita só pela service role (rota /api/ekyte-sync), que ignora RLS.

-- ---------------------------------------------------------------------
-- 3) De-para executor do eKyte → pessoa Ruston
--    Reaproveita o vínculo já feito nas tasks (fn_ekyte_match_pessoas)
--    e o mapeamento manual da aba "Vínculos".
-- ---------------------------------------------------------------------
create or replace view public.vw_ekyte_executor_pessoa
with (security_invoker = on) as
select distinct on (executor_id) executor_id, pessoa_id
from (
  select m.ekyte_executor_id::text as executor_id, m.pessoa_id, 0 as prioridade
  from public.ruston_ekyte_mapping_pessoa m
  where m.ekyte_executor_id is not null and m.pessoa_id is not null
  union all
  select t.executor_id::text, t.pessoa_id, 1
  from public.ruston_ekyte_tasks_dashboard t
  where t.executor_id is not null and t.pessoa_id is not null
) x
order by executor_id, prioridade;

-- ---------------------------------------------------------------------
-- 4) Apontamentos já vinculados a pessoa e cliente
-- ---------------------------------------------------------------------
create or replace view public.ruston_ekyte_apontamentos_dashboard
with (security_invoker = on) as
select
  a.id,
  a.data,
  a.minutos,
  a.task_id,
  a.task_title,
  a.executor_id,
  a.executor,
  a.workspace,
  ep.pessoa_id,
  t.cliente_id
from public.ruston_ekyte_apontamentos a
left join public.vw_ekyte_executor_pessoa ep on ep.executor_id = a.executor_id
left join public.ruston_ekyte_tasks_dashboard t on t.id = a.task_id;

-- ---------------------------------------------------------------------
-- 5) Apontamento semanal: TODAS as pessoas ativas × últimas 12 semanas
--    (semana = segunda-feira). Quem não apontou aparece com 0.
-- ---------------------------------------------------------------------
create or replace view public.vw_ekyte_apontamento_semanal
with (security_invoker = on) as
with semanas as (
  select generate_series(
    date_trunc('week', current_date)::date - interval '11 weeks',
    date_trunc('week', current_date)::date,
    interval '1 week'
  )::date as semana
),
horas as (
  select pessoa_id, date_trunc('week', data)::date as semana, sum(minutos)::int as minutos
  from public.ruston_ekyte_apontamentos_dashboard
  where pessoa_id is not null
    and data >= date_trunc('week', current_date)::date - interval '11 weeks'
  group by 1, 2
)
select
  p.id as pessoa_id,
  p.nome as pessoa_nome,
  p.squad_id,
  s.semana,
  coalesce(h.minutos, 0) as minutos
from public.ruston_pessoas p
cross join semanas s
left join horas h on h.pessoa_id = p.id and h.semana = s.semana
where p.ativo;

-- ---------------------------------------------------------------------
-- 6) Último apontamento por pessoa ativa (null = nunca apontou)
-- ---------------------------------------------------------------------
create or replace view public.vw_ekyte_pessoa_ultimo_apontamento
with (security_invoker = on) as
select
  p.id as pessoa_id,
  max(a.data) as ultimo_apontamento_em
from public.ruston_pessoas p
left join public.ruston_ekyte_apontamentos_dashboard a on a.pessoa_id = p.id
where p.ativo
group by p.id;

-- ---------------------------------------------------------------------
-- 7) Horas por cliente por mês × MRR
-- ---------------------------------------------------------------------
create or replace view public.vw_ekyte_horas_cliente_mes
with (security_invoker = on) as
select
  c.id as cliente_id,
  c.nome as cliente_nome,
  date_trunc('month', a.data)::date as mes,
  sum(a.minutos)::int as minutos,
  c.mrr
from public.ruston_ekyte_apontamentos_dashboard a
join public.ruston_clientes c on c.id = a.cliente_id
group by c.id, c.nome, date_trunc('month', a.data), c.mrr;

grant select on
  public.vw_ekyte_executor_pessoa,
  public.ruston_ekyte_apontamentos_dashboard,
  public.vw_ekyte_apontamento_semanal,
  public.vw_ekyte_pessoa_ultimo_apontamento,
  public.vw_ekyte_horas_cliente_mes
to authenticated;
