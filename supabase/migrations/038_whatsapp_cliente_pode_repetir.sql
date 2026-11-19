-- 038: o mesmo WhatsApp pode estar em mais de um cliente
-- (dono com várias empresas = um cliente/grupo por empresa, mesmo telefone).
-- Remove qualquer trava de "valor único" que envolva a coluna whatsapp de ruston_clientes,
-- seja constraint UNIQUE ou índice único. Não mexe em nenhuma outra coluna.

DO $$
DECLARE r record;
BEGIN
  -- 1) Constraints UNIQUE que usam a coluna whatsapp
  FOR r IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_attribute att ON att.attrelid = con.conrelid AND att.attnum = ANY (con.conkey)
    WHERE con.conrelid = 'public.ruston_clientes'::regclass
      AND con.contype = 'u'
      AND att.attname = 'whatsapp'
  LOOP
    RAISE NOTICE 'Removendo constraint %', r.conname;
    EXECUTE format('ALTER TABLE public.ruston_clientes DROP CONSTRAINT %I', r.conname);
  END LOOP;

  -- 2) Índices únicos soltos (sem constraint) que usam whatsapp
  FOR r IN
    SELECT i.relname AS indexname
    FROM pg_index ix
    JOIN pg_class i ON i.oid = ix.indexrelid
    WHERE ix.indrelid = 'public.ruston_clientes'::regclass
      AND ix.indisunique
      AND NOT ix.indisprimary
      AND (
        EXISTS (SELECT 1 FROM pg_attribute a
                WHERE a.attrelid = ix.indrelid AND a.attnum = ANY (ix.indkey) AND a.attname = 'whatsapp')
        OR pg_get_indexdef(ix.indexrelid) ILIKE '%whatsapp%'
      )
  LOOP
    RAISE NOTICE 'Removendo índice único %', r.indexname;
    EXECUTE format('DROP INDEX IF EXISTS public.%I', r.indexname);
  END LOOP;
END $$;

-- Índice comum (sem trava) para a busca por número continuar rápida
CREATE INDEX IF NOT EXISTS idx_ruston_clientes_whatsapp ON public.ruston_clientes (whatsapp);

-- Conferência: deve voltar vazio (nenhuma trava única restante no whatsapp)
SELECT indexname, indexdef
FROM pg_indexes
WHERE tablename = 'ruston_clientes' AND indexdef ILIKE '%unique%' AND indexdef ILIKE '%whatsapp%';
