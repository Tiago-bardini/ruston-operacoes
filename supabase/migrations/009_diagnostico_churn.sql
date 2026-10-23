-- =====================================================================
-- DIAGNÓSTICO DE CHURN COM IA (botão no Radar de Churn)
-- Um diagnóstico por cliente, guardado pra não pagar de novo: a rota só chama
-- a IA quando apareceu dado novo (FCA, WhatsApp ou reunião) depois do último.
-- Quem grava é a rota da API (service role); o painel só lê.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_diagnostico_churn (
  cliente_id UUID PRIMARY KEY REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  diagnostico JSONB NOT NULL,
  risco INT,
  dados_ate TEXT,              -- data do dado mais novo que a IA leu
  gerado_por TEXT,
  modelo TEXT,
  tokens_entrada INT DEFAULT 0,
  tokens_saida INT DEFAULT 0,
  gerado_em TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE ruston_diagnostico_churn ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_select_diagnostico_churn" ON ruston_diagnostico_churn;
CREATE POLICY "auth_select_diagnostico_churn" ON ruston_diagnostico_churn
  FOR SELECT TO authenticated USING (true);

NOTIFY pgrst, 'reload schema';
