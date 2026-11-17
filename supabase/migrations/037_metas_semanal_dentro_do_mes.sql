-- =====================================================================
-- METAS DOS CLIENTES — semanas fechadas dentro do mês
-- A primeira semana começa no dia 01 e a última termina no último dia do mês.
-- data_referencia passa a ser o último dia da semana (sexta OU o fim do mês),
-- então sai a regra que obrigava a ser sexta-feira.
-- =====================================================================
ALTER TABLE ruston_cliente_metas_semanal
  DROP CONSTRAINT IF EXISTS ruston_cliente_metas_semanal_data_referencia_check;

NOTIFY pgrst, 'reload schema';
