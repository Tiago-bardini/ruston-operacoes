// =====================================================================
// Tokens pessoais do MCP (tela Conexão IA)
// GET  → meus tokens (sem o valor)       POST → gera um novo (valor aparece 1 vez)
// PATCH { id } → revoga
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { hashToken, novoToken, papelDoEmail, servico } from "@/lib/mcp/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function usuarioLogado() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, email: user?.email?.toLowerCase() ?? null };
}

export async function GET() {
  const { supabase, email } = await usuarioLogado();
  if (!email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const acesso = await papelDoEmail(servico(), email);
  const { data, error } = await supabase.from("ruston_mcp_tokens")
    .select("id, prefixo, nome, criado_em, ultimo_uso_em, revogado_em, somente_leitura")
    .ilike("email", email).order("criado_em", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ pode_usar: !!acesso, papel: acesso?.papel ?? null, tokens: data });
}

export async function POST(req: Request) {
  const { email } = await usuarioLogado();
  if (!email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const sb = servico();
  if (!(await papelDoEmail(sb, email))) {
    return NextResponse.json({ error: "O MCP é liberado só para Gerente, Coordenador e Gestor de Projetos." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const token = novoToken();
  const { error } = await sb.from("ruston_mcp_tokens").insert({
    email, token_hash: hashToken(token), prefixo: token.slice(0, 8), nome: String(body?.nome ?? "Claude").slice(0, 60),
    somente_leitura: body?.somente_leitura === true,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  const base = process.env.NEXT_PUBLIC_SITE_URL ?? new URL(req.url).origin;
  return NextResponse.json({ token, url: `${base}/api/mcp/${token}`, url_cabecalho: `${base}/api/mcp` });
}

export async function PATCH(req: Request) {
  const { supabase, email } = await usuarioLogado();
  if (!email) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { id } = await req.json().catch(() => ({}));
  if (!id) return NextResponse.json({ error: "id obrigatório" }, { status: 400 });
  const { data, error } = await supabase.from("ruston_mcp_tokens")
    .update({ revogado_em: new Date().toISOString() }).eq("id", id).select("id");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Token não encontrado" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
