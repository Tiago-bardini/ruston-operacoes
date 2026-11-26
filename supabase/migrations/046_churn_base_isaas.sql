-- =====================================================================
-- 046: Churn separado Ruston Operação × ISAAS
-- A trava do fim do mês passa a guardar também o MRR dos clientes do ISAAS
-- (squads com nome começando em "ISS" ou "ISA"). A tela usa:
--   ISAAS    = mrr_base_isaas
--   Operação = mrr_base − mrr_base_isaas
-- Meses já travados ficam com mrr_base_isaas vazio (a tela estima pelo MRR atual).
-- =====================================================================
ALTER TABLE ruston_churn_mrr_base ADD COLUMN IF NOT EXISTS mrr_base_isaas NUMERIC(12,2);

CREATE OR REPLACE FUNCTION ruston_travar_mrr_mes(p_ano INT, p_mes INT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO ruston_churn_mrr_base (ano, mes, mrr_base, mrr_base_isaas, clientes_ativos, travado_em, origem)
  SELECT p_ano, p_mes,
         COALESCE(SUM(c.mrr), 0),
         COALESCE(SUM(c.mrr) FILTER (WHERE lower(left(coalesce(s.nome, ''), 3)) IN ('iss', 'isa')), 0),
         COUNT(*) FILTER (WHERE COALESCE(c.mrr, 0) > 0),
         now(), 'automatico'
  FROM ruston_clientes c
  LEFT JOIN ruston_squads s ON s.id = c.squad_id
  WHERE c.ativo = true
  ON CONFLICT (ano, mes) DO NOTHING;
$$;

NOTIFY pgrst, 'reload schema';
