-- =====================================================================
-- METAS DOS CLIENTES — lançamento semanal
-- Toda semana (sábado a sexta, a mesma semana da FCA) o time lança os leads
-- e o faturamento do cliente. A semana conta no mês da sua sexta-feira.
-- Prazo para lançar: a segunda-feira seguinte.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ruston_cliente_metas_semanal (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  data_referencia DATE NOT NULL CHECK (EXTRACT(ISODOW FROM data_referencia) = 5),
  ano INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  leads INT CHECK (leads >= 0),
  faturamento NUMERIC(14,2) CHECK (faturamento >= 0),
  observacoes TEXT,
  atualizado_por TEXT DEFAULT (auth.jwt() ->> 'email'),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (cliente_id, data_referencia)
);
CREATE INDEX IF NOT EXISTS idx_metas_semanal_mes ON ruston_cliente_metas_semanal (ano, mes);

ALTER TABLE ruston_cliente_metas_semanal ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_all_cliente_metas_semanal" ON ruston_cliente_metas_semanal;
CREATE POLICY "auth_all_cliente_metas_semanal" ON ruston_cliente_metas_semanal
  FOR ALL TO authenticated
  USING ((SELECT ruston_perfil_atual()) IS NOT NULL)
  WITH CHECK ((SELECT ruston_perfil_atual()) IS NOT NULL);

DROP TRIGGER IF EXISTS trg_log_alteracoes ON ruston_cliente_metas_semanal;
CREATE TRIGGER trg_log_alteracoes AFTER INSERT OR UPDATE OR DELETE ON ruston_cliente_metas_semanal
  FOR EACH ROW EXECUTE FUNCTION ruston_registrar_alteracao();

NOTIFY pgrst, 'reload schema';
