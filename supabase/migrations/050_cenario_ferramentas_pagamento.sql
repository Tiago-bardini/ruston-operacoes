-- =====================================================================
-- 050: Forma de pagamento das ferramentas do cenário privado
--   mensal    = valor de cada mês
--   anual_12x = total do ano, pago em 12 parcelas
--   anual     = total do ano, pago 1x à vista
-- Também libera "Tech" em quem usa (mesmo que a 049 não tenha sido rodada).
-- =====================================================================
ALTER TABLE ruston_cenario_ferramentas DROP CONSTRAINT IF EXISTS ruston_cenario_ferramentas_periodicidade_check;
ALTER TABLE ruston_cenario_ferramentas ADD CONSTRAINT ruston_cenario_ferramentas_periodicidade_check
  CHECK (periodicidade IN ('mensal', 'anual_12x', 'anual'));

ALTER TABLE ruston_cenario_ferramentas DROP CONSTRAINT IF EXISTS ruston_cenario_ferramentas_quem_usa_check;
ALTER TABLE ruston_cenario_ferramentas ADD CONSTRAINT ruston_cenario_ferramentas_quem_usa_check
  CHECK (quem_usa IN ('lideranca', 'gp', 'gt', 'dg', 'tech', 'todos'));

NOTIFY pgrst, 'reload schema';
