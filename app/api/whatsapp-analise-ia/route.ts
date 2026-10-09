// =====================================================================
// WHATSAPP ANÁLISE IA — Claude Sonnet 5.5 + OpenAI Whisper
// =====================================================================
// Pra cada conversa com cliente vinculado:
//   1) Pega msgs desde a última análise
//   2) Transcreve áudios com Whisper (OpenAI)
//   3) Monta contexto separando Ruston (equipe cadastrada) de cliente
//   4) Envia pro Claude Sonnet 5.5
//   5) Salva resultado (temperatura, risco churn, upsell, sinais, resumo)
//
// Env vars necessárias:
//   - ANTHROPIC_API_KEY
//   - OPENAI_API_KEY
//   - SUPABASE_SERVICE_ROLE_KEY
//   - NEXT_PUBLIC_SUPABASE_URL
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const MODELO_LLM = "claude-sonnet-4-5-20250929";
const MODELO_WHISPER = "whisper-1";

type Msg = {
  id: string;
  tipo: string;
  conteudo: string | null;
  media_url: string | null;
  autor_nome: string | null;
  autor_numero: string | null;
  de_mim: boolean;
  enviada_em: string;
  transcricao: string | null;
};

async function transcreverAudio(audioUrl: string, openaiKey: string): Promise<string | null> {
  try {
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return null;
    const audioBlob = await audioRes.blob();

    const form = new FormData();
    form.append("file", audioBlob, "audio.ogg");
    form.append("model", MODELO_WHISPER);
    form.append("language", "pt");
    form.append("response_format", "json");

    const res = await fetch(OPENAI_WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: form,
    });

    if (!res.ok) {
      console.error("[whisper] erro:", await res.text());
      return null;
    }
    const data = await res.json();
    return data.text ?? null;
  } catch (e: any) {
    console.error("[whisper] erro:", e?.message ?? e);
    return null;
  }
}

async function analisarComClaude(contexto: string, cliente: string, apiKey: string): Promise<any> {
  const prompt = `Você é um analista sênior de relacionamento com cliente da agência de marketing Ruston & Co (franquia V4 Company).

Analise a conversa abaixo entre a equipe Ruston e o cliente "${cliente}" e retorne APENAS um JSON válido (sem markdown, sem texto antes/depois) com essa estrutura:

{
  "temperatura": "quente" | "morna" | "fria",
  "sentimento": "positivo" | "neutro" | "negativo",
  "risco_churn": "baixo" | "medio" | "alto",
  "oportunidade_upsell": "nenhuma" | "possivel" | "clara",
  "sinais_churn": ["reclamou_resultado", "pediu_desconto", "falou_cancelar", ...],
  "sinais_upsell": ["elogiou", "pediu_mais_servico", "aumento_investimento", ...],
  "acoes_sugeridas": ["agendar_reuniao", "oferecer_lp", "cobrar_resultado", ...],
  "resumo_curto": "1 frase objetiva sobre o estado da conversa",
  "resumo_longo": "parágrafo de 2-4 linhas explicando contexto, sinais e recomendações"
}

Regras importantes:
- Dê peso MAIOR a sinais vindos do tomador de decisão (dono/gerente) vs operacional
- Ignore conversas internas do cliente que não envolvem a Ruston
- "risco_churn alto" só quando há sinais explícitos (ultimato, reclamação séria, ameaça de cancelar)
- "upsell clara" só quando o cliente pede mais serviço ou aumenta orçamento
- Seja direto e prático nas ações sugeridas
- Use português brasileiro informal mas profissional

Conversa (ordem cronológica):
${contexto}

Responda APENAS com o JSON válido, sem markdown.`;

  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELO_LLM,
      max_tokens: 2000,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic erro ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.content?.[0]?.text;
  if (!content) throw new Error("resposta vazia do Claude");

  // Remove markdown se vier
  const cleanContent = content.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();

  try {
    return {
      analise: JSON.parse(cleanContent),
      tokens_entrada: data.usage?.input_tokens ?? 0,
      tokens_saida: data.usage?.output_tokens ?? 0,
    };
  } catch {
    throw new Error(`JSON inválido do Claude: ${cleanContent.slice(0, 200)}`);
  }
}

function formatarContexto(msgs: Msg[], numerosRuston: Set<string>): string {
  return msgs.map((m) => {
    const numLimpo = (m.autor_numero ?? "").replace(/\D/g, "");
    const eRuston = m.de_mim || (numLimpo && numerosRuston.has(numLimpo));
    const quem = eRuston ? "🏢 RUSTON" : "👤 CLIENTE";
    const data = new Date(m.enviada_em).toLocaleString("pt-BR");
    const texto = m.transcricao ? `[áudio] ${m.transcricao}` : (m.conteudo ?? `[${m.tipo}]`);
    const autor = m.autor_nome ?? "?";
    return `[${data}] ${quem} (${autor}): ${texto}`;
  }).join("\n");
}

