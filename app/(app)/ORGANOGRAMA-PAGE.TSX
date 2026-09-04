========================================================
Sprint Organograma — Passo a passo pra aplicar
========================================================

┌──────────────────────────────────────────────────────┐
│ PASSO 1 — SQL de migração                            │
└──────────────────────────────────────────────────────┘

Arquivo: organograma_migration.sql

1. Supabase → SQL Editor → New query
2. Cola tudo → Run
3. Deve retornar "Success"

O que faz:
  - Adiciona campos em ruston_pessoas: area_organograma,
    ordem_org, organograma_row, role_organograma
  - Não cria tabelas novas
  - Não precisa mexer em RLS (usa a policy que já existe)


┌──────────────────────────────────────────────────────┐
│ PASSO 2 — Criar bucket de storage 'fotos-pessoas'    │
└──────────────────────────────────────────────────────┘

Isso NÃO dá pra fazer por SQL, tem que ser pela UI:

1. Supabase → menu lateral → "Storage"
2. Botão "+ New bucket"
3. Nome: fotos-pessoas
4. Marca "Public bucket" (ON)
5. Salva

Depois cria as policies:
6. Clica no bucket criado
7. Aba "Policies" → "New policy"
8. Cria 2 policies (usa o wizard "Get started quickly"):
   - Policy 1: "Allow authenticated uploads"
     → SELECT operation: INSERT
     → Target roles: authenticated
     → USING/WITH CHECK: true
   - Policy 2: "Allow public reads"
     → SELECT operation: SELECT
     → Target roles: anon, authenticated
     → USING: true


┌──────────────────────────────────────────────────────┐
│ PASSO 3 — SQL de seed (popular pessoas)              │
└──────────────────────────────────────────────────────┘

Arquivo: organograma_seed.sql

1. Supabase → SQL Editor → New query
2. Cola tudo → Run

O que faz:
  - Cria squads BRAVA e OLIMPO se não existirem
  - Insere 22 pessoas (baseadas no data.js do ruston-fluxos)
  - Nicolas = gerente (e vai aparecer também como Coord ADM)
  - Guilherme = coord ISAAS
  - PESI e TIAGO como coordenadores dos squads

Depois vai em /pessoas e:
  - Adiciona o CAIO manualmente (não estava no data.js antigo)
  - Confere se algum campo precisa de ajuste


┌──────────────────────────────────────────────────────┐
│ PASSO 4 — Estender types.ts com cargos novos         │
└──────────────────────────────────────────────────────┘

Abre lib/types.ts.
Encontra a linha:

    export type Cargo =
      | "coordenador"
      | "gestor_projetos"
      | "gestor_trafego"
      | "designer"
      | "social_media"
      | "copy"
      | "gerente"
      | "coo"
      | "tech"
      | "outro";

Substitui por:

    export type Cargo =
      | "coordenador"
      | "gestor_projetos"
      | "gestor_trafego"
      | "designer"
      | "social_media"
      | "copy"
      | "gerente"
      | "coo"
      | "tech"
      | "closer"
      | "pre_vendas"
      | "pp"
      | "financeiro"
      | "isaas"
      | "outro";

E encontra o objeto CARGO_LABEL logo abaixo:

    export const CARGO_LABEL: Record<Cargo, string> = {
      coordenador: "Coordenador",
      ...
      outro: "Outro",
    };

Adiciona ANTES do "outro":

      closer: "Closer",
      pre_vendas: "Pré-Vendas",
      pp: "P&P",
      financeiro: "Financeiro",
      isaas: "ISAAS",

Ficando assim (só o final):

      ...
      tech: "TECH",
      closer: "Closer",
      pre_vendas: "Pré-Vendas",
      pp: "P&P",
      financeiro: "Financeiro",
      isaas: "ISAAS",
      outro: "Outro",
    };

Também na interface Pessoa, adicione os campos novos.
Encontra:

    export interface Pessoa {
      id: string;
      nome: string;
      email: string | null;
      cargo: Cargo;
      squad_id: string | null;
      foto_url: string | null;
      ativo: boolean;
      observacoes: string | null;
      nivel_senioridade: NivelSenioridade | null;
      nivel_v: VersaoV | null;
      salario: number | null;
      compartilhado_entre_squads: boolean;
      created_at: string;
      updated_at: string;
    }

Adiciona 4 campos antes de "created_at":

      area_organograma: string | null;
      organograma_row: number;
      ordem_org: number;
      role_organograma: string | null;


┌──────────────────────────────────────────────────────┐
│ PASSO 5 — Criar página /organograma                  │
└──────────────────────────────────────────────────────┘

Arquivo: ORGANOGRAMA-page.tsx

No GitHub, cria arquivo novo:
  app/(app)/organograma/page.tsx

Cola todo o conteúdo do arquivo.


┌──────────────────────────────────────────────────────┐
│ PASSO 6 — Sidebar: adiciona link "Organograma"       │
└──────────────────────────────────────────────────────┘

No components/Sidebar.tsx, no array NAV_ACTIVE, adiciona:

  { href: "/organograma", label: "Organograma", icon: "👥" },

Coloca entre "Squads" e "Metas" fica bom:

  { href: "/cockpit", label: "Cockpit", icon: "★" },
  { href: "/clientes", label: "Clientes", icon: "◎" },
  { href: "/entregas", label: "Entregas", icon: "✎" },
  { href: "/pessoas", label: "Pessoas", icon: "◆" },
  { href: "/squads", label: "Squads", icon: "◇" },
  { href: "/organograma", label: "Organograma", icon: "👥" },  ← ADICIONE
  { href: "/metas", label: "Metas", icon: "◈" },
  ...


┌──────────────────────────────────────────────────────┐
│ PASSO 7 — Aguarda Vercel e testa                     │
└──────────────────────────────────────────────────────┘

1. Depois de commitar tudo, aguarda Vercel deployar (~1min)
2. Vai em /organograma
3. Deve aparecer:
   - Nicolas no topo (Gerente)
   - COMERCIAL e ADMINISTRATIVO na segunda linha
   - Squad BRAVA e Squad OLIMPO na terceira linha
4. Clica na foto (círculo) de qualquer pessoa
5. Abre modal → escolhe foto → salva
6. Foto sobe pro Supabase Storage e vira URL pública

Se der erro no upload:
  - Confere se o bucket 'fotos-pessoas' foi criado
  - Confere se marcou "Public bucket"
  - Confere se as 2 policies estão criadas


┌──────────────────────────────────────────────────────┐
│ PASSO 8 — Adiciona pessoas faltantes                 │
└──────────────────────────────────────────────────────┘

O data.js era antigo. Precisa adicionar manualmente:
  - Caio (GP Squad Brava)
  - Qualquer outra pessoa que entrou depois

Como fazer:
  1. Vai em /pessoas
  2. + Nova pessoa
  3. Preenche nome, cargo, squad, área
  4. Salva
  5. Volta em /organograma → aparece automaticamente


═══════════════════════════════════════════════════════
Depois de tudo aplicado, o /organograma funciona 100%:
- Fotos: clica no círculo → upload
- Editar pessoa: /pessoas
- Adicionar/remover: /pessoas
- Trocar squad: /pessoas
═══════════════════════════════════════════════════════
