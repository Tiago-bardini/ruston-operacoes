-- Realizado automático das metas dos investidores (ROI, churn, safe, pesquisas, upsell)
ALTER TABLE ruston_okr_realizado_investidor
  ADD COLUMN IF NOT EXISTS automatico BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detalhe_auto TEXT;
NOTIFY pgrst, 'reload schema';
