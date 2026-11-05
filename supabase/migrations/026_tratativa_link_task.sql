-- Link da task na tratativa do Radar de Churn
ALTER TABLE ruston_tratativas_churn ADD COLUMN IF NOT EXISTS link_task TEXT;
NOTIFY pgrst, 'reload schema';
