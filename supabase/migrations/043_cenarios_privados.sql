-- =====================================================================
-- 043: Cenários privados de reestruturação (tela /cenario-privado)
-- Cópia do organograma (squads, pessoas e carteiras) para simular uma
-- reestruturação sem mexer em nada do sistema.
--
-- PRIVACIDADE: cada linha tem dono (owner_id = quem criou). O banco só deixa
-- o próprio dono ler, criar, alterar ou apagar. Nenhum outro usuário do
-- sistema (gerente, coordenador, ninguém) enxerga essas tabelas.
-- Nada aqui altera clientes, pessoas ou o organograma real.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_cenarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id    UUID NOT NULL DEFAULT auth.uid(),
  nome        TEXT NOT NULL,
  notas       TEXT,
  meta_saidas INT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ruston_cenario_squads (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cenario_id     UUID NOT NULL REFERENCES ruston_cenarios(id) ON DELETE CASCADE,
  owner_id       UUID NOT NULL DEFAULT auth.uid(),
  nome           TEXT NOT NULL,
  tipo           TEXT NOT NULL DEFAULT 'squad' CHECK (tipo IN ('squad', 'fixa')),
  ordem          INT NOT NULL DEFAULT 0,
  ativo          BOOLEAN NOT NULL DEFAULT true,
  origem_area_id UUID
);

CREATE TABLE IF NOT EXISTS ruston_cenario_pessoas (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cenario_id       UUID NOT NULL REFERENCES ruston_cenarios(id) ON DELETE CASCADE,
  owner_id         UUID NOT NULL DEFAULT auth.uid(),
  squad_id         UUID REFERENCES ruston_cenario_squads(id) ON DELETE SET NULL,
  squad_original_id UUID,
  nome             TEXT NOT NULL,
  cargo            TEXT,
  papel            TEXT NOT NULL DEFAULT 'outro' CHECK (papel IN ('gp', 'gt', 'designer', 'lideranca', 'outro')),
  foto_url         TEXT,
  status           TEXT NOT NULL DEFAULT 'fica' CHECK (status IN ('fica', 'sai', 'vaga')),
  capacidade       INT,
  nota             TEXT,
  ordem            INT NOT NULL DEFAULT 0,
  origem_pessoa_id UUID  -- id em ruston_pessoas (só referência, sem FK)
);

CREATE TABLE IF NOT EXISTS ruston_cenario_clientes (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cenario_id           UUID NOT NULL REFERENCES ruston_cenarios(id) ON DELETE CASCADE,
  owner_id             UUID NOT NULL DEFAULT auth.uid(),
  cliente_id           UUID,  -- id em ruston_clientes (só referência, sem FK)
  nome                 TEXT NOT NULL,
  mrr                  NUMERIC,
  bandeira             TEXT,
  etapa                TEXT,
  vencimento           DATE,
  gp_id                UUID REFERENCES ruston_cenario_pessoas(id) ON DELETE SET NULL,
  gt_id                UUID REFERENCES ruston_cenario_pessoas(id) ON DELETE SET NULL,
  designer_id          UUID REFERENCES ruston_cenario_pessoas(id) ON DELETE SET NULL,
  gp_original_id       UUID,
  gt_original_id       UUID,
  designer_original_id UUID,
  nota                 TEXT
);

CREATE INDEX IF NOT EXISTS idx_cen_squads_cen   ON ruston_cenario_squads (cenario_id);
CREATE INDEX IF NOT EXISTS idx_cen_pessoas_cen  ON ruston_cenario_pessoas (cenario_id);
CREATE INDEX IF NOT EXISTS idx_cen_clientes_cen ON ruston_cenario_clientes (cenario_id);

-- Só o dono, e só logado. Anônimo não tem acesso nenhum.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['ruston_cenarios', 'ruston_cenario_squads', 'ruston_cenario_pessoas', 'ruston_cenario_clientes']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
    EXECUTE format('DROP POLICY IF EXISTS somente_dono ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY somente_dono ON public.%I FOR ALL TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid())',
      t
    );
  END LOOP;
END $$;
