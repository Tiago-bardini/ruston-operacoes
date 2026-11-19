-- =====================================================================
-- 039: MCP do Coordenador
-- 1) Coordenador passa a LER o Log de alterações (o MCP filtra só os
--    clientes do squad dele). Continua sem ninguém editar/apagar o log.
-- 2) Lucas fica igual à Anny: perfil Coordenador (que já faz o papel de
--    Gestor de Projetos no MCP e no sistema).
-- =====================================================================

-- 1) Log de alterações: Gerente e Coordenador leem
DROP POLICY IF EXISTS "coordenador_le_log_alteracoes" ON ruston_log_alteracoes;
CREATE POLICY "coordenador_le_log_alteracoes" ON ruston_log_alteracoes
  FOR SELECT TO authenticated
  USING ((SELECT ruston_perfil_atual()) = 'coordenador');

-- 2a) PRÉVIA: como estão a Anny e o Lucas hoje
SELECT u.email, u.perfil, u.ativo, s.nome AS squad_do_usuario, p.nome AS pessoa, p.cargo, sp.nome AS squad_da_pessoa
  FROM ruston_usuario_perfil u
  LEFT JOIN ruston_pessoas p  ON p.id = u.pessoa_id OR lower(p.email) = lower(u.email)
  LEFT JOIN ruston_squads  s  ON s.id = u.squad_id
  LEFT JOIN ruston_squads  sp ON sp.id = p.squad_id
 WHERE u.email ILIKE '%anny%' OR u.email ILIKE '%lucas%' OR p.nome ILIKE 'anny%' OR p.nome ILIKE 'lucas%';

-- 2b) Lucas recebe o mesmo perfil e cargo da Anny. Só roda se achar
--     exatamente 1 Anny e 1 Lucas com usuário ativo; senão avisa e não muda nada.
DO $$
DECLARE
  v_anny RECORD; v_lucas RECORD; n_anny INT; n_lucas INT;
BEGIN
  SELECT count(*) INTO n_anny FROM ruston_usuario_perfil u
    LEFT JOIN ruston_pessoas p ON p.id = u.pessoa_id OR lower(p.email) = lower(u.email)
   WHERE coalesce(u.ativo, true) AND (u.email ILIKE '%anny%' OR p.nome ILIKE 'anny%');
  SELECT count(*) INTO n_lucas FROM ruston_usuario_perfil u
    LEFT JOIN ruston_pessoas p ON p.id = u.pessoa_id OR lower(p.email) = lower(u.email)
   WHERE coalesce(u.ativo, true) AND (u.email ILIKE '%lucas%' OR p.nome ILIKE 'lucas%');
  IF n_anny <> 1 OR n_lucas <> 1 THEN
    RAISE NOTICE 'Não alterei: achei % Anny e % Lucas. Me mande a prévia (2a) que eu ajusto pelo e-mail.', n_anny, n_lucas;
    RETURN;
  END IF;

  SELECT u.perfil, p.cargo INTO v_anny FROM ruston_usuario_perfil u
    LEFT JOIN ruston_pessoas p ON p.id = u.pessoa_id OR lower(p.email) = lower(u.email)
   WHERE coalesce(u.ativo, true) AND (u.email ILIKE '%anny%' OR p.nome ILIKE 'anny%');
  SELECT u.id, u.email, u.pessoa_id INTO v_lucas FROM ruston_usuario_perfil u
    LEFT JOIN ruston_pessoas p ON p.id = u.pessoa_id OR lower(p.email) = lower(u.email)
   WHERE coalesce(u.ativo, true) AND (u.email ILIKE '%lucas%' OR p.nome ILIKE 'lucas%');

  UPDATE ruston_usuario_perfil SET perfil = v_anny.perfil, updated_at = now() WHERE id = v_lucas.id;
  IF v_anny.cargo IS NOT NULL THEN
    UPDATE ruston_pessoas SET cargo = v_anny.cargo, updated_at = now()
     WHERE id = v_lucas.pessoa_id OR lower(email) = lower(v_lucas.email);
  END IF;
  RAISE NOTICE 'Lucas (%) agora: perfil %, cargo %', v_lucas.email, v_anny.perfil, v_anny.cargo;
END $$;

NOTIFY pgrst, 'reload schema';

-- 2c) Conferência: rode a prévia (2a) de novo; Lucas deve estar igual à Anny.
