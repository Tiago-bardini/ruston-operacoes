-- =====================================================================
-- TABELAS DO MONITOR DE WHATSAPP
-- =====================================================================

-- 1) Conversas (grupos e individuais)
CREATE TABLE IF NOT EXISTS ruston_whatsapp_conversas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id TEXT UNIQUE NOT NULL,
  tipo TEXT NOT NULL DEFAULT 'grupo', -- 'grupo' | 'individual'
  nome TEXT,
  numero TEXT,
  cliente_id UUID REFERENCES ruston_clientes(id),
  ultima_mensagem_em TIMESTAMPTZ,
  total_mensagens INT DEFAULT 0,
  atualizado_em TIMESTAMPTZ DEFAULT now(),
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_conv_chat_id ON ruston_whatsapp_conversas(chat_id);
CREATE INDEX IF NOT EXISTS idx_wa_conv_cliente ON ruston_whatsapp_conversas(cliente_id);

-- 2) Mensagens
CREATE TABLE IF NOT EXISTS ruston_whatsapp_mensagens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id TEXT UNIQUE NOT NULL,
  conversa_id UUID REFERENCES ruston_whatsapp_conversas(id),
  chat_id TEXT,
  tipo TEXT NOT NULL DEFAULT 'texto',
  conteudo TEXT,
  media_url TEXT,
  autor_numero TEXT,
  autor_nome TEXT,
  de_mim BOOLEAN DEFAULT false,
  enviada_em TIMESTAMPTZ NOT NULL,
  payload_raw JSONB,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_msg_conversa ON ruston_whatsapp_mensagens(conversa_id);
CREATE INDEX IF NOT EXISTS idx_wa_msg_enviada ON ruston_whatsapp_mensagens(enviada_em);
CREATE INDEX IF NOT EXISTS idx_wa_msg_de_mim ON ruston_whatsapp_mensagens(de_mim);

-- 3) Alertas disparados
CREATE TABLE IF NOT EXISTS ruston_whatsapp_alertas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo TEXT NOT NULL, -- 'sla_30min' | 'grupo_mudo' | 'ruston_mudo'
  conversa_id UUID REFERENCES ruston_whatsapp_conversas(id),
  cliente_id UUID,
  mensagem_id TEXT,
  detalhes TEXT,
  enviado_para_coord_whatsapp TEXT,
  enviado_para_gerente_whatsapp TEXT,
  envio_sucesso BOOLEAN DEFAULT false,
  envio_erro TEXT,
  criado_em TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_alerta_tipo ON ruston_whatsapp_alertas(tipo);
CREATE INDEX IF NOT EXISTS idx_wa_alerta_criado ON ruston_whatsapp_alertas(criado_em);

-- 4) Análises IA
CREATE TABLE IF NOT EXISTS ruston_whatsapp_analises (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversa_id UUID REFERENCES ruston_whatsapp_conversas(id),
  cliente_id UUID,
  periodo_ini TIMESTAMPTZ,
  periodo_fim TIMESTAMPTZ,
  qtd_mensagens INT,
  temperatura TEXT, -- 'quente' | 'morna' | 'fria'
  sentimento TEXT, -- 'positivo' | 'neutro' | 'negativo'
  risco_churn TEXT, -- 'baixo' | 'medio' | 'alto'
  oportunidade_upsell TEXT, -- 'nenhuma' | 'possivel' | 'clara'
  sinais_churn TEXT[] DEFAULT '{}',
  sinais_upsell TEXT[] DEFAULT '{}',
  acoes_sugeridas TEXT[] DEFAULT '{}',
  resumo_curto TEXT,
  resumo_longo TEXT,
  modelo TEXT,
  tokens_entrada INT DEFAULT 0,
  tokens_saida INT DEFAULT 0,
  custo_estimado_usd NUMERIC(10,6) DEFAULT 0,
  criado_em TIMESTAMPTZ DEFAULT now()
);

-- 5) Adicionar campo whatsapp em ruston_pessoas se não existir
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ruston_pessoas' AND column_name = 'whatsapp'
  ) THEN
    ALTER TABLE ruston_pessoas ADD COLUMN whatsapp TEXT;
  END IF;
END $$;

