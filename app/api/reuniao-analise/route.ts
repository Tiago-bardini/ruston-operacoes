import { NextResponse } from "next/server";
import { exigirPerfil } from "@/lib/apiAuth";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { chamarClaude, colunasDaAnalise, promptReuniao, type AnaliseReuniao } from "@/lib/analiseIA";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const MODELO_WHISPER = "whisper-1";

export async function POST(req: Request) {
  // Mesma regra das telas /auditoria-vendas e /analise-reunioes
  const negado = await exigirPerfil(["gerente", "coordenador"]);
  if (negado) return negado;
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase nao configurado" }, { status: 500 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY nao configurada" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  // 1:1 COO X Cliente ou GE - EE: o resumo da conversa vem em texto (sem áudio)
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    return resumo1a1(req, supabase, ANTHROPIC_KEY);
  }

  let body: any;
  try {
    const formData = await req.formData();
    const file = formData.get("audio") as File | null;
    const clienteId = formData.get("cliente_id") as string;
    const clienteNome = formData.get("cliente_nome") as string;
    const tipoReuniao = formData.get("tipo_reuniao") as string || "periodica";
    const titulo = ((formData.get("titulo") as string) || "").trim() || undefined;

    if (!OPENAI_KEY) return NextResponse.json({ error: "OPENAI_API_KEY nao configurada" }, { status: 500 });
    if (!file) return NextResponse.json({ error: "Arquivo de audio nao enviado" }, { status: 400 });
    if (!clienteId) return NextResponse.json({ error: "cliente_id obrigatorio" }, { status: 400 });

    // 1. Transcrever com Whisper
    const whisperForm = new FormData();
    whisperForm.append("file", file, file.name || "audio.webm");
    whisperForm.append("model", MODELO_WHISPER);
    whisperForm.append("language", "pt");
    whisperForm.append("response_format", "verbose_json");

    const whisperRes = await fetch(OPENAI_WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_KEY}` },
      body: whisperForm,
    });

    if (!whisperRes.ok) {
      const err = await whisperRes.text();
      return NextResponse.json({ error: `Whisper erro: ${err}` }, { status: 500 });
    }

    const whisperData = await whisperRes.json();
    const transcricao = whisperData.text ?? "";
    const duracao_segundos = Math.round(whisperData.duration ?? 0);

    if (!transcricao || transcricao.length < 50) {
      return NextResponse.json({ error: "Transcricao muito curta ou vazia" }, { status: 400 });
    }

    // 2. Analisar com Claude
    let analise: AnaliseReuniao;
    let tokens = { tokens_entrada: 0, tokens_saida: 0 };
    try {
      const r = await chamarClaude(promptReuniao({ cliente: clienteNome, titulo, interna: false, transcricao }), ANTHROPIC_KEY);
      analise = r.json;
      tokens = { tokens_entrada: r.tokens_entrada, tokens_saida: r.tokens_saida };
    } catch (e: any) {
      return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
    }

    // 3. Salvar no Supabase
    const agora = new Date();
    const { data: reuniao, error: insertErr } = await supabase.from("ruston_reunioes_cliente").insert({
      cliente_id: clienteId,
      tipo_reuniao: tipoReuniao,
      origem: "audio",
      titulo: titulo ?? null,
      data_reuniao: agora.toISOString().slice(0, 10),
      realizada: true,
      duracao_minutos: Math.round(duracao_segundos / 60),
      transcricao,
      ...colunasDaAnalise(analise, tokens),
    }).select("id").single();

    if (insertErr) {
      console.error("[reuniao-analise] erro insert:", insertErr);
      // Retorna a analise mesmo se falhar o insert
      return NextResponse.json({ ok: true, analise, saved: false, error: insertErr.message });
    }

    return NextResponse.json({ ok: true, analise, saved: true, reuniao_id: reuniao?.id });
  } catch (e: any) {
    console.error("[reuniao-analise] erro:", e);
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}

async function resumo1a1(req: Request, supabase: SupabaseClient, anthropicKey: string) {
  let body: any;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON inválido" }, { status: 400 }); }
  const resumo = String(body?.resumo ?? "").trim();
  if (!body?.cliente_id) return NextResponse.json({ error: "cliente_id obrigatorio" }, { status: 400 });
  if (resumo.length < 50) return NextResponse.json({ error: "Escreva um resumo com pelo menos algumas frases" }, { status: 400 });
  const geEe = body.variante === "ge_ee";

  let analise: AnaliseReuniao;
  let tokens = { tokens_entrada: 0, tokens_saida: 0 };
  try {
    const r = await chamarClaude(
      promptReuniao({ cliente: body.cliente_nome ?? "", interna: false, transcricao: resumo, resumo: geEe ? "ge_ee" : "coo" }),
      anthropicKey,
    );
    analise = r.json;
    tokens = { tokens_entrada: r.tokens_entrada, tokens_saida: r.tokens_saida };
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }

  const { data: reuniao, error } = await supabase.from("ruston_reunioes_cliente").insert({
    cliente_id: body.cliente_id,
    tipo_reuniao: body.tipo_reuniao || "periodica",
    origem: geEe ? "ge_ee" : "telefone",
    titulo: geEe ? "GE - EE" : "1:1 COO X Cliente",
    data_reuniao: body.data_reuniao || new Date().toISOString().slice(0, 10),
    duracao_minutos: Number(body.duracao_minutos) || null,
    presentes: body.presentes || null,
    realizada: true,
    transcricao: resumo.slice(0, 100000),
    ...colunasDaAnalise(analise, tokens),
  }).select("id").single();

  if (error) return NextResponse.json({ ok: true, analise, saved: false, error: error.message });
  return NextResponse.json({ ok: true, analise, saved: true, reuniao_id: reuniao?.id });
}
