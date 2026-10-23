-- =====================================================================
-- LOG DE ALTERAÇÕES (auditoria de quem mudou o quê)
-- Um trigger genérico grava toda inclusão, edição e exclusão nas tabelas
-- ruston_*. Roda no banco, então pega qualquer tela — inclusive as que
-- forem criadas depois (é só rodar o bloco 3 de novo pra ligar nelas).
-- Só o Gerente lê o log; ninguém consegue editar ou apagar pelo app.
-- =====================================================================

-- 1) Tabela do log
CREATE TABLE IF NOT EXISTS ruston_log_alteracoes (
  id BIGSERIAL PRIMARY KEY,
  criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  usuario_id UUID,
  usuario_email TEXT,            -- NULL = gravado pelo sistema (integração, cron, IA)
  tabela TEXT NOT NULL,
  acao TEXT NOT NULL,            -- 'inclusao' | 'edicao' | 'exclusao'
  registro_id TEXT,
  registro_nome TEXT,
  campos_alterados TEXT[],
  antes JSONB,                   -- na edição: só os campos que mudaram
  depois JSONB
);

CREATE INDEX IF NOT EXISTS idx_log_alt_criado ON ruston_log_alteracoes (criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_log_alt_tabela ON ruston_log_alteracoes (tabela, criado_em DESC);
CREATE INDEX IF NOT EXISTS idx_log_alt_registro ON ruston_log_alteracoes (registro_id);
CREATE INDEX IF NOT EXISTS idx_log_alt_email ON ruston_log_alteracoes (usuario_email, criado_em DESC);

-- 2) Função do trigger
CREATE OR REPLACE FUNCTION ruston_registrar_alteracao()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_antes JSONB;
  v_depois JSONB;
  v_linha JSONB;
  v_campos TEXT[];
  -- Campos que mudam sozinhos e não contam como alteração
  v_ignorar TEXT[] := ARRAY['updated_at', 'atualizado_em', 'created_at'];
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_depois := to_jsonb(NEW);
    v_linha := v_depois;
  ELSIF TG_OP = 'DELETE' THEN
    v_antes := to_jsonb(OLD);
    v_linha := v_antes;
  ELSE
    SELECT array_agg(n.key ORDER BY n.key),
           jsonb_object_agg(n.key, to_jsonb(OLD) -> n.key),
           jsonb_object_agg(n.key, n.value)
      INTO v_campos, v_antes, v_depois
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE (to_jsonb(OLD) -> n.key) IS DISTINCT FROM n.value
       AND NOT (n.key = ANY (v_ignorar));
    IF v_campos IS NULL THEN
      RETURN NEW; -- nada mudou de verdade
    END IF;
    v_linha := to_jsonb(NEW);
  END IF;

  INSERT INTO ruston_log_alteracoes
    (usuario_id, usuario_email, tabela, acao, registro_id, registro_nome, campos_alterados, antes, depois)
  VALUES (
    auth.uid(),
    auth.jwt() ->> 'email',
    TG_TABLE_NAME,
    CASE TG_OP WHEN 'INSERT' THEN 'inclusao' WHEN 'DELETE' THEN 'exclusao' ELSE 'edicao' END,
    COALESCE(v_linha ->> 'id', v_linha ->> 'cliente_id', v_linha ->> 'email'),
    COALESCE(v_linha ->> 'nome', v_linha ->> 'titulo', v_linha ->> 'cliente_nome', v_linha ->> 'email'),
    v_campos,
    v_antes,
    v_depois
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 3) Liga o trigger em todas as tabelas ruston_* (menos as de alto volume
--    gravadas por robô, que lotariam o log sem dizer nada útil)
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_type = 'BASE TABLE'
       AND table_name LIKE 'ruston\_%'
       AND table_name NOT IN (
         'ruston_log_alteracoes',
         'ruston_whatsapp_mensagens',
         'ruston_whatsapp_conversas',
         'ruston_whatsapp_analises',
         'ruston_whatsapp_alertas',
         'ruston_ekyte_tasks',
         'ruston_ekyte_sync_log'
       )
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_log_alteracoes ON %I', t);
    EXECUTE format(
      'CREATE TRIGGER trg_log_alteracoes AFTER INSERT OR UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION ruston_registrar_alteracao()', t);
  END LOOP;
END $$;

-- 4) RLS: só Gerente lê. Sem policy de INSERT/UPDATE/DELETE — quem grava é o
--    trigger (SECURITY DEFINER), então o log não pode ser editado pelo app.
ALTER TABLE ruston_log_alteracoes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "gerente_le_log_alteracoes" ON ruston_log_alteracoes;
CREATE POLICY "gerente_le_log_alteracoes" ON ruston_log_alteracoes
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM ruston_usuario_perfil p
     WHERE lower(p.email) = lower(auth.jwt() ->> 'email')
       AND p.perfil = 'gerente'
  ));

NOTIFY pgrst, 'reload schema';

-- Conferência: tabelas que ficaram com log ligado
SELECT event_object_table AS tabela_com_log
  FROM information_schema.triggers
 WHERE trigger_name = 'trg_log_alteracoes'
 GROUP BY event_object_table
 ORDER BY 1;