-- 6) RLS — qualquer usuário autenticado pode ler/escrever (mesmo padrão do projeto)
ALTER TABLE ruston_whatsapp_conversas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruston_whatsapp_mensagens ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruston_whatsapp_alertas ENABLE ROW LEVEL SECURITY;
ALTER TABLE ruston_whatsapp_analises ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "auth_all_wa_conversas" ON ruston_whatsapp_conversas;
CREATE POLICY "auth_all_wa_conversas" ON ruston_whatsapp_conversas FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_wa_mensagens" ON ruston_whatsapp_mensagens;
CREATE POLICY "auth_all_wa_mensagens" ON ruston_whatsapp_mensagens FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_wa_alertas" ON ruston_whatsapp_alertas;
CREATE POLICY "auth_all_wa_alertas" ON ruston_whatsapp_alertas FOR ALL USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "auth_all_wa_analises" ON ruston_whatsapp_analises;
CREATE POLICY "auth_all_wa_analises" ON ruston_whatsapp_analises FOR ALL USING (true) WITH CHECK (true);

-- =====================================================================
-- FUNÇÕES
-- =====================================================================

-- Match grupos por nome: "[CLIENTE] V4 Externo" → busca "CLIENTE" em ruston_clientes
DROP FUNCTION IF EXISTS fn_whatsapp_match_grupos_por_nome();
CREATE OR REPLACE FUNCTION fn_whatsapp_match_grupos_por_nome()
RETURNS void AS $$
BEGIN
  UPDATE ruston_whatsapp_conversas conv
  SET cliente_id = c.id
  FROM ruston_clientes c
  WHERE conv.cliente_id IS NULL
    AND conv.tipo = 'grupo'
    AND conv.nome IS NOT NULL
    AND (
      conv.nome ILIKE '%' || c.nome || '%'
      OR c.nome ILIKE '%' || regexp_replace(
        regexp_replace(conv.nome, '\].*$', ''),
        '^\[', ''
      ) || '%'
    );
END;
$$ LANGUAGE plpgsql;

-- Match grupos pelos participantes (placeholder — depende de ter números cadastrados)
DROP FUNCTION IF EXISTS fn_whatsapp_match_grupos();
CREATE OR REPLACE FUNCTION fn_whatsapp_match_grupos()
RETURNS void AS $$
BEGIN
  -- Tenta match pelo número do cliente cadastrado
  UPDATE ruston_whatsapp_conversas conv
  SET cliente_id = c.id
  FROM ruston_clientes c
  WHERE conv.cliente_id IS NULL
    AND conv.tipo = 'grupo'
    AND c.whatsapp IS NOT NULL
    AND conv.numero IS NOT NULL
    AND replace(replace(replace(c.whatsapp, ' ', ''), '-', ''), '+', '')
      = replace(replace(replace(conv.numero, ' ', ''), '-', ''), '+', '');
END;
$$ LANGUAGE plpgsql;

-- Match clientes individuais por número
DROP FUNCTION IF EXISTS fn_whatsapp_match_clientes();
CREATE OR REPLACE FUNCTION fn_whatsapp_match_clientes()
RETURNS void AS $$
BEGIN
  UPDATE ruston_whatsapp_conversas conv
  SET cliente_id = c.id
  FROM ruston_clientes c
  WHERE conv.cliente_id IS NULL
    AND conv.tipo = 'individual'
    AND c.whatsapp IS NOT NULL
    AND conv.numero IS NOT NULL
    AND replace(replace(replace(c.whatsapp, ' ', ''), '-', ''), '+', '')
      = replace(replace(replace(conv.numero, ' ', ''), '-', ''), '+', '');
END;
$$ LANGUAGE plpgsql;

-- Incrementar contador de mensagens
DROP FUNCTION IF EXISTS exec_sql_increment_conv_msgs(UUID);
CREATE OR REPLACE FUNCTION exec_sql_increment_conv_msgs(p_conversa_id UUID)
RETURNS void AS $$
BEGIN
  UPDATE ruston_whatsapp_conversas
  SET total_mensagens = total_mensagens + 1
  WHERE id = p_conversa_id;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- SLA 30 MIN — detecta msgs de cliente sem resposta da Ruston há 30+ min
