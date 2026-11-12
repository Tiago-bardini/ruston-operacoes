-- =====================================================================
-- CONFERÊNCIA DE E.E liberada para Coordenador e Gestor de Projetos (perfil investidor)
-- Todos leem e rodam conferências; o padrão (POP) de cada semana continua só do Gerente.
-- =====================================================================

-- Conferências: os três perfis leem e gravam
DROP POLICY IF EXISTS so_gerente ON ruston_ee_conferencias;
DROP POLICY IF EXISTS operacao_le ON ruston_ee_conferencias;
CREATE POLICY operacao_le ON ruston_ee_conferencias FOR SELECT TO authenticated
  USING ((SELECT ruston_perfil_atual()) IN ('gerente', 'coordenador', 'investidor'));
DROP POLICY IF EXISTS operacao_grava ON ruston_ee_conferencias;
CREATE POLICY operacao_grava ON ruston_ee_conferencias FOR INSERT TO authenticated
  WITH CHECK ((SELECT ruston_perfil_atual()) IN ('gerente', 'coordenador', 'investidor'));
DROP POLICY IF EXISTS gerente_altera ON ruston_ee_conferencias;
CREATE POLICY gerente_altera ON ruston_ee_conferencias FOR UPDATE TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'gerente') WITH CHECK ((SELECT ruston_perfil_atual()) = 'gerente');
DROP POLICY IF EXISTS gerente_apaga ON ruston_ee_conferencias;
CREATE POLICY gerente_apaga ON ruston_ee_conferencias FOR DELETE TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'gerente');

-- Padrões: todos leem (a conferência usa), só o Gerente edita
DROP POLICY IF EXISTS so_gerente ON ruston_ee_padroes;
DROP POLICY IF EXISTS operacao_le ON ruston_ee_padroes;
CREATE POLICY operacao_le ON ruston_ee_padroes FOR SELECT TO authenticated
  USING ((SELECT ruston_perfil_atual()) IN ('gerente', 'coordenador', 'investidor'));
DROP POLICY IF EXISTS gerente_grava ON ruston_ee_padroes;
CREATE POLICY gerente_grava ON ruston_ee_padroes FOR ALL TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'gerente') WITH CHECK ((SELECT ruston_perfil_atual()) = 'gerente');

-- Arquivos das apresentações
DROP POLICY IF EXISTS ee_conf_gerente_le ON storage.objects;
CREATE POLICY ee_conf_gerente_le ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'ee-conferencias' AND (SELECT public.ruston_perfil_atual()) IN ('gerente', 'coordenador', 'investidor'));
DROP POLICY IF EXISTS ee_conf_gerente_sobe ON storage.objects;
CREATE POLICY ee_conf_gerente_sobe ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'ee-conferencias' AND (SELECT public.ruston_perfil_atual()) IN ('gerente', 'coordenador', 'investidor'));

NOTIFY pgrst, 'reload schema';
