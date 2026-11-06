ALTER TABLE ruston_churn_solicitacoes ADD COLUMN IF NOT EXISTS risco TEXT
  CHECK (risco IN ('alto', 'medio', 'baixo'));
NOTIFY pgrst, 'reload schema';
