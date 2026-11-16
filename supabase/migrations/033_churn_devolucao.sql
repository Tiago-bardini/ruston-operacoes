-- =====================================================================
-- CHURN: DEVOLUÇÃO DE DINHEIRO
-- Valor devolvido ao cliente (ex.: E.E reembolsada) soma no churn do mês,
-- junto com o MRR da solicitação. Cliente com E.E + Assessoria que cancela
-- e pede o dinheiro de volta: MRR da assessoria + devolução.
-- =====================================================================
ALTER TABLE ruston_churn_solicitacoes
  ADD COLUMN IF NOT EXISTS valor_devolucao NUMERIC(12,2) NOT NULL DEFAULT 0;

NOTIFY pgrst, 'reload schema';
