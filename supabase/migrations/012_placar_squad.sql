-- =====================================================================
-- PLACAR SEMANAL DOS SQUADS — histórico
-- Toda semana (sábado de manhã) o cron /api/placar-snapshot grava a nota de
-- cada squad da semana que fechou. A tela calcula a semana na hora e usa esta
-- tabela pra mostrar a evolução.
-- =====================================================================

CREATE TABLE IF NOT EXISTS ruston_placar_squad (
  squad_id UUID NOT NULL REFERENCES ruston_squads(id) ON DELETE CASCADE,
  semana DATE NOT NULL,                 -- sexta que fecha a semana FCA
  nota INT,
  clientes INT,
  mrr NUMERIC(12,2),
  criterios JSONB NOT NULL DEFAULT '{}'::jsonb,
  pendencias INT,
  gravado_em TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (squad_id, semana)
);

ALTER TABLE ruston_placar_squad ENABLE ROW LEVEL SECURITY;

-- Leitura pra quem tem acesso; quem grava é o cron (service role)
DROP POLICY IF EXISTS "auth_select_placar_squad" ON ruston_placar_squad;
CREATE POLICY "auth_select_placar_squad" ON ruston_placar_squad
  FOR SELECT TO authenticated USING (true);
DROP POLICY IF EXISTS so_gestao_usuarios ON ruston_placar_squad;
CREATE POLICY so_gestao_usuarios ON ruston_placar_squad AS RESTRICTIVE FOR ALL TO authenticated
  USING ((SELECT ruston_tem_acesso())) WITH CHECK ((SELECT ruston_tem_acesso()));

NOTIFY pgrst, 'reload schema';
