// =====================================================================
// ANALISAR REUNIÕES COM IA
// =====================================================================
// - Cron (Authorization: Bearer CRON_SECRET): analisa as reuniões importadas
//   que já têm cliente e ainda não foram analisadas.
// - Painel (usuário gerente/coordenador): { reuniao_id, cliente_id? }
//   vincula o cliente (se vier) e analisa na hora.
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createServerClient } from "@/lib/supabase/server";
import { analisarReuniao } from "@/lib/reunioesImport";

export const runtime = "nodejs";
export const maxDuration = 300;

// A Vercel corta em 300s. Cada reunião longa leva 1 a 3 min na IA, então o cron
// só começa uma nova análise se ainda sobrar tempo, e cada chamada tem prazo.
const LOTE = 6;
const ORCAMENTO_MS = 270_000;   // tempo total que o cron pode usar
const INICIAR_ATE_MS = 150_000; // depois disso não começa outra reunião

export async function POST(req: Request) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase nao configurado" }, { status: 500 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY nao configurada" }, { status: 500 });
  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  const cron = process.env.CRON_SECRET;
  if (cron && req.headers.get("authorization") === `Bearer ${cron}`) {
    const { data: pendentes } = await supabase.from("ruston_reunioes_cliente")
      .select("id")
      .not("cliente_id", "is", null)
      .not("transcricao", "is", null)
      .is("analisado_em", null)
      // Mais recentes primeiro: uma reunião antiga que sempre falha não trava a fila
      .order("data_reuniao", { ascending: false })
      .limit(LOTE);

    const inicio = Date.now();
    const stats = { analisadas: 0, erros: 0, adiadas: 0 };
    for (const p of pendentes ?? []) {
      const passou = Date.now() - inicio;
      if (passou > INICIAR_ATE_MS) { stats.adiadas++; continue; }
      try { await analisarReuniao(supabase, p.id, ANTHROPIC_KEY, ORCAMENTO_MS - passou); stats.analisadas++; }
      catch (e: any) { console.error("[reunioes-analisar] erro:", p.id, e?.message ?? e); stats.erros++; }
    }
    return NextResponse.json({ ok: true, stats });
  }

  // Chamada do painel: só gerente e coordenador
  const sb = createServerClient();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  const { data: perfil } = await supabase.from("ruston_usuario_perfil")
    .select("perfil").eq("email", user.email ?? "").maybeSingle();
  if (!perfil || !["gerente", "coordenador"].includes(perfil.perfil)) {
    return NextResponse.json({ error: "Sem permissão" }, { status: 403 });
  }

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  if (!body?.reuniao_id) return NextResponse.json({ error: "reuniao_id obrigatorio" }, { status: 400 });

  if (body.cliente_id) {
    const { error } = await supabase.from("ruston_reunioes_cliente")
      .update({ cliente_id: body.cliente_id }).eq("id", body.reuniao_id);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  try {
    await analisarReuniao(supabase, body.reuniao_id, ANTHROPIC_KEY);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