export async function POST(req: Request) {
  return GET(req);
}

export async function GET(req: Request) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  const OPENAI_KEY = process.env.OPENAI_API_KEY;

  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada" }, { status: 500 });
  if (!OPENAI_KEY) return NextResponse.json({ error: "OPENAI_API_KEY não configurada" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

  // 1) Números do time Ruston
  const { data: pessoas } = await supabase
    .from("ruston_pessoas")
    .select("whatsapp")
    .eq("ativo", true)
    .not("whatsapp", "is", null);

  const numerosRuston = new Set<string>();
  (pessoas ?? []).forEach((p: any) => {
    (p.whatsapp ?? "").split(",").forEach((n: string) => {
      const limpo = n.replace(/\D/g, "");
      if (limpo.length >= 10) numerosRuston.add(limpo);
    });
  });

  // 2) Conversas com cliente vinculado
  const { data: conversas } = await supabase
    .from("ruston_whatsapp_conversas")
    .select("id, nome, cliente_id, ultima_mensagem_em")
    .not("cliente_id", "is", null)
    .order("ultima_mensagem_em", { ascending: false })
    .limit(limit);

  const stats = { analisadas: 0, puladas: 0, erros: 0, audios_transcritos: 0 };

  for (const conv of (conversas ?? []) as any[]) {
    try {
      // Última análise dessa conversa
      const { data: ultimaAnalise } = await supabase
        .from("ruston_whatsapp_analises")
        .select("periodo_fim")
        .eq("conversa_id", conv.id)
        .order("criado_em", { ascending: false })
        .limit(1)
        .maybeSingle();

      const dataInicio = ultimaAnalise?.periodo_fim ?? new Date(Date.now() - 30 * 86400000).toISOString();
      const dataFim = new Date().toISOString();

      // Msgs no período
      const { data: msgs } = await supabase
        .from("ruston_whatsapp_mensagens")
        .select("id, tipo, conteudo, media_url, autor_nome, autor_numero, de_mim, enviada_em")
        .eq("conversa_id", conv.id)
        .gte("enviada_em", dataInicio)
        .lte("enviada_em", dataFim)
        .order("enviada_em", { ascending: true })
        .limit(300);

      if (!msgs || msgs.length < 3) {
        stats.puladas++;
        continue;
      }

      // Transcreve áudios
      const msgsComTranscricao: Msg[] = [];
      for (const m of msgs as any[]) {
        let transcricao: string | null = null;
        if (m.tipo === "audio" && m.media_url) {
          transcricao = await transcreverAudio(m.media_url, OPENAI_KEY);
          if (transcricao) stats.audios_transcritos++;
        }
        msgsComTranscricao.push({ ...m, transcricao });
      }

      const { data: cliente } = await supabase
        .from("ruston_clientes")
        .select("nome")
        .eq("id", conv.cliente_id)
        .single();

      const contexto = formatarContexto(msgsComTranscricao, numerosRuston);
      // Trunca pros últimos 80k chars (Claude Sonnet aguenta muito mais, mas conservador)
      const contextoTrunc = contexto.slice(-80000);

      const { analise, tokens_entrada, tokens_saida } = await analisarComClaude(contextoTrunc, cliente?.nome ?? "cliente", ANTHROPIC_KEY);

      // Custo estimado (Claude Sonnet 5.5): $3/MTok input + $15/MTok output
      const custoUSD = (tokens_entrada * 3 / 1_000_000) + (tokens_saida * 15 / 1_000_000);

      await supabase.from("ruston_whatsapp_analises").insert({
        conversa_id: conv.id,
        cliente_id: conv.cliente_id,
        periodo_ini: dataInicio,
        periodo_fim: dataFim,
        qtd_mensagens: msgs.length,
        temperatura: analise.temperatura,
        sentimento: analise.sentimento,
        risco_churn: analise.risco_churn,
        oportunidade_upsell: analise.oportunidade_upsell,
        sinais_churn: analise.sinais_churn ?? [],
        sinais_upsell: analise.sinais_upsell ?? [],
        acoes_sugeridas: analise.acoes_sugeridas ?? [],
        resumo_curto: analise.resumo_curto,
        resumo_longo: analise.resumo_longo,
        modelo: MODELO_LLM,
        tokens_entrada,
        tokens_saida,
        custo_estimado_usd: Number(custoUSD.toFixed(6)),
      });

      stats.analisadas++;
    } catch (e: any) {
      console.error(`[analise] erro na conversa ${conv.id}:`, e?.message ?? e);
      stats.erros++;
    }
  }

  return NextResponse.json({ ok: true, stats });
}
