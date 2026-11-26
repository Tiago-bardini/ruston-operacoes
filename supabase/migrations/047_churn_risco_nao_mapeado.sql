-- =====================================================================
-- 047: Risco de churn "Não mapeado" (além de Alto, Médio e Baixo)
-- =====================================================================
ALTER TABLE ruston_churn_solicitacoes DROP CONSTRAINT IF EXISTS ruston_churn_solicitacoes_risco_check;
ALTER TABLE ruston_churn_solicitacoes ADD CONSTRAINT ruston_churn_solicitacoes_risco_check
  CHECK (risco IN ('alto', 'medio', 'baixo', 'nao_mapeado'));

NOTIFY pgrst, 'reload schema';
