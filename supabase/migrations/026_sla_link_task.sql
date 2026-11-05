-- Link da task (eKyte etc.) por cliente no Controle SLA
CREATE TABLE IF NOT EXISTS ruston_sla_links (
  cliente_id UUID PRIMARY KEY REFERENCES ruston_clientes(id) ON DELETE CASCADE,
  link TEXT NOT NULL DEFAULT '',
  updated_by TEXT DEFAULT (auth.jwt() ->> 'email'),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE ruston_sla_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sla_links_todos ON ruston_sla_links;
CREATE POLICY sla_links_todos ON ruston_sla_links FOR ALL TO authenticated
  USING (true) WITH CHECK (true);

NOTIFY pgrst, 'reload schema';
