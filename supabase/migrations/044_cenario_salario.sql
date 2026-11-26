-- =====================================================================
-- 044: Salário no cenário privado (tela /cenario-privado)
-- Guarda o salário ajustado ou estimado de uma pessoa ou vaga dentro do
-- cenário. Quando fica vazio, a tela usa o salário do cadastro
-- (ruston_pessoas). A tabela continua com RLS "somente_dono" (043).
-- =====================================================================

ALTER TABLE ruston_cenario_pessoas ADD COLUMN IF NOT EXISTS salario NUMERIC;

-- Folha atual informada à mão para o cenário (base do antes × depois)
ALTER TABLE ruston_cenarios ADD COLUMN IF NOT EXISTS folha_base NUMERIC;
