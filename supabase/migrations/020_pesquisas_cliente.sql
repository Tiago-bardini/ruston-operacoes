-- =====================================================================
-- PESQUISAS DO CLIENTE (Pilar 2 do Playbook NPS: "pulso firme em cada entrega")
-- Cada envio gera um link único (token). O cliente responde sem login pela
-- página /p/<token>; quem grava a resposta é a rota da API (service role).
-- Nota baixa vira sinal no Radar de Churn.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_pesquisas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token TEXT NOT NULL UNIQUE DEFAULT substr(replace(gen_random_uuid()::text, '-', ''), 1, 12),
  cliente_id UUID NOT NULL REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('planejamento', 'checkin', 'ee')),
  semana_ee SMALLINT CHECK (semana_ee BETWEEN 1 AND 5),
  enviada_por TEXT DEFAULT (auth.jwt() ->> 'email'),
  criada_em TIMESTAMPTZ DEFAULT now(),
  respondida_em TIMESTAMPTZ,
  respostas JSONB,
  nota NUMERIC(3,1),            -- média das perguntas com nota, de 0 a 5
  cancelada BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX IF NOT EXISTS idx_pesquisas_cliente ON ruston_pesquisas (cliente_id, criada_em DESC);

ALTER TABLE ruston_pesquisas ENABLE ROW LEVEL SECURITY;

-- Todo perfil logado vê e gera pesquisa (Gerente, Coordenador e Investidor)
DROP POLICY IF EXISTS "pesquisas_leitura" ON ruston_pesquisas;
CREATE POLICY "pesquisas_leitura" ON ruston_pesquisas
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "pesquisas_gera" ON ruston_pesquisas;
CREATE POLICY "pesquisas_gera" ON ruston_pesquisas
  FOR INSERT TO authenticated WITH CHECK (respondida_em IS NULL AND respostas IS NULL AND nota IS NULL);

-- Cancelar/excluir: quem gerou, ou Gerente/Coordenador. Resposta do cliente só pela API.
DROP POLICY IF EXISTS "pesquisas_cancela" ON ruston_pesquisas;
CREATE POLICY "pesquisas_cancela" ON ruston_pesquisas
  FOR UPDATE TO authenticated
  USING (ruston_perfil_atual() IN ('gerente', 'coordenador') OR lower(enviada_por) = lower(auth.jwt() ->> 'email'))
  WITH CHECK (respondida_em IS NULL);

DROP POLICY IF EXISTS "pesquisas_exclui" ON ruston_pesquisas;
CREATE POLICY "pesquisas_exclui" ON ruston_pesquisas
  FOR DELETE TO authenticated
  USING (ruston_perfil_atual() IN ('gerente', 'coordenador') OR (lower(enviada_por) = lower(auth.jwt() ->> 'email') AND respondida_em IS NULL));

NOTIFY pgrst, 'reload schema';
