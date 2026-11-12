-- =====================================================================
-- MCP v2 — envios corrigíveis (7 dias), histórico de envios e churn pelo MCP
--
-- 1) Autoria e origem nos registros que o MCP grava
-- 2) Histórico de envios (antes/depois de cada gravação) — base do "desfazer"
-- 3) Churn: a TRATATIVA é a Solicitação de Churn (ruston_churn_solicitacoes,
--    que já tem status/risco/motivo). Ganha responsável, prazo, ações planejadas
--    e encerramento. Os ACOMPANHAMENTOS são as ações do Radar de Churn
--    (ruston_tratativas_churn), agora ligadas à solicitação.
-- 4) Token somente leitura
-- =====================================================================

-- 1) Autoria e origem ---------------------------------------------------
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ruston_fca', 'ruston_cliente_roi_mensal', 'ruston_cliente_pe_mensal',
                           'ruston_churn_solicitacoes', 'ruston_tratativas_churn']
  LOOP
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS criado_por_id UUID DEFAULT auth.uid()', t);
    EXECUTE format('ALTER TABLE %I ADD COLUMN IF NOT EXISTS origem TEXT NOT NULL DEFAULT ''sistema''', t);
  END LOOP;
END $$;

-- 2) Histórico de envios -------------------------------------------------
CREATE TABLE IF NOT EXISTS ruston_historico_envios (
  id BIGSERIAL PRIMARY KEY,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  tabela TEXT NOT NULL,
  registro_id UUID NOT NULL,
  cliente_id UUID,
  acao TEXT NOT NULL CHECK (acao IN ('criar', 'editar', 'apagar', 'desfazer')),
  dados_antes JSONB,
  dados_depois JSONB,
  usuario_id UUID DEFAULT auth.uid(),
  usuario_email TEXT DEFAULT (auth.jwt() ->> 'email'),
  origem TEXT NOT NULL DEFAULT 'mcp',
  desfeito_em TIMESTAMPTZ              -- preenchido quando esta alteração foi desfeita
);

CREATE INDEX IF NOT EXISTS idx_hist_envios_registro ON ruston_historico_envios (registro_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_hist_envios_usuario ON ruston_historico_envios (usuario_id, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_hist_envios_cliente ON ruston_historico_envios (cliente_id, criado_em DESC);

ALTER TABLE ruston_historico_envios ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS hist_envios_leitura ON ruston_historico_envios;
CREATE POLICY hist_envios_leitura ON ruston_historico_envios FOR SELECT TO authenticated
  USING (usuario_id = auth.uid() OR ruston_perfil_atual() IN ('gerente', 'coordenador'));

DROP POLICY IF EXISTS hist_envios_inclui ON ruston_historico_envios;
CREATE POLICY hist_envios_inclui ON ruston_historico_envios FOR INSERT TO authenticated
  WITH CHECK (usuario_id = auth.uid());

-- Só para marcar "desfeito_em"
DROP POLICY IF EXISTS hist_envios_marca ON ruston_historico_envios;
CREATE POLICY hist_envios_marca ON ruston_historico_envios FOR UPDATE TO authenticated
  USING (usuario_id = auth.uid() OR ruston_perfil_atual() IN ('gerente', 'coordenador'))
  WITH CHECK (usuario_id = auth.uid() OR ruston_perfil_atual() IN ('gerente', 'coordenador'));

DROP POLICY IF EXISTS so_gestao_usuarios ON ruston_historico_envios;
CREATE POLICY so_gestao_usuarios ON ruston_historico_envios AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT ruston_tem_acesso())) WITH CHECK ((SELECT ruston_tem_acesso()));

REVOKE ALL ON ruston_historico_envios FROM anon;

