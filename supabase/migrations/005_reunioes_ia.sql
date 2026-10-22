-- Reuniões do Google Meet com análise de IA + avaliações extras no WhatsApp
--
-- ruston_reunioes_cliente passa a receber:
--   - reuniões importadas da agenda (Apps Script) com a transcrição do Meet
--   - reuniões enviadas por áudio (Análise Reuniões IA)
-- Reunião sem cliente identificado fica com cliente_id NULL até alguém vincular.

ALTER TABLE ruston_reunioes_cliente
  ALTER COLUMN cliente_id DROP NOT NULL;

ALTER TABLE ruston_reunioes_cliente
  ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'manual',  -- manual | audio | google_meet
  ADD COLUMN IF NOT EXISTS google_event_id text,
  ADD COLUMN IF NOT EXISTS titulo text,
  ADD COLUMN IF NOT EXISTS interna boolean NOT NULL DEFAULT false, -- só time Ruston/V4, falando do cliente
  ADD COLUMN IF NOT EXISTS participantes text[],
  ADD COLUMN IF NOT EXISTS duracao_minutos integer,
  ADD COLUMN IF NOT EXISTS transcricao text,
  ADD COLUMN IF NOT EXISTS temperatura text,
  ADD COLUMN IF NOT EXISTS sentimento text,
  ADD COLUMN IF NOT EXISTS risco_churn text,
  ADD COLUMN IF NOT EXISTS oportunidade_upsell text,
  ADD COLUMN IF NOT EXISTS estresse text,
  ADD COLUMN IF NOT EXISTS analise_ia jsonb,
  ADD COLUMN IF NOT EXISTS analisado_em timestamptz,
  ADD COLUMN IF NOT EXISTS modelo text,
  ADD COLUMN IF NOT EXISTS tokens_entrada integer,
  ADD COLUMN IF NOT EXISTS tokens_saida integer;

-- Evita importar a mesma reunião duas vezes (NULLs não conflitam)
CREATE UNIQUE INDEX IF NOT EXISTS ruston_reunioes_cliente_google_event_id_key
  ON ruston_reunioes_cliente (google_event_id);

CREATE INDEX IF NOT EXISTS ruston_reunioes_cliente_sem_cliente_idx
  ON ruston_reunioes_cliente (data_reuniao DESC) WHERE cliente_id IS NULL;

-- WhatsApp: as mesmas avaliações extras da reunião
ALTER TABLE ruston_whatsapp_analises
  ADD COLUMN IF NOT EXISTS analise_extra jsonb;
