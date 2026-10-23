-- =====================================================================
-- SEGURANÇA — fecha o acesso sem login e a troca de perfil pelo próprio usuário
--
-- 1) A chave pública do Supabase (vai junto no site) lia 22 tabelas/views SEM
--    login: mensagens do WhatsApp, reuniões, FCA, MRR, perfis de acesso...
--    O sistema nunca lê dados sem login, então tirar o acesso do "anon" não
--    muda nada pra quem usa o painel.
-- 2) Qualquer usuário logado podia alterar ruston_usuario_perfil (inclusive o
--    próprio perfil pra "gerente"). Agora só Gerente altera.
-- =====================================================================

-- 1) Sem login = sem acesso a nada do schema public
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;
-- ...e o mesmo pra tudo que for criado daqui pra frente
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- Políticas criadas sem "TO authenticated" valiam pra todo mundo (inclusive sem
-- login). Passam a valer só pra usuário logado — a regra em si não muda.
DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN
    SELECT schemaname, tablename, policyname FROM pg_policies
     WHERE schemaname = 'public' AND ('public' = ANY (roles) OR 'anon' = ANY (roles))
  LOOP
    EXECUTE format('ALTER POLICY %I ON %I.%I TO authenticated', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END $$;

-- 2) Perfil de acesso: todo logado lê (o menu precisa), só Gerente altera
CREATE OR REPLACE FUNCTION ruston_perfil_atual()
RETURNS TEXT
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT perfil FROM ruston_usuario_perfil
   WHERE lower(email) = lower(auth.jwt() ->> 'email') AND coalesce(ativo, true)
   LIMIT 1
$$;
REVOKE EXECUTE ON FUNCTION ruston_perfil_atual() FROM anon;

ALTER TABLE ruston_usuario_perfil ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE p RECORD;
BEGIN
  FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'ruston_usuario_perfil'
  LOOP
    EXECUTE format('DROP POLICY %I ON ruston_usuario_perfil', p.policyname);
  END LOOP;
END $$;

CREATE POLICY "perfil_leitura" ON ruston_usuario_perfil
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "perfil_gerente_inclui" ON ruston_usuario_perfil
  FOR INSERT TO authenticated WITH CHECK (ruston_perfil_atual() = 'gerente');
CREATE POLICY "perfil_gerente_edita" ON ruston_usuario_perfil
  FOR UPDATE TO authenticated USING (ruston_perfil_atual() = 'gerente') WITH CHECK (ruston_perfil_atual() = 'gerente');
CREATE POLICY "perfil_gerente_exclui" ON ruston_usuario_perfil
  FOR DELETE TO authenticated USING (ruston_perfil_atual() = 'gerente');

NOTIFY pgrst, 'reload schema';

-- 3) Cadastro só com e-mail da empresa — validado no banco (o aviso da tela de
--    login dava pra pular chamando a API direto). Junto com "Confirm email"
--    ligado no Supabase, ninguém cria conta com e-mail que não é dele.
CREATE OR REPLACE FUNCTION public.ruston_bloqueia_dominio_cadastro()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF lower(NEW.email) NOT LIKE '%@v4company.com' AND lower(NEW.email) NOT LIKE '%@rustonassessoria.com' THEN
    RAISE EXCEPTION 'Cadastro liberado apenas para e-mails @v4company.com';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ruston_dominio_cadastro ON auth.users;
CREATE TRIGGER trg_ruston_dominio_cadastro
  BEFORE INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.ruston_bloqueia_dominio_cadastro();

-- Conferência: deve voltar vazio (nenhuma tabela/view liberada sem login)
SELECT table_name AS ainda_aberto_sem_login
  FROM information_schema.role_table_grants
 WHERE table_schema = 'public' AND grantee = 'anon'
 GROUP BY table_name;
