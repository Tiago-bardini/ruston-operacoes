-- =====================================================================
-- Tag de contrato ganha "E.E" (ee). Recria a regra de valores aceitos.
-- =====================================================================

ALTER TABLE ruston_clientes DROP CONSTRAINT IF EXISTS ruston_clientes_tag_contrato_check;
ALTER TABLE ruston_clientes ADD CONSTRAINT ruston_clientes_tag_contrato_check
  CHECK (tag_contrato IN ('ee', 'pontual', 'pontual_assessoria', 'ee_assessoria'));

NOTIFY pgrst, 'reload schema';
