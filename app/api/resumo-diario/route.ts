import { NextResponse } from "next/server";
import { exigirCron } from "@/lib/apiAuth";
import { createClient } from "@supabase/supabase-js";
import { avaliarRiscoChurn, carregarDadosRadar } from "@/lib/radarChurn";
import { inicioJanelaEkyte } from "@/lib/ekyteJanela";

export const runtime = "nodejs";
export const maxDuration = 30;

const Z_URL = "https://api.z-api.io";

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

  const [{ data: clientes }, dadosRadar, { data: alertasHoje }, { data: tarefas }] = await Promise.all([
    supabase.from("ruston_clientes_view").select("id, nome, mrr, coordenador_nome, squad_nome, etapa").eq("ativo", true),
    carregarDadosRadar(supabase),
    supabase.from("ruston_whatsapp_alertas").select("id, tipo").gte("criado_em", new Date().toISOString().slice(0, 10) + "T00:00:00"),
    supabase.from("ruston_ekyte_tasks_dashboard").select("pessoa_nome, esta_atrasada").eq("pessoa_ativa", true).gte("creation_date", inicioJanelaEkyte()).eq("esta_atrasada", true),
  ]);

  const clientesAtivos = (clientes ?? []).filter((c: any) => c.etapa !== "cancelado" && c.etapa !== "suspenso");
  const mrrTotal = clientesAtivos.reduce((a: number, c: any) => a + (c.mrr ?? 0), 0);

  // Mesmo cálculo do Radar de Churn: crítico + atenção = MRR em risco
  const coordPorCliente = Object.fromEntries((clientes ?? []).map((c: any) => [c.id, c.coordenador_nome]));
  const emRiscoTodos = dadosRadar
    .map((d) => ({ d, av: avaliarRiscoChurn(d) }))
    .filter((x) => x.av.nivel === "critico" || x.av.nivel === "atencao")
    .sort((a, b) => (a.av.nivel === b.av.nivel ? 0 : a.av.nivel === "critico" ? -1 : 1) || b.av.risco - a.av.risco);
  const mrrRisco = emRiscoTodos.reduce((a, x) => a + (Number(x.d.cliente.mrr) || 0), 0);
  const emRisco = emRiscoTodos.slice(0, 5).map((x) => ({
    nome: x.d.cliente.nome, risco: x.av.risco, nivel: x.av.nivel,
    coord: coordPorCliente[x.d.cliente.id], motivo: x.av.sinais[0]?.texto,
  }));

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

  msg += `*Clientes em Risco (Radar de Churn):*\n`;
  if (emRisco.length === 0) msg += `🟢 Nenhum cliente em risco\n`;
  for (const c of emRisco) {
    msg += `${c.nivel === "critico" ? "🔴" : "🟡"} ${c.nome} (risco ${c.risco}) - ${c.coord ?? "sem coord"}\n`;
    if (c.motivo) msg += `   ↳ ${c.motivo}\n`;
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

export async function POST(req: Request) { return GET(req); }
