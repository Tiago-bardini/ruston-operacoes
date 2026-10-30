-- =====================================================================
-- TRATATIVAS DE CHURN (bloco "Tratativas realizadas" no Radar de Churn)
-- Histórico do que o time realmente fez para resolver o problema do cliente.
-- Um registro por ação. Gerente e Coordenador registram; quem registrou
-- (ou o Gerente) edita e exclui. A IA do diagnóstico lê as últimas tratativas.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_tratativas_churn (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  data_acao DATE NOT NULL DEFAULT current_date,
  tipo TEXT NOT NULL CHECK (tipo IN ('reuniao_stakeholder', 'ligacao', 'ajuste_entrega', 'troca_time', 'negociacao', 'fca_dossie', 'outro')),
  descricao TEXT NOT NULL,
  link_drive TEXT,
  resultado TEXT NOT NULL DEFAULT 'em_andamento' CHECK (resultado IN ('resolvido', 'em_andamento', 'sem_efeito')),
  proximo_passo TEXT,
  proximo_passo_data DATE,
  registrado_por TEXT DEFAULT (auth.jwt() ->> 'email'),
  criado_em TIMESTAMPTZ DEFAULT now(),
  atualizado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tratativas_churn_cliente ON ruston_tratativas_churn (cliente_id, data_acao DESC);

ALTER TABLE ruston_tratativas_churn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tratativas_leitura" ON ruston_tratativas_churn;
CREATE POLICY "tratativas_leitura" ON ruston_tratativas_churn
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "tratativas_inclui" ON ruston_tratativas_churn;
CREATE POLICY "tratativas_inclui" ON ruston_tratativas_churn
  FOR INSERT TO authenticated WITH CHECK (ruston_perfil_atual() IN ('gerente', 'coordenador'));

DROP POLICY IF EXISTS "tratativas_edita" ON ruston_tratativas_churn;
CREATE POLICY "tratativas_edita" ON ruston_tratativas_churn
  FOR UPDATE TO authenticated
  USING (ruston_perfil_atual() = 'gerente' OR (ruston_perfil_atual() = 'coordenador' AND lower(registrado_por) = lower(auth.jwt() ->> 'email')))
  WITH CHECK (ruston_perfil_atual() IN ('gerente', 'coordenador'));

DROP POLICY IF EXISTS "tratativas_exclui" ON ruston_tratativas_churn;
CREATE POLICY "tratativas_exclui" ON ruston_tratativas_churn
  FOR DELETE TO authenticated
  USING (ruston_perfil_atual() = 'gerente' OR (ruston_perfil_atual() = 'coordenador' AND lower(registrado_por) = lower(auth.jwt() ->> 'email')));

NOTIFY pgrst, 'reload schema';
