-- =====================================================================
-- PONTO DE EQUILÍBRIO MÊS A MÊS
-- Cada mês preenchido vira um registro, pra montar histórico e avaliar
-- períodos (3 meses, 6 meses, ano...). O Forecast continua um só por
-- cliente em ruston_cliente_planejamento.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_cliente_pe_mensal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  ano INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  dados JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (cliente_id, ano, mes)
);

CREATE INDEX IF NOT EXISTS idx_pe_mensal_cliente ON ruston_cliente_pe_mensal (cliente_id, ano, mes);

-- O que já foi preenchido vira o registro do mês em que foi salvo
INSERT INTO ruston_cliente_pe_mensal (cliente_id, ano, mes, dados, updated_at)
SELECT cliente_id,
       EXTRACT(YEAR FROM updated_at AT TIME ZONE 'America/Sao_Paulo')::int,
       EXTRACT(MONTH FROM updated_at AT TIME ZONE 'America/Sao_Paulo')::int,
       ponto_equilibrio,
       updated_at
  FROM ruston_cliente_planejamento
 WHERE ponto_equilibrio <> '{}'::jsonb
ON CONFLICT (cliente_id, ano, mes) DO NOTHING;

-- RLS — todos os perfis leem e editam
ALTER TABLE ruston_cliente_pe_mensal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_cliente_pe_mensal" ON ruston_cliente_pe_mensal;
CREATE POLICY "auth_all_cliente_pe_mensal" ON ruston_cliente_pe_mensal
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Log (007): registro sem "nome" próprio passa a mostrar o nome do cliente
-- (e o mês, quando tiver) — ex.: "Viapol · 10/2026"
CREATE OR REPLACE FUNCTION ruston_registrar_alteracao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_antes JSONB;
  v_depois JSONB;
  v_linha JSONB;
  v_campos TEXT[];
  v_nome TEXT;
  v_ignorar TEXT[] := ARRAY['updated_at', 'atualizado_em', 'created_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_depois := to_jsonb(NEW);
    v_linha := v_depois;
  ELSIF TG_OP = 'DELETE' THEN
    v_antes := to_jsonb(OLD);
    v_linha := v_antes;
  ELSE
    SELECT array_agg(n.key ORDER BY n.key),
           jsonb_object_agg(n.key, to_jsonb(OLD) -> n.key),
           jsonb_object_agg(n.key, n.value)
      INTO v_campos, v_antes, v_depois
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE (to_jsonb(OLD) -> n.key) IS DISTINCT FROM n.value
       AND NOT (n.key = ANY (v_ignorar));
    IF v_campos IS NULL THEN
      RETURN NEW;
    END IF;
    v_linha := to_jsonb(NEW);
  END IF;

  v_nome := COALESCE(v_linha ->> 'nome', v_linha ->> 'titulo', v_linha ->> 'cliente_nome');
  IF v_nome IS NULL AND v_linha ? 'cliente_id' THEN
    SELECT nome INTO v_nome FROM ruston_clientes WHERE id::text = v_linha ->> 'cliente_id';
  END IF;
  IF v_linha ? 'mes' AND v_linha ? 'ano' THEN
    v_nome := concat_ws(' · ', v_nome, lpad(v_linha ->> 'mes', 2, '0') || '/' || (v_linha ->> 'ano'));
  END IF;

  INSERT INTO ruston_log_alteracoes
    (usuario_id, usuario_email, tabela, acao, registro_id, registro_nome, campos_alterados, antes, depois)
  VALUES (
    auth.uid(),
    auth.jwt() ->> 'email',
    TG_TABLE_NAME,
    CASE TG_OP WHEN 'INSERT' THEN 'inclusao' WHEN 'DELETE' THEN 'exclusao' ELSE 'edicao' END,
    COALESCE(v_linha ->> 'id', v_linha ->> 'cliente_id', v_linha ->> 'email'),
    COALESCE(v_nome, v_linha ->> 'email'),
    v_campos,
    v_antes,
    v_depois
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Liga o log de alterações nesta tabela nova
DROP TRIGGER IF EXISTS trg_log_alteracoes ON ruston_cliente_pe_mensal;
CREATE TRIGGER trg_log_alteracoes AFTER INSERT OR UPDATE OR DELETE ON ruston_cliente_pe_mensal
  FOR EACH ROW EXECUTE FUNCTION ruston_registrar_alteracao();

NOTIFY pgrst, 'reload schema';

-- Conferência: meses que vieram do que já estava preenchido
SELECT c.nome, m.ano, m.mes
  FROM ruston_cliente_pe_mensal m JOIN ruston_clientes c ON c.id = m.cliente_id
 ORDER BY c.nome, m.ano, m.mes;
