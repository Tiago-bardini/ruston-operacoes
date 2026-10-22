-- =====================================================================
-- Colunas de churn em ruston_clientes usadas pelo "Subir Churn"
-- (o app já gravava nelas, mas nem todas existiam no banco — o erro era
-- silencioso até o aviso de "Não foi salvo"). IF NOT EXISTS: não mexe nas
-- colunas que já existem.
-- =====================================================================

ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS churn_realizado BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS data_churn DATE;
ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS motivo_churn TEXT;
ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS data_subir_churn_sistema DATE;
ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS subiu_no_sistema BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS subiu_no_sistema_em TIMESTAMPTZ;
ALTER TABLE ruston_clientes ADD COLUMN IF NOT EXISTS link_debriefing_churn TEXT;

-- Atualiza o cache da API do Supabase pra enxergar as colunas novas na hora
NOTIFY pgrst, 'reload schema';

-- Conferência: a view usada pelas telas precisa ter essas colunas.
-- Se alguma vier "false", me mande o resultado que eu ajusto a view.
SELECT col,
       EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_name = 'ruston_clientes_view' AND column_name = col
       ) AS existe_na_view
FROM unnest(ARRAY['churn_realizado','data_churn','motivo_churn','data_subir_churn_sistema',
                  'subiu_no_sistema','subiu_no_sistema_em','link_debriefing_churn']) AS col;
