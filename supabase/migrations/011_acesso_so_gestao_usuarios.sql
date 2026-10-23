-- =====================================================================
-- ACESSO SÓ PARA QUEM ESTÁ NA GESTÃO DE USUÁRIOS
-- 1) Cadastro: só cria conta quem tem perfil ATIVO em ruston_usuario_perfil
--    (e-mail V4 sozinho não basta mais).
-- 2) Dados: conta logada sem perfil ativo não lê nem grava nada pela API —
--    política RESTRITIVA em todas as tabelas, somada às que já existem.
--    Desativar alguém na Gestão de Usuários corta o acesso na hora.
-- =====================================================================

-- 1) Cadastro
CREATE OR REPLACE FUNCTION public.ruston_bloqueia_dominio_cadastro()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM ruston_usuario_perfil
     WHERE lower(email) = lower(NEW.email) AND coalesce(ativo, true)
  ) THEN
    RAISE EXCEPTION 'E-mail sem acesso liberado. Peça ao gerente pra te cadastrar na Gestão de Usuários.';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE EXECUTE ON FUNCTION public.ruston_bloqueia_dominio_cadastro() FROM anon, authenticated;

-- 2) Dados
CREATE OR REPLACE FUNCTION public.ruston_tem_acesso()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM ruston_usuario_perfil
     WHERE lower(email) = lower(auth.jwt() ->> 'email') AND coalesce(ativo, true)
  )
$$;
REVOKE EXECUTE ON FUNCTION public.ruston_tem_acesso() FROM anon;

DO $$
DECLARE t RECORD;
BEGIN
  FOR t IN
    SELECT c.relname, c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'ruston\_%'
  LOOP
    -- Tabela sem RLS: liga mantendo o acesso de hoje pra usuário logado
    IF NOT t.relrowsecurity THEN
      EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t.relname);
      EXECUTE format('DROP POLICY IF EXISTS %I ON %I', 'auth_all_' || t.relname, t.relname);
      EXECUTE format('CREATE POLICY %I ON %I FOR ALL TO authenticated USING (true) WITH CHECK (true)',
                     'auth_all_' || t.relname, t.relname);
    END IF;
    EXECUTE format('DROP POLICY IF EXISTS so_gestao_usuarios ON %I', t.relname);
    EXECUTE format('CREATE POLICY so_gestao_usuarios ON %I AS RESTRICTIVE FOR ALL TO authenticated
                      USING ((SELECT ruston_tem_acesso())) WITH CHECK ((SELECT ruston_tem_acesso()))', t.relname);
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

-- Conferência: tabelas protegidas
SELECT tablename AS protegida FROM pg_policies
 WHERE schemaname = 'public' AND policyname = 'so_gestao_usuarios' ORDER BY 1;
