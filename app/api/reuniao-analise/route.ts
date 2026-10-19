import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODELO_WHISPER = "whisper-1";
const MODELO_LLM = "claude-sonnet-4-5-20250929";

export async function POST(req: Request) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase nao configurado" }, { status: 500 });
  if (!OPENAI_KEY) return NextResponse.json({ error: "OPENAI_API_KEY nao configurada" }, { status: 500 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY nao configurada" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  let body: any;
  try {
    const formData = await req.formData();
    const file = formData.get("audio") as File | null;
    const clienteId = formData.get("cliente_id") as string;
    const clienteNome = formData.get("cliente_nome") as string;
    const tipoReuniao = formData.get("tipo_reuniao") as string || "periodica";

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
    const prompt = `Voce e um analista senior de relacionamento com cliente da agencia de marketing Ruston & Co (franquia V4 Company).

Analise a transcricao desta reuniao com o cliente "${clienteNome}" e retorne APENAS um JSON valido (sem markdown) com esta estrutura:

{
  "resumo_executivo": "2-3 frases resumindo o ponto principal da reuniao",
  "decisoes": ["lista de decisoes tomadas na reuniao"],
  "follow_ups": ["lista de acoes/follow-ups combinados, com responsavel se mencionado"],
  "temperatura": "quente" | "morna" | "fria",
  "sentimento_cliente": "positivo" | "neutro" | "negativo",
  "risco_churn": "baixo" | "medio" | "alto",
  "oportunidade_upsell": "nenhuma" | "possivel" | "clara",
  "sinais_positivos": ["lista de sinais positivos identificados"],
  "sinais_negativos": ["lista de sinais de alerta/preocupacao"],
  "topicos_discutidos": ["lista dos principais topicos abordados"],
  "proximos_passos": "resumo do que precisa ser feito ate a proxima reuniao"
}

Regras:
- Seja direto e pratico
- So marque "risco_churn alto" se houver sinais explicitos
- Use portugues brasileiro
- Se nao conseguir identificar algo, deixe lista vazia ou "nenhuma"

Transcricao da reuniao:
${transcricao.slice(0, 100000)}`;

    const claudeRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODELO_LLM,
        max_tokens: 3000,
        temperature: 0.3,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      const err = await claudeRes.text();
      return NextResponse.json({ error: `Claude erro: ${err}` }, { status: 500 });
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text ?? "";
    const cleanContent = content.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let analise: any;
    try {
      analise = JSON.parse(cleanContent);
    } catch {
      return NextResponse.json({ error: "JSON invalido do Claude", raw: cleanContent.slice(0, 500) }, { status: 500 });
    }

    // 3. Salvar no Supabase
    const { data: reuniao, error: insertErr } = await supabase.from("ruston_reunioes_cliente").insert({
      cliente_id: clienteId,
      tipo_reuniao: tipoReuniao,
      data_reuniao: new Date().toISOString(),
      duracao_minutos: Math.round(duracao_segundos / 60),
      transcricao,
      resumo: analise.resumo_executivo,
      decisoes: analise.decisoes ?? [],
      follow_ups: analise.follow_ups ?? [],
      temperatura: analise.temperatura,
      sentimento: analise.sentimento_cliente,
      risco_churn: analise.risco_churn,
      oportunidade_upsell: analise.oportunidade_upsell,
      sinais_positivos: analise.sinais_positivos ?? [],
      sinais_negativos: analise.sinais_negativos ?? [],
      topicos: analise.topicos_discutidos ?? [],
      proximos_passos: analise.proximos_passos,
      tokens_entrada: claudeData.usage?.input_tokens ?? 0,
      tokens_saida: claudeData.usage?.output_tokens ?? 0,
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
