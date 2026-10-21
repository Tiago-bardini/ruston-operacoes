import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calcHealthScore, taxaTarefasPorCliente } from "@/lib/healthScore";

export const runtime = "nodejs";
export const maxDuration = 30;

const Z_URL = "https://api.z-api.io";

export async function GET() {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const INST = process.env.ZAPI_INSTANCE_ID;
  const TOK = process.env.ZAPI_TOKEN;
  const CLIENT = process.env.ZAPI_CLIENT_TOKEN;
  const GRUPO = process.env.ZAPI_GRUPO_NOTIFICACOES;

  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase nao configurado" }, { status: 500 });
  if (!INST || !TOK || !CLIENT || !GRUPO) return NextResponse.json({ error: "Z-API nao configurada" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  const [{ data: clientes }, { data: fcas }, { data: radar }, { data: alertasHoje }, { data: tarefas }, { data: tarefasCliente }] = await Promise.all([
    supabase.from("ruston_clientes_view").select("id, nome, mrr, coordenador_nome, squad_nome, etapa").eq("ativo", true),
    supabase.from("ruston_fca_view").select("cliente_id, nota_final").order("data_referencia", { ascending: false }),
    supabase.from("ruston_whatsapp_radar_view").select("cliente_id, risco_churn, sentimento, dias_sem_contato"),
    supabase.from("ruston_whatsapp_alertas").select("id, tipo").gte("criado_em", new Date().toISOString().slice(0, 10) + "T00:00:00"),
    supabase.from("ruston_ekyte_tasks_view").select("pessoa_nome, esta_atrasada").eq("esta_atrasada", true),
    supabase.from("ruston_ekyte_tasks_view").select("cliente_id, situation, esta_atrasada").not("cliente_id", "is", null),
  ]);

  const clientesAtivos = (clientes ?? []).filter((c: any) => c.etapa !== "cancelado" && c.etapa !== "suspenso");
  const mrrTotal = clientesAtivos.reduce((a: number, c: any) => a + (c.mrr ?? 0), 0);

  const fcaMap: Record<string, number> = {};
  for (const f of (fcas ?? []) as any[]) { if (!fcaMap[f.cliente_id]) fcaMap[f.cliente_id] = f.nota_final; }
  const radarMap = Object.fromEntries((radar ?? []).map((r: any) => [r.cliente_id, r]));
  const taxaMap = taxaTarefasPorCliente((tarefasCliente ?? []) as any[]);

  const emRisco = clientesAtivos
    .map((c: any) => {
      const w = radarMap[c.id];
      const score = calcHealthScore({
        fca_nota: fcaMap[c.id] ?? null,
        wa_sentimento: w?.sentimento ?? null,
        wa_risco_churn: w?.risco_churn ?? null,
        wa_dias_sem_contato: w?.dias_sem_contato ?? null,
        tarefas_taxa: taxaMap[c.id]?.taxa ?? null,
      });
      return { nome: c.nome, score, mrr: c.mrr, coord: c.coordenador_nome };
    })
    .sort((a: any, b: any) => a.score - b.score)
    .slice(0, 5);

  const mrrRisco = emRisco.filter((c: any) => c.score < 6).reduce((a: number, c: any) => a + (c.mrr ?? 0), 0);

  const atrasadasMap: Record<string, number> = {};
  for (const t of (tarefas ?? []) as any[]) {
    const nome = t.pessoa_nome ?? "?";
    atrasadasMap[nome] = (atrasadasMap[nome] ?? 0) + 1;
  }
  const topAtrasadas = Object.entries(atrasadasMap).sort((a, b) => b[1] - a[1]).slice(0, 5);

  const alertasSla = ((alertasHoje ?? []) as any[]).filter((a: any) => a.tipo === "sla_30min").length;

  const hoje = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
  let msg = `*Resumo Operacional Ruston*\n${hoje}\n\n`;
  msg += `*MRR Total:* R$ ${mrrTotal.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}\n`;
  msg += `*MRR em Risco:* R$ ${mrrRisco.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}\n`;
  msg += `*Clientes Ativos:* ${clientesAtivos.length}\n`;
  msg += `*Alertas SLA hoje:* ${alertasSla}\n\n`;

  msg += `*Top 5 Clientes em Risco:*\n`;
  for (const c of emRisco) {
    const emoji = c.score >= 8 ? "🟢" : c.score >= 6 ? "🟡" : "🔴";
    msg += `${emoji} ${c.nome} (${c.score.toFixed(1)}) - ${c.coord ?? "sem coord"}\n`;
  }

  if (topAtrasadas.length > 0) {
    msg += `\n*Pendencias do Time:*\n`;
    for (const [nome, qtd] of topAtrasadas) {
      msg += `⚠ ${nome}: ${qtd} tarefas atrasadas\n`;
    }
  }

  try {
    const url = `${Z_URL}/instances/${INST}/token/${TOK}/send-text`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Client-Token": CLIENT },
      body: JSON.stringify({ phone: GRUPO, message: msg }),
    });
    if (!res.ok) {
      const t = await res.text();
      return NextResponse.json({ ok: false, error: `Z-API ${res.status}: ${t}` }, { status: 500 });
    }
    return NextResponse.json({ ok: true, msg });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST() { return GET(); }
