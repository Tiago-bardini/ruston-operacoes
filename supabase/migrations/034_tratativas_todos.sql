-- =====================================================================
-- TRATATIVAS DE CHURN: qualquer usuário ativo do sistema registra
-- (Gerente, Coordenador, Gestor de Projetos e Investidor).
-- Editar/excluir: Gerente e Coordenador em todas; os demais só as próprias.
-- =====================================================================
DROP POLICY IF EXISTS "tratativas_inclui" ON ruston_tratativas_churn;
CREATE POLICY "tratativas_inclui" ON ruston_tratativas_churn
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT ruston_perfil_atual()) IS NOT NULL);

NOTIFY pgrst, 'reload schema';
