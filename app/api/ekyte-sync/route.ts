// =====================================================================
// EKYTE SYNC — puxa tasks e apontamentos da API Ekyte e faz UPSERT no banco
// =====================================================================
// POST /api/ekyte-sync  → disparo manual (usuário logado)
//   body opcional: { modo?: "incremental" | "completo", createdFrom?: "YYYY-MM-DD",
//                    apontamentosFrom?: "YYYY-MM-DD" }
// GET  /api/ekyte-sync  → com "Authorization: Bearer CRON_SECRET" roda o sync
//                         incremental (Vercel Cron diário); sem auth é só health check.
//
// Modos:
//   incremental (padrão) — tasks abertas + concluídas nos últimos 35 dias
//                          + apontamentos dos últimos 21 dias. Cabe nos 60s do Hobby.
//   completo             — todas as tasks desde createdFrom (padrão 2023-01-01)
//                          + apontamentos desde apontamentosFrom (padrão 120 dias).
//
// Variáveis de ambiente (Vercel → Settings → Env Vars):
//   EKYTE_API_KEY, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET
// Doc da API: https://developers.ekyte.com/docs/docs-bi/
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { isCron, requireUserOrCron } from "@/lib/auth/requireUserOrCron";

export const runtime = "nodejs";
export const maxDuration = 60; // limite do plano Hobby

const EKYTE_API = "https://api.ekyte.com";
const PAGE_SIZE_GUESS = 100; // Ekyte retorna 100 por página
const MAX_PAGES = 500;
// Para antes do limite de 60s pra conseguir fechar o log e rodar o matching
const ORCAMENTO_MS = 45_000;

type EkyteRow = Record<string, any>;
type Modo = "incremental" | "completo";

