-- =====================================================================
-- ATRASO POR ETAPA (igual ao eKyte)
-- A regra antiga contava como atrasada:
--   * tarefa cancelada ou concluída com prazo vencido
--   * tarefa que vence HOJE (o prazo é gravado como meia-noite)
--   * e olhava o prazo final da tarefa, não o da etapa
-- Regra nova: tarefa aberta/em andamento (situation 10 ou 20) cuja ETAPA atual
-- tinha que ser executada ANTES de hoje (horário de Brasília). O atraso fica
-- com o executor da etapa atual (campo executor do eKyte).
-- O eKyte manda a data sem fuso; a sync grava como UTC, então a data "do eKyte"
-- é a parte de data em UTC.
-- =====================================================================

CREATE OR REPLACE VIEW ruston_ekyte_tasks_painel AS
SELECT
  d.id, d.title, d.link, d.situation, d.priority, d.creation_date,
  d.original_due_date, d.current_due_date, d.resolved_date,
  d.actual_time, d.estimated_time, d.phase, d.executor, d.executor_email,
  d.executor_id, d.workspace, d.project, d.ctc_task_type, d.tags,
  d.pessoa_id, d.cliente_id, d.foi_prorrogada,
  (
    d.situation IN (10, 20)
    AND COALESCE(t.phase_due_date, d.current_due_date) IS NOT NULL
    AND (COALESCE(t.phase_due_date, d.current_due_date) AT TIME ZONE 'UTC')::date
        < (now() AT TIME ZONE 'America/Sao_Paulo')::date
  ) AS esta_atrasada,
  d.cliente_nome, d.pessoa_nome, d.pessoa_cargo, d.pessoa_ativa,
  t.phase_due_date
FROM ruston_ekyte_tasks_dashboard d
JOIN ruston_ekyte_tasks t ON t.id = d.id;

GRANT SELECT ON ruston_ekyte_tasks_painel TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
