-- =====================================================================
-- Semana da Estruturação Estratégica (S1 a S5) do cliente em E.E.
-- Aparece como tag ao lado do nome na Carteira e no Organograma.
-- =====================================================================

ALTER TABLE ruston_clientes
  ADD COLUMN IF NOT EXISTS semana_ee SMALLINT CHECK (semana_ee BETWEEN 1 AND 5);

NOTIFY pgrst, 'reload schema';
