-- =====================================================================
-- E.E FINALIZADA
-- Cliente terminou a Estruturação Estratégica e não fechou a assessoria.
-- Sai da carteira do GP (ativo = false), mas NÃO é churn: churn_realizado
-- continua false e não entra nas Solicitações de Churn.
-- Cada baixa fica registrada aqui (Clientes › E.E Finalizada). GP, squad e
-- MRR são gravados no momento da baixa, pra o histórico não mudar depois.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_ee_finalizadas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID REFERENCES ruston_clientes(id) ON DELETE SET NULL,
  cliente_nome TEXT NOT NULL,
  data_finalizacao DATE NOT NULL DEFAULT CURRENT_DATE,
  motivo TEXT,
  observacoes TEXT,
  mrr NUMERIC(12,2),
  fee NUMERIC(12,2),
  gp_id UUID,
  gp_nome TEXT,
  coordenador_nome TEXT,
  squad_id UUID,
  squad_nome TEXT,
  registrado_por TEXT,
  reativado_em TIMESTAMPTZ,          -- cliente fechou a assessoria depois e voltou pra carteira
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ruston_ee_finalizadas_data_idx
  ON ruston_ee_finalizadas (data_finalizacao DESC);

-- RLS — mesmo padrão do projeto
ALTER TABLE ruston_ee_finalizadas ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_ee_finalizadas" ON ruston_ee_finalizadas;
CREATE POLICY "auth_all_ee_finalizadas" ON ruston_ee_finalizadas
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