-- =====================================================================
DROP FUNCTION IF EXISTS fn_wa_detectar_sla_30min();
CREATE OR REPLACE FUNCTION fn_wa_detectar_sla_30min()
RETURNS TABLE (
  conversa_id UUID,
  cliente_id UUID,
  cliente_nome TEXT,
  coordenador_id UUID,
  mensagem_id TEXT,
  minutos_sem_resposta INT
) AS $$
BEGIN
  RETURN QUERY
  WITH ultima_msg_cliente AS (
    -- Última msg de cada conversa que NÃO é da Ruston (de_mim = false)
    SELECT DISTINCT ON (m.conversa_id)
      m.conversa_id,
      m.message_id,
      m.enviada_em,
      m.conteudo
    FROM ruston_whatsapp_mensagens m
    WHERE m.de_mim = false
      AND m.enviada_em > now() - INTERVAL '4 hours'
    ORDER BY m.conversa_id, m.enviada_em DESC
  ),
  ultima_resposta_ruston AS (
    -- Última msg da Ruston em cada conversa
    SELECT DISTINCT ON (m.conversa_id)
      m.conversa_id,
      m.enviada_em AS respondida_em
    FROM ruston_whatsapp_mensagens m
    WHERE m.de_mim = true
    ORDER BY m.conversa_id, m.enviada_em DESC
  )
  SELECT
    umc.conversa_id,
    conv.cliente_id,
    COALESCE(c.nome, conv.nome)::TEXT AS cliente_nome,
    c.coordenador_id,
    umc.message_id,
    EXTRACT(EPOCH FROM (now() - umc.enviada_em))::INT / 60 AS minutos_sem_resposta
  FROM ultima_msg_cliente umc
  JOIN ruston_whatsapp_conversas conv ON conv.id = umc.conversa_id
  LEFT JOIN ruston_clientes c ON c.id = conv.cliente_id
  LEFT JOIN ultima_resposta_ruston urr ON urr.conversa_id = umc.conversa_id
  WHERE conv.cliente_id IS NOT NULL
    AND EXTRACT(EPOCH FROM (now() - umc.enviada_em)) / 60 >= 30
    AND (urr.respondida_em IS NULL OR urr.respondida_em < umc.enviada_em)
    -- Não alertar se já alertou essa msg
    AND NOT EXISTS (
      SELECT 1 FROM ruston_whatsapp_alertas a
      WHERE a.mensagem_id = umc.message_id
        AND a.tipo = 'sla_30min'
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- GRUPO MUDO — nenhuma msg hoje no grupo do cliente
-- =====================================================================
DROP FUNCTION IF EXISTS fn_wa_detectar_grupo_mudo();
CREATE OR REPLACE FUNCTION fn_wa_detectar_grupo_mudo()
RETURNS TABLE (
  conversa_id UUID,
  cliente_id UUID,
  cliente_nome TEXT,
  coordenador_id UUID
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    conv.id AS conversa_id,
    conv.cliente_id,
    COALESCE(c.nome, conv.nome)::TEXT AS cliente_nome,
    c.coordenador_id
  FROM ruston_whatsapp_conversas conv
  JOIN ruston_clientes c ON c.id = conv.cliente_id
  WHERE conv.tipo = 'grupo'
    AND c.ativo = true
    AND NOT EXISTS (
      SELECT 1 FROM ruston_whatsapp_mensagens m
      WHERE m.conversa_id = conv.id
        AND m.enviada_em::DATE = CURRENT_DATE
    )
    AND NOT EXISTS (
      SELECT 1 FROM ruston_whatsapp_alertas a
      WHERE a.conversa_id = conv.id
        AND a.tipo = 'grupo_mudo'
        AND a.criado_em::DATE = CURRENT_DATE
    );
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- RUSTON MUDO — cliente falou hoje mas Ruston não respondeu
-- =====================================================================
DROP FUNCTION IF EXISTS fn_wa_detectar_ruston_mudo();
CREATE OR REPLACE FUNCTION fn_wa_detectar_ruston_mudo()
RETURNS TABLE (
  conversa_id UUID,
  cliente_id UUID,
  cliente_nome TEXT,
  coordenador_id UUID,
  qtd_msgs_cliente BIGINT
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    conv.id AS conversa_id,
    conv.cliente_id,
    COALESCE(c.nome, conv.nome)::TEXT AS cliente_nome,
    c.coordenador_id,
    COUNT(m.id) AS qtd_msgs_cliente
  FROM ruston_whatsapp_conversas conv
  JOIN ruston_clientes c ON c.id = conv.cliente_id
  JOIN ruston_whatsapp_mensagens m ON m.conversa_id = conv.id
    AND m.de_mim = false
    AND m.enviada_em::DATE = CURRENT_DATE
  WHERE conv.tipo = 'grupo'
    AND c.ativo = true
    AND NOT EXISTS (
      SELECT 1 FROM ruston_whatsapp_mensagens mr
      WHERE mr.conversa_id = conv.id
        AND mr.de_mim = true
        AND mr.enviada_em::DATE = CURRENT_DATE
    )
    AND NOT EXISTS (
      SELECT 1 FROM ruston_whatsapp_alertas a
      WHERE a.conversa_id = conv.id
        AND a.tipo = 'ruston_mudo'
        AND a.criado_em::DATE = CURRENT_DATE
    )
  GROUP BY conv.id, conv.cliente_id, c.nome, conv.nome, c.coordenador_id;
END;
$$ LANGUAGE plpgsql;
