-- =====================================================================
-- Churn confirmado => cliente sai da base ativa (Carteira, Organograma,
-- MRR). Regra no banco, vale pra qualquer tela que confirmar o churn.
-- Solicitado / Em retenção => cliente continua ativo.
-- =====================================================================

CREATE OR REPLACE FUNCTION ruston_churn_confirmado_desativa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'confirmado' THEN
    UPDATE ruston_clientes
    SET churn_realizado = true,
        ativo = false,
        etapa = 'cancelado',
        data_churn = COALESCE(data_churn, NEW.data_solicitacao)
    WHERE id = NEW.cliente_id
      AND (ativo = true OR churn_realizado = false);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_churn_confirmado
  ON ruston_churn_solicitacoes;

CREATE TRIGGER trg_churn_confirmado
AFTER INSERT OR UPDATE OF status
ON ruston_churn_solicitacoes
FOR EACH ROW
EXECUTE FUNCTION ruston_churn_confirmado_desativa();

-- Corrige quem já está como confirmado mas continua ativo
UPDATE ruston_clientes c
SET churn_realizado = true,
    ativo = false,
    etapa = 'cancelado',
    data_churn = COALESCE(c.data_churn, s.data_solicitacao)
FROM ruston_churn_solicitacoes s
WHERE s.cliente_id = c.id
  AND s.status = 'confirmado'
  AND (c.ativo = true OR c.churn_realizado = false)
RETURNING c.nome AS cliente_corrigido;
