import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exigirCron } from "@/lib/apiAuth";
import { calcularPlacar, semanaFechada } from "@/lib/placarSquad";

export const runtime = "nodejs";
export const maxDuration = 60;

// Cron de sábado de manhã: grava a nota de cada squad da semana que fechou.
// ?semana=YYYY-MM-DD grava uma sexta específica.
export async function GET(req: Request) {
  const negado = exigirCron(req);
  if (negado) return negado;
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase nao configurado" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const semana = new URL(req.url).searchParams.get("semana") ?? semanaFechada();
  const placar = await calcularPlacar(supabase, semana);

  const linhas = placar.map((p) => ({
    squad_id: p.squad_id, semana, nota: p.nota, clientes: p.clientes, mrr: p.mrr,
    criterios: p.criterios, pendencias: p.pendencias.length, gravado_em: new Date().toISOString(),
  }));
  const { error } = await supabase.from("ruston_placar_squad").upsert(linhas, { onConflict: "squad_id,semana" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, semana, squads: linhas.map((l) => ({ squad_id: l.squad_id, nota: l.nota })) });
}

export async function POST(req: Request) { return GET(req); }
