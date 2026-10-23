import { NextResponse } from "next/server";
import { exigirCron } from "@/lib/apiAuth";
import { createClient } from "@supabase/supabase-js";
import { inicioJanelaEkyte } from "@/lib/ekyteJanela";

export const runtime = "nodejs";
export const maxDuration = 30;

const Z_URL = "https://api.z-api.io";

function hs(fca: number | null, churn: string | null, sent: string | null): number {
  let s = fca ?? 5;
  if (sent === "positivo") s += 0.5; else if (sent === "negativo") s -= 0.5;
  if (churn === "baixo") s += 0.5; else if (churn === "alto") s -= 1.0; else if (churn === "medio") s -= 0.3;
  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

export async function GET(req: Request) {
  const negado = exigirCron(req);
  if (negado) return negado;
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const INST = process.env.ZAPI_INSTANCE_ID;
  const TOK = process.env.ZAPI_TOKEN;
  const CLIENT = process.env.ZAPI_CLIENT_TOKEN;
  const GRUPO = process.env.ZAPI_GRUPO_NOTIFICACOES;

  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase nao configurado" }, { status: 500 });
  if (!INST || !TOK || !CLIENT || !GRUPO) return NextResponse.json({ error: "Z-API nao configurada" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  const semanaAtras = new Date(Date.now() - 7 * 86400000).toISOString();

  const [{ data: clientes }, { data: fcasRecentes }, { data: fcasAntigas }, { data: radar }, { data: tarefas }, { data: alertas }, { data: squads }] = await Promise.all([
    supabase.from("ruston_clientes_view").select("id, nome, mrr, coordenador_nome, squad_nome, etapa").eq("ativo", true),
    supabase.from("ruston_fca_view").select("cliente_id, nota_final, data_referencia").order("data_referencia", { ascending: false }),
    supabase.from("ruston_fca_view").select("cliente_id, nota_final, data_referencia").order("data_referencia", { ascending: false }),
    supabase.from("ruston_whatsapp_radar_view").select("cliente_id, risco_churn, sentimento"),
    supabase.from("ruston_ekyte_tasks_dashboard").select("pessoa_nome, cliente_id, esta_atrasada, situation").eq("pessoa_ativa", true).gte("creation_date", inicioJanelaEkyte()).not("cliente_id", "is", null),
    supabase.from("ruston_whatsapp_alertas").select("id, tipo").gte("criado_em", semanaAtras),
    supabase.from("ruston_squads").select("id, nome").eq("ativo", true),
  ]);

  const ativos = (clientes ?? []).filter((c: any) => c.etapa !== "cancelado" && c.etapa !== "suspenso");
  const mrrTotal = ativos.reduce((a: number, c: any) => a + (c.mrr ?? 0), 0);

  // FCA mais recente por cliente
  const fcaMap: Record<string, number> = {};
  for (const f of (fcasRecentes ?? []) as any[]) { if (!fcaMap[f.cliente_id]) fcaMap[f.cliente_id] = f.nota_final; }
  const radarMap = Object.fromEntries((radar ?? []).map((r: any) => [r.cliente_id, r]));

  // Health scores
  const scores = ativos.map((c: any) => {
    const w = radarMap[c.id];
    const score = hs(fcaMap[c.id] ?? null, w?.risco_churn ?? null, w?.sentimento ?? null);
    return { nome: c.nome, score, mrr: c.mrr, squad: c.squad_nome, coord: c.coordenador_nome };
  }).sort((a: any, b: any) => a.score - b.score);

  // Ranking por squad
  const squadStats: Record<string, { total: number; somaScore: number; mrrTotal: number; atrasadas: number }> = {};
  for (const sq of (squads ?? []) as any[]) {
    squadStats[sq.nome] = { total: 0, somaScore: 0, mrrTotal: 0, atrasadas: 0 };
  }
  for (const s of scores) {
    if (s.squad && squadStats[s.squad]) {
      squadStats[s.squad].total++;
      squadStats[s.squad].somaScore += s.score;
      squadStats[s.squad].mrrTotal += s.mrr ?? 0;
    }
  }
  // Tarefas atrasadas por squad
  const clienteSquad: Record<string, string> = {};
  for (const c of ativos as any[]) { if (c.squad_nome) clienteSquad[c.id] = c.squad_nome; }
  for (const t of (tarefas ?? []) as any[]) {
    if (t.esta_atrasada && t.cliente_id && clienteSquad[t.cliente_id]) {
      const sq = clienteSquad[t.cliente_id];
      if (squadStats[sq]) squadStats[sq].atrasadas++;
    }
  }

  // Top 5 melhoraram (score alto) e top 5 pioraram (score baixo)
  const top5Risco = scores.slice(0, 5);
  const top5Saudaveis = [...scores].sort((a, b) => b.score - a.score).slice(0, 5);

  // Alertas da semana
  const alertasSla = ((alertas ?? []) as any[]).filter((a: any) => a.tipo === "sla_30min").length;
  const alertasMudo = ((alertas ?? []) as any[]).filter((a: any) => a.tipo === "grupo_mudo").length;
  const alertasRuston = ((alertas ?? []) as any[]).filter((a: any) => a.tipo === "ruston_mudo").length;

  // Montar mensagem
  const hoje = new Date();
  const semana = `${new Date(Date.now() - 7 * 86400000).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} a ${hoje.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}`;

  let msg = `*RELATORIO SEMANAL RUSTON*\nSemana ${semana}\n\n`;
  msg += `*Resumo Geral:*\n`;
  msg += `Clientes ativos: ${ativos.length}\n`;
  msg += `MRR total: R$ ${mrrTotal.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}\n`;
  msg += `Health Score medio: ${(scores.reduce((a: number, b: any) => a + b.score, 0) / scores.length).toFixed(1)}\n\n`;

  msg += `*Ranking por Squad:*\n`;
  const squadRank = Object.entries(squadStats)
    .filter(([, v]) => v.total > 0)
    .sort((a, b) => (b[1].somaScore / b[1].total) - (a[1].somaScore / a[1].total));
  for (const [nome, s] of squadRank) {
    const media = (s.somaScore / s.total).toFixed(1);
    const emoji = Number(media) >= 8 ? "🟢" : Number(media) >= 6 ? "🟡" : "🔴";
    msg += `${emoji} *${nome}*: ${media} medio | ${s.total} clientes | ${s.atrasadas} tarefas atrasadas\n`;
  }

  msg += `\n*Top 5 em Risco:*\n`;
  for (const c of top5Risco) {
    const emoji = c.score >= 8 ? "🟢" : c.score >= 6 ? "🟡" : "🔴";
    msg += `${emoji} ${c.nome} (${c.score.toFixed(1)}) - ${c.coord ?? "-"}\n`;
  }

  msg += `\n*Top 5 Saudaveis:*\n`;
  for (const c of top5Saudaveis) {
    msg += `🟢 ${c.nome} (${c.score.toFixed(1)}) - ${c.coord ?? "-"}\n`;
  }

  msg += `\n*Alertas da Semana:*\n`;
  msg += `⏰ SLA 30min: ${alertasSla}\n`;
  msg += `🔕 Grupos mudos: ${alertasMudo}\n`;
  msg += `🚫 Ruston mudo: ${alertasRuston}\n`;

  // Enviar
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

export async function POST(req: Request) { return GET(req); }
