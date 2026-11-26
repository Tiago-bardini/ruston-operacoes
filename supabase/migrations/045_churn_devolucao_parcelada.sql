-- =====================================================================
-- 045: Devolução de dinheiro parcelada no churn
-- Ex.: devolver R$ 15.174 em 12x a partir de nov/2026 → cada mês recebe
-- R$ 1.264,50 no churn. Sem preencher, continua como antes (valor inteiro
-- no mês da solicitação).
-- =====================================================================
ALTER TABLE ruston_churn_solicitacoes
  ADD COLUMN IF NOT EXISTS devolucao_parcelas INT NOT NULL DEFAULT 1 CHECK (devolucao_parcelas BETWEEN 1 AND 60),
  ADD COLUMN IF NOT EXISTS devolucao_inicio DATE;

NOTIFY pgrst, 'reload schema';
