-- =====================================================================
-- Churn revertido => cliente volta para a Carteira.
-- Par da regra 004 (confirmado desativa). Vale pra qualquer tela que mudar
-- a solicitação para "revertido".
--
-- Pra saber pra qual etapa voltar, o cliente passa a guardar a etapa em que
-- estava antes de ir para Em Retenção / Cancelado (etapa_anterior).
-- Quem já está em retenção hoje não tem etapa_anterior: volta como By-line.
-- =====================================================================

ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS etapa_anterior TEXT;

-- 1) Guarda a etapa de antes ao entrar em Em Retenção / Cancelado
CREATE OR REPLACE FUNCTION ruston_guarda_etapa_anterior()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.etapa IN ('em_recuperacao', 'cancelado')
     AND OLD.etapa IS DISTINCT FROM NEW.etapa
     AND OLD.etapa NOT IN ('em_recuperacao', 'cancelado') THEN
    NEW.etapa_anterior := OLD.etapa;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guarda_etapa_anterior ON ruston_clientes;
CREATE TRIGGER trg_guarda_etapa_anterior
BEFORE UPDATE OF etapa ON ruston_clientes
FOR EACH ROW
EXECUTE FUNCTION ruston_guarda_etapa_anterior();

-- 2) Solicitação revertida => cliente ativo de novo, fora de Em Retenção
CREATE OR REPLACE FUNCTION ruston_churn_revertido_reativa()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'revertido' AND OLD.status IS DISTINCT FROM 'revertido' THEN
    UPDATE ruston_clientes
    SET ativo = true,
        churn_realizado = false,
        data_churn = NULL,
        subiu_no_sistema = false,
        etapa = CASE
                  WHEN etapa IN ('em_recuperacao', 'cancelado') THEN COALESCE(etapa_anterior, 'byline')
                  ELSE etapa
                END
    WHERE id = NEW.cliente_id
      AND (ativo = false OR churn_realizado = true OR etapa IN ('em_recuperacao', 'cancelado'))
      -- Se ainda houver outra solicitação aberta para o cliente, ele continua em retenção
      AND NOT EXISTS (
        SELECT 1 FROM ruston_churn_solicitacoes s
         WHERE s.cliente_id = NEW.cliente_id
           AND s.id <> NEW.id
           AND s.status IN ('solicitado', 'em_retencao', 'confirmado')
      );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_churn_revertido ON ruston_churn_solicitacoes;
CREATE TRIGGER trg_churn_revertido
AFTER UPDATE OF status ON ruston_churn_solicitacoes
FOR EACH ROW
EXECUTE FUNCTION ruston_churn_revertido_reativa();

NOTIFY pgrst, 'reload schema';

-- 3) Conferência: clientes que já estão como "revertido" mas continuam fora da
--    carteira. Só lista, não altera (pode haver cliente desativado por outro motivo).
--    Para devolver algum à carteira, rode o UPDATE comentado logo abaixo trocando o nome.
SELECT c.nome, c.etapa, c.etapa_anterior, c.ativo, c.churn_realizado
  FROM ruston_clientes c
 WHERE (c.ativo = false OR c.churn_realizado = true OR c.etapa IN ('em_recuperacao', 'cancelado'))
   AND EXISTS (SELECT 1 FROM ruston_churn_solicitacoes s WHERE s.cliente_id = c.id AND s.status = 'revertido')
   AND NOT EXISTS (
     SELECT 1 FROM ruston_churn_solicitacoes s
      WHERE s.cliente_id = c.id AND s.status IN ('solicitado', 'em_retencao', 'confirmado')
   );

-- UPDATE ruston_clientes
--    SET ativo = true, churn_realizado = false, data_churn = NULL, subiu_no_sistema = false,
--        etapa = CASE WHEN etapa IN ('em_recuperacao', 'cancelado') THEN COALESCE(etapa_anterior, 'byline') ELSE etapa END
--  WHERE nome = 'NOME DO CLIENTE';
