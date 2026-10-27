-- =====================================================================
-- Tag do modelo de contrato do cliente: Pontual, Pontual+Assessoria ou
-- E.E+Assessoria. Aparece ao lado do nome na Carteira e no Organograma.
-- =====================================================================

ALTER TABLE ruston_clientes
  ADD COLUMN IF NOT EXISTS tag_contrato TEXT
  CHECK (tag_contrato IN ('pontual', 'pontual_assessoria', 'ee_assessoria'));

NOTIFY pgrst, 'reload schema';
