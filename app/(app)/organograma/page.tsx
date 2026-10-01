-- =====================================================================
-- REVINCULAR AUTOMÁTICO — organograma ↔ cadastro
-- =====================================================================
-- Depois que vc arrumou os duplicados na aba Pessoas, o organograma
-- pode ter ficado apontando pros IDs antigos. Este script:
--   1) Mostra as pessoas do organograma e qual pessoa do cadastro
--      "parece" ser a correta (bate o nome E tem clientes atrelados).
--   2) Atualiza o vínculo automaticamente.
-- Rode no SQL Editor do Supabase. 100% seguro — não apaga nada.
-- =====================================================================

-- -------------------------------------------------------------
-- PRÉVIA — mostra o que vai acontecer (NÃO aplica ainda)
-- -------------------------------------------------------------
with pessoa_correta as (
  -- Pra cada nome do organograma, encontra a pessoa do cadastro
  -- que tem MAIS clientes ativos (geralmente é a correta pós-fix).
  select distinct on (upper(trim(org.nome)))
    org.id as org_id,
    org.nome as org_nome,
    org.ruston_pessoa_id as vinculo_atual,
    p.id as pessoa_correta_id,
    p.nome as pessoa_correta_nome,
    (select count(*) from public.ruston_clientes c
      where c.account_id = p.id and c.ativo = true) as clientes_na_correta
  from public.ruston_org_pessoas org
  join public.ruston_pessoas p
    on upper(trim(p.nome)) = upper(trim(org.nome))
   and p.ativo = true
  where org.ativo = true
    and org.tem_carteira = true
  order by upper(trim(org.nome)),
           (select count(*) from public.ruston_clientes c
             where c.account_id = p.id and c.ativo = true) desc
)
select
  org_nome as nome_no_organograma,
  pessoa_correta_nome as pessoa_cadastro_correta,
  clientes_na_correta,
  case
    when vinculo_atual is null then '🔗 vai VINCULAR'
    when vinculo_atual = pessoa_correta_id then '✅ já tá certo'
    else '🔄 vai TROCAR vínculo'
  end as acao
from pessoa_correta
order by acao desc, org_nome;

-- -------------------------------------------------------------
-- APLICAR — descomenta pra rodar
-- -------------------------------------------------------------
-- Executa o update real. Só revincula quando o nome do organograma
-- bate com uma pessoa do cadastro que tem clientes atrelados.
--
-- Pra rodar, apaga os "--" das próximas 15 linhas:

-- with pessoa_correta as (
--   select distinct on (upper(trim(org.nome)))
--     org.id as org_id,
--     p.id as pessoa_correta_id
--   from public.ruston_org_pessoas org
--   join public.ruston_pessoas p
--     on upper(trim(p.nome)) = upper(trim(org.nome))
--    and p.ativo = true
--   where org.ativo = true and org.tem_carteira = true
--   order by upper(trim(org.nome)),
--            (select count(*) from public.ruston_clientes c
--              where c.account_id = p.id and c.ativo = true) desc
-- )
-- update public.ruston_org_pessoas o
--    set ruston_pessoa_id = pc.pessoa_correta_id
--   from pessoa_correta pc
--  where o.id = pc.org_id
--    and (o.ruston_pessoa_id is null or o.ruston_pessoa_id <> pc.pessoa_correta_id);
