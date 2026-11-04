-- =====================================================================
-- ROI CALCULADO (aba nova do Planejamento do Cliente)
-- Um registro por cliente e mês com o que o GP digitou na aba ROI.
-- Campo vazio puxa do Ponto de Equilíbrio do mesmo mês (fórmulas no app).
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_cliente_roi_mensal (
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

CREATE INDEX IF NOT EXISTS idx_roi_mensal_cliente ON ruston_cliente_roi_mensal (cliente_id, ano, mes);

-- Igual ao Ponto de Equilíbrio: todos os perfis leem e editam
ALTER TABLE ruston_cliente_roi_mensal ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_cliente_roi_mensal" ON ruston_cliente_roi_mensal;
CREATE POLICY "auth_all_cliente_roi_mensal" ON ruston_cliente_roi_mensal
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Registra as alterações no log, como no Ponto de Equilíbrio
DROP TRIGGER IF EXISTS trg_log_alteracoes ON ruston_cliente_roi_mensal;
CREATE TRIGGER trg_log_alteracoes AFTER INSERT OR UPDATE OR DELETE ON ruston_cliente_roi_mensal
  FOR EACH ROW EXECUTE FUNCTION ruston_registrar_alteracao();

NOTIFY pgrst, 'reload schema';
