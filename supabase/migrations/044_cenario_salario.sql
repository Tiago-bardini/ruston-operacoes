-- =====================================================================
-- 044: Salário no cenário privado (tela /cenario-privado)
-- Guarda o salário ajustado ou estimado de uma pessoa ou vaga dentro do
-- cenário. Quando fica vazio, a tela usa o salário do cadastro
-- (ruston_pessoas). A tabela continua com RLS "somente_dono" (043).
-- =====================================================================

ALTER TABLE ruston_cenario_pessoas ADD COLUMN IF NOT EXISTS salario NUMERIC;
