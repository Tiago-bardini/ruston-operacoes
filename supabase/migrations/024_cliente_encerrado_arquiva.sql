-- =====================================================================
-- Cliente encerrado (churn confirmado / saiu da base ativa) vira arquivo:
--   1) As conversas de WhatsApp dele são arquivadas e param de receber
--      mensagens novas (o histórico até o churn fica guardado).
--   2) Alertas de WhatsApp em aberto dele são fechados.
--   3) Se o cliente voltar (churn revertido / reativado), tudo volta a rodar.
-- E também:
--   4) Data em que o cliente E.E virou assessoria (troca de tag
--      "E.E" -> "E.E + Assessoria"), pra medir a conversão.
-- =====================================================================

-- 1) Marca de conversa arquivada
ALTER TABLE ruston_whatsapp_conversas
  ADD COLUMN IF NOT EXISTS arquivada BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS arquivada_em TIMESTAMPTZ;

-- 2) Cliente sai da base ativa => arquiva conversas e fecha alertas.
--    Cliente volta => desarquiva.
CREATE OR REPLACE FUNCTION ruston_cliente_arquiva_whatsapp()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ativo = false AND OLD.ativo IS DISTINCT FROM false THEN
    UPDATE ruston_whatsapp_conversas
       SET arquivada = true, arquivada_em = now()
     WHERE cliente_id = NEW.id AND arquivada = false;
    UPDATE ruston_whatsapp_alertas
       SET resolvido = true, resolvido_em = now()
     WHERE cliente_id = NEW.id AND resolvido = false;
  ELSIF NEW.ativo = true AND OLD.ativo = false THEN
    UPDATE ruston_whatsapp_conversas
       SET arquivada = false, arquivada_em = NULL
     WHERE cliente_id = NEW.id AND arquivada = true;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cliente_arquiva_whatsapp ON ruston_clientes;
CREATE TRIGGER trg_cliente_arquiva_whatsapp
AFTER UPDATE OF ativo ON ruston_clientes
FOR EACH ROW
EXECUTE FUNCTION ruston_cliente_arquiva_whatsapp();

-- 3) Mensagem nova em conversa arquivada não é gravada
CREATE OR REPLACE FUNCTION ruston_whatsapp_ignora_arquivada()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM ruston_whatsapp_conversas c
              WHERE c.id = NEW.conversa_id AND c.arquivada = true) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_whatsapp_ignora_arquivada ON ruston_whatsapp_mensagens;
CREATE TRIGGER trg_whatsapp_ignora_arquivada
BEFORE INSERT ON ruston_whatsapp_mensagens
FOR EACH ROW
EXECUTE FUNCTION ruston_whatsapp_ignora_arquivada();

-- 4) Arruma quem já está fora da base hoje
UPDATE ruston_whatsapp_conversas conv
   SET arquivada = true, arquivada_em = now()
  FROM ruston_clientes c
 WHERE c.id = conv.cliente_id
   AND c.ativo = false
   AND conv.arquivada = false;

UPDATE ruston_whatsapp_alertas a
   SET resolvido = true, resolvido_em = now()
  FROM ruston_clientes c
 WHERE c.id = a.cliente_id
   AND c.ativo = false
   AND a.resolvido = false;

-- 5) Conversão E.E -> Assessoria
ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS data_conversao_assessoria DATE;

CREATE OR REPLACE FUNCTION ruston_registra_conversao_assessoria()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.tag_contrato = 'ee_assessoria'
     AND OLD.tag_contrato IN ('ee', 'ee_pontual')
     AND NEW.data_conversao_assessoria IS NULL THEN
    NEW.data_conversao_assessoria := (now() AT TIME ZONE 'America/Sao_Paulo')::date;
  ELSIF NEW.tag_contrato IN ('ee', 'ee_pontual')
     AND OLD.tag_contrato = 'ee_assessoria' THEN
    -- Voltou a ser só E.E (marcação errada): desfaz a conversão
    NEW.data_conversao_assessoria := NULL;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_registra_conversao_assessoria ON ruston_clientes;
CREATE TRIGGER trg_registra_conversao_assessoria
BEFORE UPDATE OF tag_contrato ON ruston_clientes
FOR EACH ROW
EXECUTE FUNCTION ruston_registra_conversao_assessoria();

NOTIFY pgrst, 'reload schema';

-- Conferência
SELECT count(conv.id) FILTER (WHERE arquivada) AS conversas_arquivadas,
       count(conv.id) FILTER (WHERE NOT arquivada) AS conversas_ativas
  FROM ruston_whatsapp_conversas conv;
