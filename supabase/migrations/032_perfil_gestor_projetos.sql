-- =====================================================================
-- PERFIL "GESTOR DE PROJETOS" (separado do Investidor)
-- Perfis: gerente | coordenador | gestor_projetos | investidor
-- As telas que cada perfil vê ficam em lib/permissoes.ts.
-- Já inclui a liberação da Conferência de E.E (substitui a 031).
-- =====================================================================

-- 1) Aceita o novo valor (remove qualquer CHECK antigo da coluna perfil)
DO $$
DECLARE c RECORD;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
      JOIN pg_class t ON t.oid = con.conrelid
     WHERE t.relname = 'ruston_usuario_perfil' AND con.contype = 'c'
       AND pg_get_constraintdef(con.oid) ILIKE '%perfil%'
  LOOP
    EXECUTE format('ALTER TABLE ruston_usuario_perfil DROP CONSTRAINT %I', c.conname);
  END LOOP;
END $$;
ALTER TABLE ruston_usuario_perfil ADD CONSTRAINT ruston_usuario_perfil_perfil_check
  CHECK (perfil IN ('gerente', 'coordenador', 'gestor_projetos', 'investidor'));

-- 2) Quem hoje é Investidor e tem cargo Gestor de Projetos em Pessoas passa pro novo perfil
UPDATE ruston_usuario_perfil u
   SET perfil = 'gestor_projetos'
  FROM ruston_pessoas p
 WHERE u.perfil = 'investidor'
   AND p.cargo = 'gestor_projetos'
   AND (p.id = u.pessoa_id OR lower(p.email) = lower(u.email));

-- 3) Conferência de E.E: Gerente, Coordenador e Gestor de Projetos (padrão/POP só o Gerente edita)
DROP POLICY IF EXISTS so_gerente ON ruston_ee_conferencias;
DROP POLICY IF EXISTS operacao_le ON ruston_ee_conferencias;
CREATE POLICY operacao_le ON ruston_ee_conferencias FOR SELECT TO authenticated
  USING ((SELECT ruston_perfil_atual()) IN ('gerente', 'coordenador', 'gestor_projetos'));
DROP POLICY IF EXISTS operacao_grava ON ruston_ee_conferencias;
CREATE POLICY operacao_grava ON ruston_ee_conferencias FOR INSERT TO authenticated
  WITH CHECK ((SELECT ruston_perfil_atual()) IN ('gerente', 'coordenador', 'gestor_projetos'));
DROP POLICY IF EXISTS gerente_altera ON ruston_ee_conferencias;
CREATE POLICY gerente_altera ON ruston_ee_conferencias FOR UPDATE TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'gerente') WITH CHECK ((SELECT ruston_perfil_atual()) = 'gerente');
DROP POLICY IF EXISTS gerente_apaga ON ruston_ee_conferencias;
CREATE POLICY gerente_apaga ON ruston_ee_conferencias FOR DELETE TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'gerente');

DROP POLICY IF EXISTS so_gerente ON ruston_ee_padroes;
DROP POLICY IF EXISTS operacao_le ON ruston_ee_padroes;
CREATE POLICY operacao_le ON ruston_ee_padroes FOR SELECT TO authenticated
  USING ((SELECT ruston_perfil_atual()) IN ('gerente', 'coordenador', 'gestor_projetos'));
DROP POLICY IF EXISTS gerente_grava ON ruston_ee_padroes;
CREATE POLICY gerente_grava ON ruston_ee_padroes FOR ALL TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'gerente') WITH CHECK ((SELECT ruston_perfil_atual()) = 'gerente');

DROP POLICY IF EXISTS ee_conf_gerente_le ON storage.objects;
CREATE POLICY ee_conf_gerente_le ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ee-conferencias' AND (SELECT public.ruston_perfil_atual()) IN ('gerente', 'coordenador', 'gestor_projetos'));
DROP POLICY IF EXISTS ee_conf_gerente_sobe ON storage.objects;
CREATE POLICY ee_conf_gerente_sobe ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ee-conferencias' AND (SELECT public.ruston_perfil_atual()) IN ('gerente', 'coordenador', 'gestor_projetos'));

NOTIFY pgrst, 'reload schema';

-- Conferir: SELECT email, perfil FROM ruston_usuario_perfil ORDER BY perfil, email;
