-- =====================================================================
-- 049: "Tech" como opção de "Quem usa" nas ferramentas do cenário privado
-- (para quem já rodou a 048 antes desta opção existir)
-- =====================================================================
ALTER TABLE ruston_cenario_ferramentas DROP CONSTRAINT IF EXISTS ruston_cenario_ferramentas_quem_usa_check;
ALTER TABLE ruston_cenario_ferramentas ADD CONSTRAINT ruston_cenario_ferramentas_quem_usa_check
  CHECK (quem_usa IN ('lideranca', 'gp', 'gt', 'dg', 'tech', 'todos'));

NOTIFY pgrst, 'reload schema';