-- 3) Churn --------------------------------------------------------------
ALTER TABLE ruston_churn_solicitacoes ADD COLUMN IF NOT EXISTS responsavel_id UUID REFERENCES ruston_pessoas(id) ON DELETE SET NULL;
ALTER TABLE ruston_churn_solicitacoes ADD COLUMN IF NOT EXISTS prazo DATE;
ALTER TABLE ruston_churn_solicitacoes ADD COLUMN IF NOT EXISTS acoes_planejadas TEXT;
ALTER TABLE ruston_churn_solicitacoes ADD COLUMN IF NOT EXISTS motivo_final TEXT;
ALTER TABLE ruston_churn_solicitacoes ADD COLUMN IF NOT EXISTS encerrado_em DATE;
ALTER TABLE ruston_churn_solicitacoes ADD COLUMN IF NOT EXISTS encerrado_por TEXT;

ALTER TABLE ruston_tratativas_churn ADD COLUMN IF NOT EXISTS solicitacao_id UUID REFERENCES ruston_churn_solicitacoes(id) ON DELETE SET NULL;
ALTER TABLE ruston_tratativas_churn ADD COLUMN IF NOT EXISTS retorno_cliente TEXT;
CREATE INDEX IF NOT EXISTS idx_tratativas_churn_solicitacao ON ruston_tratativas_churn (solicitacao_id, data_acao DESC);

-- Liga as ações antigas à solicitação do mesmo cliente aberta até a data da ação
UPDATE ruston_tratativas_churn t
   SET solicitacao_id = (
     SELECT s.id FROM ruston_churn_solicitacoes s
      WHERE s.cliente_id = t.cliente_id AND s.data_solicitacao <= t.data_acao
      ORDER BY s.data_solicitacao DESC LIMIT 1)
 WHERE t.solicitacao_id IS NULL;

-- Acompanhamentos: além de Gerente/Coordenador, o RESPONSÁVEL por uma tratativa
-- aberta do cliente registra; o autor corrige/apaga o que registrou (o prazo de
-- 7 dias é controlado pelo MCP). Coordenador passa a editar qualquer um.
CREATE OR REPLACE FUNCTION ruston_eh_responsavel_churn(p_cliente UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ruston_churn_solicitacoes s
      JOIN ruston_pessoas p ON p.id = s.responsavel_id
     WHERE s.cliente_id = p_cliente
       AND s.status IN ('solicitado', 'em_retencao')
       AND lower(p.email) = lower(auth.jwt() ->> 'email'))
$$;
REVOKE EXECUTE ON FUNCTION ruston_eh_responsavel_churn(UUID) FROM anon;

DROP POLICY IF EXISTS "tratativas_inclui" ON ruston_tratativas_churn;
CREATE POLICY "tratativas_inclui" ON ruston_tratativas_churn
  FOR INSERT TO authenticated
  WITH CHECK (ruston_perfil_atual() IN ('gerente', 'coordenador') OR ruston_eh_responsavel_churn(cliente_id));

DROP POLICY IF EXISTS "tratativas_edita" ON ruston_tratativas_churn;
CREATE POLICY "tratativas_edita" ON ruston_tratativas_churn
  FOR UPDATE TO authenticated
  USING (ruston_perfil_atual() IN ('gerente', 'coordenador') OR lower(registrado_por) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (ruston_perfil_atual() IN ('gerente', 'coordenador') OR lower(registrado_por) = lower(auth.jwt() ->> 'email'));

DROP POLICY IF EXISTS "tratativas_exclui" ON ruston_tratativas_churn;
CREATE POLICY "tratativas_exclui" ON ruston_tratativas_churn
  FOR DELETE TO authenticated
  USING (ruston_perfil_atual() IN ('gerente', 'coordenador') OR lower(registrado_por) = lower(auth.jwt() ->> 'email'));

-- 4) Token somente leitura ----------------------------------------------
ALTER TABLE ruston_mcp_tokens ADD COLUMN IF NOT EXISTS somente_leitura BOOLEAN NOT NULL DEFAULT false;

NOTIFY pgrst, 'reload schema';
