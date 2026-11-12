-- =====================================================================
-- MCP (Conexão com IA) — tokens pessoais
-- Cada pessoa gera o próprio token na tela "Conexão IA". O token vai no
-- endereço do conector do Claude. Guardamos só o hash (SHA-256), nunca o token.
-- A rota /api/mcp valida o token, confere o perfil e age COMO a pessoa:
-- as mesmas regras de acesso (RLS) e o Log de alterações com o e-mail dela.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_mcp_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL DEFAULT (auth.jwt() ->> 'email'),
  token_hash TEXT NOT NULL UNIQUE,
  prefixo TEXT NOT NULL,            -- primeiros caracteres, só pra pessoa reconhecer
  nome TEXT,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_uso_em TIMESTAMPTZ,
  revogado_em TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_mcp_tokens_email ON ruston_mcp_tokens (lower(email));

ALTER TABLE ruston_mcp_tokens ENABLE ROW LEVEL SECURITY;

-- Cada um vê e revoga só os próprios. A criação é feita pela API (service role).
DROP POLICY IF EXISTS "mcp_tokens_leitura" ON ruston_mcp_tokens;
CREATE POLICY "mcp_tokens_leitura" ON ruston_mcp_tokens
  FOR SELECT TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email') OR ruston_perfil_atual() = 'gerente');

DROP POLICY IF EXISTS "mcp_tokens_revoga" ON ruston_mcp_tokens;
CREATE POLICY "mcp_tokens_revoga" ON ruston_mcp_tokens
  FOR UPDATE TO authenticated
  USING (lower(email) = lower(auth.jwt() ->> 'email') OR ruston_perfil_atual() = 'gerente')
  WITH CHECK (lower(email) = lower(auth.jwt() ->> 'email') OR ruston_perfil_atual() = 'gerente');

-- Mesma trava das outras tabelas: só quem está ativo na Gestão de Usuários
DROP POLICY IF EXISTS so_gestao_usuarios ON ruston_mcp_tokens;
CREATE POLICY so_gestao_usuarios ON ruston_mcp_tokens AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT ruston_tem_acesso())) WITH CHECK ((SELECT ruston_tem_acesso()));

REVOKE ALL ON ruston_mcp_tokens FROM anon;

NOTIFY pgrst, 'reload schema';
