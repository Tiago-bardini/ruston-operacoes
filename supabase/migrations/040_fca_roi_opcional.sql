-- =====================================================================
-- 040: FCA — ROI opcional na nota final
-- O ROI só sai no começo do mês seguinte. Regra nova:
--   * os 5 critérios semanais (resultado 7, tráfego 5, prazo 5, qualidade 4,
--     relacionamento 4) são obrigatórios;
--   * sem ROI: média ponderada dos 5 (÷ 25);
--   * com ROI: entra com peso 8 (÷ 33), como antes.
-- A view ruston_fca_view foi criada fora das migrations. Para não depender do
-- texto dela, a view atual vira ruston_fca_view_base (sem mudança) e uma nova
-- ruston_fca_view repete TODAS as colunas na mesma ordem, recalculando só
-- nota_final e bandeira. Para voltar atrás: ver o bloco no fim.
-- =====================================================================

CREATE OR REPLACE FUNCTION ruston_fca_nota_final(
  p_resultado NUMERIC, p_trafego NUMERIC, p_prazo NUMERIC,
  p_qualidade NUMERIC, p_relacionamento NUMERIC, p_roi NUMERIC
) RETURNS NUMERIC
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN p_resultado IS NULL OR p_trafego IS NULL OR p_prazo IS NULL
      OR p_qualidade IS NULL OR p_relacionamento IS NULL THEN NULL
    WHEN p_roi IS NULL THEN
      round((p_resultado * 7 + p_trafego * 5 + p_prazo * 5 + p_qualidade * 4 + p_relacionamento * 4) / 25.0, 2)
    ELSE
      round((p_resultado * 7 + p_trafego * 5 + p_prazo * 5 + p_qualidade * 4 + p_relacionamento * 4 + p_roi * 8) / 33.0, 2)
  END
$$;

DO $$
DECLARE
  v_cols TEXT;
  v_opts TEXT[];
  v_nota TEXT := 'ruston_fca_nota_final(b.nota_resultado, b.nota_operacao_trafego, b.nota_prazo, b.nota_qualidade, b.nota_relacionamento, b.nota_roi)';
BEGIN
  -- Só renomeia na primeira vez (rodar de novo é seguro)
  IF to_regclass('public.ruston_fca_view_base') IS NULL THEN
    ALTER VIEW public.ruston_fca_view RENAME TO ruston_fca_view_base;
  ELSE
    DROP VIEW IF EXISTS public.ruston_fca_view;
  END IF;

  SELECT reloptions INTO v_opts FROM pg_class WHERE oid = 'public.ruston_fca_view_base'::regclass;

  SELECT string_agg(
           CASE a.attname
             WHEN 'nota_final' THEN format('(%s)::%s AS nota_final', v_nota, format_type(a.atttypid, a.atttypmod))
             WHEN 'bandeira' THEN format(
               '(CASE WHEN %1$s IS NULL THEN ''sem_dado'' WHEN %1$s >= 8 THEN ''verde'' WHEN %1$s >= 6 THEN ''amarelo'' ELSE ''vermelho'' END)::%2$s AS bandeira',
               v_nota, format_type(a.atttypid, a.atttypmod))
             ELSE format('b.%I', a.attname)
           END, ', ' ORDER BY a.attnum)
    INTO v_cols
    FROM pg_attribute a
   WHERE a.attrelid = 'public.ruston_fca_view_base'::regclass AND a.attnum > 0 AND NOT a.attisdropped;

  EXECUTE format('CREATE VIEW public.ruston_fca_view %s AS SELECT %s FROM public.ruston_fca_view_base b',
                 CASE WHEN v_opts IS NULL THEN '' ELSE 'WITH (' || array_to_string(v_opts, ', ') || ')' END,
                 v_cols);
END $$;

GRANT SELECT ON public.ruston_fca_view TO authenticated, service_role;
REVOKE ALL ON public.ruston_fca_view FROM anon;

NOTIFY pgrst, 'reload schema';

-- Conferência: FCAs recentes sem ROI agora têm nota
SELECT data_referencia, nota_resultado, nota_operacao_trafego, nota_prazo, nota_qualidade, nota_relacionamento, nota_roi, nota_final, bandeira
  FROM ruston_fca_view ORDER BY data_referencia DESC LIMIT 15;

-- Para voltar atrás (se precisar):
--   DROP VIEW ruston_fca_view; ALTER VIEW ruston_fca_view_base RENAME TO ruston_fca_view; NOTIFY pgrst, 'reload schema';
