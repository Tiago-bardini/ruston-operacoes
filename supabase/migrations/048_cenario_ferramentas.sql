-- =====================================================================
-- 048: Ferramentas no cenário privado (aba 🧰 Ferramentas em /cenario-privado)
-- Lista de ferramentas pagas, quem usa, valor e se continua ativa.
-- Mesma trava das outras tabelas do cenário: só o dono lê e grava.
-- =====================================================================
CREATE TABLE IF NOT EXISTS ruston_cenario_ferramentas (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cenario_id    UUID NOT NULL REFERENCES ruston_cenarios(id) ON DELETE CASCADE,
  owner_id      UUID NOT NULL DEFAULT auth.uid(),
  nome          TEXT NOT NULL DEFAULT '',
  quem_usa      TEXT NOT NULL DEFAULT 'todos' CHECK (quem_usa IN ('lideranca', 'gp', 'gt', 'dg', 'tech', 'todos')),
  valor         NUMERIC(12,2),
  periodicidade TEXT NOT NULL DEFAULT 'mensal' CHECK (periodicidade IN ('mensal', 'anual')),
  manter        BOOLEAN NOT NULL DEFAULT true,
  observacao    TEXT,
  ordem         INT NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_cen_ferramentas_cen ON ruston_cenario_ferramentas (cenario_id);

ALTER TABLE public.ruston_cenario_ferramentas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ruston_cenario_ferramentas FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.ruston_cenario_ferramentas FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ruston_cenario_ferramentas TO authenticated;
DROP POLICY IF EXISTS somente_dono ON public.ruston_cenario_ferramentas;
CREATE POLICY somente_dono ON public.ruston_cenario_ferramentas FOR ALL TO authenticated
  USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());

NOTIFY pgrst, 'reload schema';
