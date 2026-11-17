-- =====================================================================
-- METAS DOS CLIENTES (mês a mês)
-- O time coloca a meta de leads e de faturamento de cada cliente no início
-- do mês e, no fim do mês, o resultado obtido. Todos os perfis leem e editam.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ruston_cliente_metas_mensal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  ano INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  meta_leads INT,
  meta_faturamento NUMERIC(14,2),
  resultado_leads INT,
  resultado_faturamento NUMERIC(14,2),
  observacoes TEXT,
  atualizado_por TEXT DEFAULT (auth.jwt() ->> 'email'),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (cliente_id, ano, mes)
);
CREATE INDEX IF NOT EXISTS idx_metas_cliente_mes ON ruston_cliente_metas_mensal (ano, mes);

ALTER TABLE ruston_cliente_metas_mensal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_cliente_metas_mensal" ON ruston_cliente_metas_mensal;
CREATE POLICY "auth_all_cliente_metas_mensal" ON ruston_cliente_metas_mensal
  FOR ALL TO authenticated
  USING ((SELECT ruston_perfil_atual()) IS NOT NULL)
  WITH CHECK ((SELECT ruston_perfil_atual()) IS NOT NULL);

DROP TRIGGER IF EXISTS trg_log_alteracoes ON ruston_cliente_metas_mensal;
CREATE TRIGGER trg_log_alteracoes AFTER INSERT OR UPDATE OR DELETE ON ruston_cliente_metas_mensal
  FOR EACH ROW EXECUTE FUNCTION ruston_registrar_alteracao();

NOTIFY pgrst, 'reload schema';