function iso(d: any): string | null {
  if (!d) return null;
  // Ekyte manda ISO sem Z. Confia que é UTC/BR mesmo.
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

function diasAtras(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function mapTask(t: EkyteRow) {
  return {
    id: t.id,
    title: t.title ?? null,
    description: t.description ?? null,
    link: t.link ?? null,
    situation: t.situation ?? null,
    priority: t.priority ?? null,
    priority_group: t.priorityGroup ?? null,
    creation_date: iso(t.creationDate),
    original_due_date: iso(t.originalDueDate),
    current_due_date: iso(t.currentDueDate),
    phase_start_date: iso(t.phaseStartDate),
    phase_due_date: iso(t.phaseDueDate),
    resolved_date: iso(t.resolvedDate),
    estimated_time: t.estimatedTime ?? null,
    actual_time: t.actualTime ?? null,
    phase_id: t.phaseId ?? null,
    phase: t.phase ?? null,
    created_by_id: t.createdById ?? null,
    created_by: t.createdBy ?? null,
    created_by_email: t.createdByEmail ?? null,
    executor_id: t.executorId ?? null,
    executor: t.executor ?? null,
    executor_email: t.executorEmail ?? null,
    workspace_id: t.workspaceId ?? null,
    workspace: t.workspace ?? null,
    squad_id: t.squadId ?? null,
    squad: t.squad ?? null,
    project_id: t.projectId ?? null,
    project: t.project ?? null,
    project_alias: t.projectAlias ?? null,
    ctc_task_type_id: t.ctcTaskTypeId ?? null,
    ctc_task_type: t.ctcTaskType ?? null,
    tags: t.tags ?? null,
    payload_raw: t,
    synced_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

// Apontamento (time-tracking): effort em minutos, ctcTaskId = task do Ekyte
function mapApontamento(a: EkyteRow) {
  const inicio: string | null = a.startDate ?? a.createdIn ?? null;
  return {
    id: a.id,
    task_id: a.ctcTaskId ?? null,
    task_title: a.ctcTask ?? null,
    executor_id: a.executorId != null ? String(a.executorId) : null,
    executor: a.executor ?? null,
    workspace_id: a.workspaceId ?? null,
    workspace: a.workspace ?? null,
    phase: a.phase ?? null,
    status: a.status ?? null,
    comment: a.comment ?? null,
    // Data "de calendário" do apontamento, sem conversão de fuso
    data: inicio ? String(inicio).slice(0, 10) : null,
    start_date: iso(a.startDate),
    end_date: iso(a.endDate),
    created_in: iso(a.createdIn),
    minutos: Number(a.effort ?? 0) || 0,
    payload_raw: a,
    synced_at: new Date().toISOString(),
  };
}

async function fetchEkyte(path: string, params: Record<string, string | number>): Promise<EkyteRow[]> {
  const qs = new URLSearchParams(Object.entries(params).map(([k, v]) => [k, String(v)]));
  const res = await fetch(`${EKYTE_API}${path}?${qs}`, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Ekyte ${path} ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  // Envelope resolver: tenta payload.data, depois payload direto
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  return [];
}

async function sincronizar(modo: Modo, opts: { createdFrom?: string; apontamentosFrom?: string; disparadoPorEmail: string | null }) {
  const EKYTE_API_KEY = process.env.EKYTE_API_KEY;
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!EKYTE_API_KEY) return NextResponse.json({ error: "EKYTE_API_KEY não configurada" }, { status: 500 });
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const inicio = Date.now();
  const semTempo = () => Date.now() - inicio > ORCAMENTO_MS;

  // Padrão: desde 2023-01-01 pra garantir que pega TODAS as tasks ainda abertas,
  // inclusive as criadas há muito tempo que o investidor nunca concluiu.
  const createdFrom = opts.createdFrom ?? "2023-01-01";
  const apontamentosFrom = opts.apontamentosFrom ?? diasAtras(modo === "completo" ? 120 : 21);

  // Abre log
  const { data: log } = await supabase.from("ruston_ekyte_sync_log")
    .insert({ status: "running", disparado_por_email: opts.disparadoPorEmail, modo })
    .select("id").single();
  const logId = log?.id;

  let totalUpserted = 0;
  let apontamentosUpserted = 0;
  let pages = 0;
  let parcial = false;

  async function syncTasks(filtros: Record<string, string | number>) {
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (semTempo()) { parcial = true; return; }
      const batch = await fetchEkyte("/v1.1/tasks", { apiKey: EKYTE_API_KEY!, ...filtros, page });
      if (!batch.length) return;
      pages++;

      const rows = batch.map(mapTask);
      const { error } = await supabase.from("ruston_ekyte_tasks").upsert(rows, { onConflict: "id" });
      if (error) throw error;
      totalUpserted += rows.length;

      if (batch.length < PAGE_SIZE_GUESS) return; // provável última página
    }
  }

  async function syncApontamentos() {
    let primeiroIdAnterior: unknown = undefined;
    for (let page = 1; page <= MAX_PAGES; page++) {
      if (semTempo()) { parcial = true; return; }
      const batch = await fetchEkyte("/v1.0/time-trackings", {
        apiKey: EKYTE_API_KEY!, createdFrom: apontamentosFrom, createdTo: diasAtras(-1), page,
      });
      // Se a API ignorar "page" e devolver a mesma página, para pra não duplicar/loopar
      if (!batch.length || batch[0]?.id === primeiroIdAnterior) return;
      primeiroIdAnterior = batch[0]?.id;
      pages++;

      const rows = batch.map(mapApontamento).filter((r) => r.id != null);
      const { error } = await supabase.from("ruston_ekyte_apontamentos").upsert(rows, { onConflict: "id" });
      if (error) throw error;
      apontamentosUpserted += rows.length;

      if (batch.length < PAGE_SIZE_GUESS) return;
    }
  }

  try {
    // Ordem por prioridade, pra um sync parcial já trazer o mais importante:
    // 1) tasks ativas (status=0)
    await syncTasks({ status: 0, createdFrom });
    // 2) apontamentos — horas reais por dia/pessoa (time-trackings)
    await syncApontamentos();
    // 3) tasks concluídas (status=1); no incremental, só dos últimos 35 dias
    await syncTasks(modo === "completo"
      ? { status: 1, createdFrom }
      : { status: 1, createdFrom, resolvedDateFrom: diasAtras(35) });

    // ----------- MATCHING AUTOMÁTICO -----------
    // 1) Match pessoa por email
    const { data: matchP } = await supabase.rpc("fn_ekyte_match_pessoas");
    // 2) Match cliente por de-para + nome
    const { data: matchC } = await supabase.rpc("fn_ekyte_match_clientes");
    const matchStats = { pessoas: matchP ?? 0, clientes: matchC ?? 0 };

    // Fecha log
    if (logId) {
      await supabase.from("ruston_ekyte_sync_log").update({
        status: "success",
        finished_at: new Date().toISOString(),
        pages_processed: pages,
        tasks_upserted: totalUpserted,
        apontamentos_upserted: apontamentosUpserted,
        erro: parcial ? "Parcial: tempo limite atingido; o próximo sync continua." : null,
      }).eq("id", logId);
    }

    return NextResponse.json({
      ok: true, modo, parcial, pages,
      tasks_upserted: totalUpserted, apontamentos_upserted: apontamentosUpserted,
      createdFrom, apontamentosFrom, match: matchStats,
    });
  } catch (e: any) {
    if (logId) {
      await supabase.from("ruston_ekyte_sync_log").update({
        status: "error",
        finished_at: new Date().toISOString(),
        pages_processed: pages,
        tasks_upserted: totalUpserted,
        apontamentos_upserted: apontamentosUpserted,
        erro: String(e?.message ?? e),
      }).eq("id", logId);
    }
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const auth = await requireUserOrCron(req);
  if (auth instanceof Response) return auth;

  let body: any = {};
  try { body = await req.json(); } catch {}
  const modo: Modo = body.modo === "completo" ? "completo" : "incremental";
  const disparadoPorEmail = auth.via === "usuario" ? auth.email : "cron";

  return sincronizar(modo, {
    createdFrom: body.createdFrom,
    apontamentosFrom: body.apontamentosFrom,
    disparadoPorEmail,
  });
}

// Vercel Cron chama com GET + Authorization: Bearer CRON_SECRET
export async function GET(req: Request) {
  if (isCron(req)) return sincronizar("incremental", { disparadoPorEmail: "cron" });
  return NextResponse.json({ ok: true, msg: "Ekyte sync endpoint. Use POST pra sincronizar." });
}
