-- =====================================================================
-- CONFERÊNCIA DE E.E (só Gerente)
-- A IA confere o material de cada semana da Estruturação Estratégica antes
-- de ir pro cliente: qualidade da entrega + coerência com o que o cliente
-- falou nas reuniões anteriores.
-- =====================================================================

-- 1) Pareceres
CREATE TABLE IF NOT EXISTS ruston_ee_conferencias (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  semana INT NOT NULL CHECK (semana BETWEEN 1 AND 5),
  arquivo_nome TEXT,
  arquivo_path TEXT,
  observacao TEXT,
  veredito TEXT,                -- apresentar | ajustar | refazer
  nota NUMERIC,
  parecer JSONB,
  reunioes_usadas INT,
  modelo TEXT,
  tokens_entrada INT,
  tokens_saida INT,
  criado_por TEXT DEFAULT (auth.jwt() ->> 'email'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ee_conf_cliente ON ruston_ee_conferencias (cliente_id, created_at DESC);

-- 2) Padrão de cada semana (POP / manual V4 colado pelo Gerente)
CREATE TABLE IF NOT EXISTS ruston_ee_padroes (
  semana INT PRIMARY KEY CHECK (semana BETWEEN 1 AND 5),
  texto TEXT NOT NULL DEFAULT '',
  updated_by TEXT DEFAULT (auth.jwt() ->> 'email'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3) Só o Gerente lê e grava
ALTER TABLE ruston_ee_conferencias ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruston_ee_padroes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS so_gerente ON ruston_ee_conferencias;
CREATE POLICY so_gerente ON ruston_ee_conferencias FOR ALL TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'gerente') WITH CHECK ((SELECT ruston_perfil_atual()) = 'gerente');

DROP POLICY IF EXISTS so_gerente ON ruston_ee_padroes;
CREATE POLICY so_gerente ON ruston_ee_padroes FOR ALL TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'gerente') WITH CHECK ((SELECT ruston_perfil_atual()) = 'gerente');

DROP TRIGGER IF EXISTS trg_log_alteracoes ON ruston_ee_padroes;
CREATE TRIGGER trg_log_alteracoes AFTER INSERT OR UPDATE OR DELETE ON ruston_ee_padroes
  FOR EACH ROW EXECUTE FUNCTION ruston_registrar_alteracao();

-- 4) Arquivos das apresentações (bucket privado)
INSERT INTO storage.buckets (id, name, public)
VALUES ('ee-conferencias', 'ee-conferencias', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS ee_conf_gerente_le ON storage.objects;
CREATE POLICY ee_conf_gerente_le ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ee-conferencias' AND (SELECT public.ruston_perfil_atual()) = 'gerente');

DROP POLICY IF EXISTS ee_conf_gerente_sobe ON storage.objects;
CREATE POLICY ee_conf_gerente_sobe ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ee-conferencias' AND (SELECT public.ruston_perfil_atual()) = 'gerente');

NOTIFY pgrst, 'reload schema';
