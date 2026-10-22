// =====================================================================
// IMPORTAR REUNIÕES DO GOOGLE MEET — chamado pelo Apps Script do Google
// =====================================================================
// POST com header `Authorization: Bearer <REUNIOES_INGEST_TOKEN>` e corpo
//   { reunioes: [{ event_id, titulo, inicio, fim, participantes, transcricao }] }
// Só grava. A IA roda depois em /api/reunioes-analisar (cron ou botão).
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { importarReuniao, type ReuniaoRecebida } from "@/lib/reunioesImport";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  // Sem token cadastrado a rota fica fechada: ela grava dados de clientes
  const token = process.env.REUNIOES_INGEST_TOKEN;
  if (!token || req.headers.get("authorization") !== `Bearer ${token}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }

  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase nao configurado" }, { status: 500 });
  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const reunioes: ReuniaoRecebida[] = Array.isArray(body?.reunioes) ? body.reunioes : [];

  const resultados = [];
  for (const r of reunioes.slice(0, 50)) {
    if (!r?.event_id) { resultados.push({ event_id: null, status: "sem_event_id" }); continue; }
    try {
      resultados.push({ event_id: r.event_id, ...(await importarReuniao(supabase, r)) });
    } catch (e: any) {
      console.error("[reunioes-importar] erro:", r.event_id, e?.message ?? e);
      resultados.push({ event_id: r.event_id, status: "erro", erro: String(e?.message ?? e) });
    }
  }
  return NextResponse.json({ ok: true, resultados });
}
