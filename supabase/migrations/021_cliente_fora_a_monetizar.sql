-- Monetização: permite tirar da coluna "A Monetizar" um cliente que não deveria estar ali.
-- Só esconde da coluna; não altera MRR, etapa nem as oportunidades do cliente.
ALTER TABLE ruston_clientes
  ADD COLUMN IF NOT EXISTS fora_a_monetizar BOOLEAN NOT NULL DEFAULT false;
