-- =====================================================================
-- SOLICITAÇÕES DE CHURN
-- Banco histórico de pedidos de churn + MRR de fechamento de cada mês
-- pro cálculo do % de churn (só MRR — valores pontuais/one time não entram).
-- =====================================================================

-- 1) Solicitações
CREATE TABLE IF NOT EXISTS ruston_churn_solicitacoes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES ruston_clientes(id),
  data_solicitacao DATE NOT NULL DEFAULT CURRENT_DATE,
  ano INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  -- MRR do cliente congelado no momento da solicitação
  -- (se o MRR do cliente mudar depois, o histórico não muda)
  mrr NUMERIC(12,2) NOT NULL DEFAULT 0,
  motivo TEXT,
  status TEXT NOT NULL DEFAULT 'solicitado', -- 'solicitado' | 'em_retencao' | 'revertido' | 'confirmado'
  observacoes TEXT,
  created_by UUID DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_churn_sol_ano_mes ON ruston_churn_solicitacoes(ano, mes);
CREATE INDEX IF NOT EXISTS idx_churn_sol_cliente ON ruston_churn_solicitacoes(cliente_id);

-- 2) MRR de fechamento de cada mês (denominador do % de churn)
--    Travado no último dia do mês. Depois de gravado, não muda mais.
CREATE TABLE IF NOT EXISTS ruston_churn_mrr_base (
  ano INT NOT NULL,
  mes INT NOT NULL CHECK (mes BETWEEN 1 AND 12),
  mrr_base NUMERIC(12,2) NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (ano, mes)
);
ALTER TABLE ruston_churn_mrr_base ADD COLUMN IF NOT EXISTS clientes_ativos INT;
ALTER TABLE ruston_churn_mrr_base ADD COLUMN IF NOT EXISTS travado_em TIMESTAMPTZ DEFAULT now();
ALTER TABLE ruston_churn_mrr_base ADD COLUMN IF NOT EXISTS origem TEXT DEFAULT 'automatico'; -- 'automatico' | 'manual'

-- Mês corrente/futuro ainda não fechou: não pode ter MRR travado
-- (limpa valores gravados por versões anteriores da tela)
DELETE FROM ruston_churn_mrr_base
WHERE make_date(ano, mes, 1) >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo')::date;

-- RLS
ALTER TABLE ruston_churn_solicitacoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruston_churn_mrr_base ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_churn_solicitacoes" ON ruston_churn_solicitacoes;
CREATE POLICY "auth_all_churn_solicitacoes" ON ruston_churn_solicitacoes
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- MRR travado: o app só lê e insere (pra travar manualmente um mês que ficou sem
-- fechamento). Sem UPDATE/DELETE: mês travado não é alterado pelo painel.
DROP POLICY IF EXISTS "auth_all_churn_mrr_base" ON ruston_churn_mrr_base;
DROP POLICY IF EXISTS "auth_select_churn_mrr_base" ON ruston_churn_mrr_base;
DROP POLICY IF EXISTS "auth_insert_churn_mrr_base" ON ruston_churn_mrr_base;
CREATE POLICY "auth_select_churn_mrr_base" ON ruston_churn_mrr_base
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "auth_insert_churn_mrr_base" ON ruston_churn_mrr_base
  FOR INSERT TO authenticated WITH CHECK (true);

-- 3) Função que trava o MRR de um mês (soma do MRR dos clientes ativos agora).
--    Se o mês já estiver travado, não faz nada.
CREATE OR REPLACE FUNCTION ruston_travar_mrr_mes(p_ano INT, p_mes INT)
RETURNS VOID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  INSERT INTO ruston_churn_mrr_base (ano, mes, mrr_base, clientes_ativos, travado_em, origem)
  SELECT p_ano, p_mes,
         COALESCE(SUM(mrr), 0),
         COUNT(*) FILTER (WHERE COALESCE(mrr, 0) > 0),
         now(), 'automatico'
  FROM ruston_clientes
  WHERE ativo = true
  ON CONFLICT (ano, mes) DO NOTHING;
$$;

-- 4) Agendamento: todo dia 1º às 03:00 UTC (= 00:00 de Brasília), trava o mês que
--    acabou de fechar com o MRR do último dia.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.unschedule('ruston_travar_mrr_mensal')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ruston_travar_mrr_mensal');

SELECT cron.schedule(
  'ruston_travar_mrr_mensal',
  '0 3 1 * *',
  $$
    SELECT ruston_travar_mrr_mes(
      EXTRACT(YEAR  FROM (now() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '1 day')::INT,
      EXTRACT(MONTH FROM (now() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '1 day')::INT
    );
  $$
);
