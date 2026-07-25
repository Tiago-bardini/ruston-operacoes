# Ruston Operações

Painel operacional interno da Ruston & Co. Reúne múltiplos módulos consumindo a **base única de clientes** no Supabase.

## Stack
- Next.js 14 (App Router) + TypeScript + Tailwind
- Supabase (Postgres + Auth)
- Deploy: Vercel

## Módulos ativos (Sprint 2)
- `/clientes` — Painel de Clientes com 3 visualizações:
  - Kanban por Etapa (Onboarding, EE, By-line, Em Recuperação, Suspenso)
  - Lista (tabela completa)
  - Kanban por GP (agrupado por Gestor de Projetos)
- `/pessoas` — CRUD de pessoas com filtros por cargo e squad
- `/squads` — CRUD simples de squads

## Módulos em breve (próximas sprints)
- FCA (Fato-Causa-Ação) — notas ponderadas e flag calculada
- Entregas Mensais — controle de deliveries por cliente/gestor/mês
- Cockpit — dashboard operacional completo
- Headcount por Squad
- Forecast Anual
- Painel de Metas

## Setup Supabase (já feito)
Rode o SQL em `outputs/base_clientes_schema.sql` no Supabase SQL Editor.
Cria as tabelas `ruston_squads`, `ruston_pessoas`, `ruston_clientes` + view + RLS.

## Deploy Vercel
1. Sobe o projeto num repo Git (GitHub).
2. Vercel → New Project → importa o repo.
3. Env vars (Vercel → Project Settings → Environment Variables):
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://mrybhsjtymputwwmvuqz.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = `sb_publishable_...` (do Supabase Settings → API Keys)
4. Deploy.

## Primeira vez usando
1. Cria uma conta pelo `/login` (aba "Criar uma").
2. Vai em `/squads` — já vem BRAVA e OLIMPO cadastrados.
3. Vai em `/pessoas` — cadastra o time todo (coordenadores, GPs, GTs, designers).
4. Vai em `/clientes` — cadastra os clientes referenciando as pessoas.

## Segurança
- RLS ativo: qualquer usuário autenticado pode ler/escrever.
- Restrição por papel (Coord Geral / Coord Equipe / Account / Tráfego-Designer) vem na Sprint 11 (última).

## Estrutura
```
app/
  login/          → tela de login/cadastro
  (app)/          → área autenticada (guard no layout)
    layout.tsx    → checa sessão e monta sidebar
    clientes/     → Painel de Clientes (3 visualizações)
    pessoas/      → CRUD pessoas
    squads/       → CRUD squads
components/
  Sidebar.tsx     → menu lateral + logout
lib/
  supabase/       → clients browser/server/middleware
  types.ts        → tipos + labels + helpers
middleware.ts     → renova sessão e redireciona não autenticado
```
