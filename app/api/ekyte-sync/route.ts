// =====================================================================
// EKYTE SYNC — puxa tasks da API Ekyte e faz UPSERT no banco
// =====================================================================
// Endpoint POST /api/ekyte-sync
// Protegido: só pode ser chamado por usuário autenticado (gerente).
// Variáveis de ambiente necessárias (Vercel → Settings → Env Vars):
//   EKYTE_API_KEY = token do Ekyte
//   NEXT_PUBLIC_SUPABASE_URL = url do Supabase
//   SUPABASE_SERVICE_ROLE_KEY = service role key (secret! usada só no server)
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300; // até 5min (Vercel Pro). Em Hobby = 60s.

const EKYTE_BASE = "https://api.ekyte.com/v1.1/tasks";
const PAGE_SIZE_GUESS = 100; // Ekyte retorna 100 por página
const MAX_PAGES = 500; // suporta até 50k tasks por status

type EkyteTask = Record<string, any>;

function iso(d: any): string | null {
  if (!d) return null;
  // Ekyte manda ISO sem Z. Confia que é UTC/BR mesmo.
  const dt = new Date(d);
  return isNaN(dt.getTime()) ? null : dt.toISOString();
}

function mapTask(t: EkyteTask) {
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

async function fetchEkytePage(apiKey: string, createdFrom: string, status: 0 | 1, page: number): Promise<EkyteTask[]> {
  const url = `${EKYTE_BASE}?apiKey=${encodeURIComponent(apiKey)}&createdFrom=${createdFrom}&status=${status}&page=${page}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Ekyte ${res.status}: ${await res.text()}`);
  const payload = await res.json();
  // Envelope resolver: tenta payload.data, depois payload direto
  if (Array.isArray(payload?.data)) return payload.data;
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.items)) return payload.items;
  if (Array.isArray(payload?.tasks)) return payload.tasks;
  return [];
}

export async function POST(req: Request) {
  const EKYTE_API_KEY = process.env.EKYTE_API_KEY;
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!EKYTE_API_KEY) return NextResponse.json({ error: "EKYTE_API_KEY não configurada" }, { status: 500 });
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  // Lê body opcional: { createdFrom?: "YYYY-MM-DD", disparado_por_email?: string }
  let body: any = {};
  try { body = await req.json(); } catch {}
  // Padrão: desde 2023-01-01 pra garantir que pega TODAS as tasks ainda abertas,
  // inclusive as criadas há muito tempo que o investidor nunca concluiu.
  const createdFrom: string = body.createdFrom ?? "2023-01-01";
  const disparadoPorEmail: string | null = body.disparado_por_email ?? null;

  // Abre log
  const { data: log } = await supabase.from("ruston_ekyte_sync_log")
    .insert({ status: "running", disparado_por_email: disparadoPorEmail })
    .select("id").single();
  const logId = log?.id;

  let totalUpserted = 0;
  let pages = 0;

  try {
    // Puxa ativas (status=0) e concluídas recentes (status=1)
    for (const status of [0, 1] as const) {
      for (let page = 1; page <= MAX_PAGES; page++) {
        const batch = await fetchEkytePage(EKYTE_API_KEY, createdFrom, status, page);
        if (!batch.length) break;
        pages++;

        const rows = batch.map(mapTask);
        const { error } = await supabase.from("ruston_ekyte_tasks").upsert(rows, { onConflict: "id" });
        if (error) throw error;
        totalUpserted += rows.length;

        if (batch.length < PAGE_SIZE_GUESS) break; // provável última página
      }
    }

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
      }).eq("id", logId);
    }

    return NextResponse.json({ ok: true, pages, tasks_upserted: totalUpserted, createdFrom, match: matchStats });
  } catch (e: any) {
    if (logId) {
      await supabase.from("ruston_ekyte_sync_log").update({
        status: "error",
        finished_at: new Date().toISOString(),
        pages_processed: pages,
        tasks_upserted: totalUpserted,
        erro: String(e?.message ?? e),
      }).eq("id", logId);
    }
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

// GET devolve status rápido pra testar que a rota tá viva
export async function GET() {
  return NextResponse.json({ ok: true, msg: "Ekyte sync endpoint. Use POST pra sincronizar." });
}
