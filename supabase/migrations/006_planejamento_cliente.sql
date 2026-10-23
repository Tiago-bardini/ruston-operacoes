-- =====================================================================
-- PLANEJAMENTO DO CLIENTE (Ponto de Equilíbrio + Forecasting)
-- Uma linha por cliente com só o que o GP preenche (as células "amarelas"
-- da planilha Farol BI). Tudo que é calculado fica no app
-- (lib/planejamento.ts), então mudar uma fórmula vale pra todos os clientes.
--
-- Cliente sem linha aqui = usa o modelo padrão da planilha. Por isso todo
-- cliente novo já nasce com as duas abas, sem precisar de trigger.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_cliente_planejamento (
  cliente_id UUID PRIMARY KEY REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  ponto_equilibrio JSONB NOT NULL DEFAULT '{}'::jsonb,
  forecast JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- RLS — mesmo padrão do projeto
ALTER TABLE ruston_cliente_planejamento ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_cliente_planejamento" ON ruston_cliente_planejamento;
CREATE POLICY "auth_all_cliente_planejamento" ON ruston_cliente_planejamento
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
