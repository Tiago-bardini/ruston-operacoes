// =====================================================================
// WHATSAPP ANÁLISE IA — roda Llama 3.3 (Groq) + Whisper em cada conversa
// =====================================================================
// Pra cada conversa com cliente vinculado:
//   1) Pega msgs desde a última análise
//   2) Transcreve áudios com Whisper (Groq)
//   3) Monta contexto separando Ruston (equipe cadastrada em /pessoas) de cliente
//   4) Envia pro Llama 3.3 70B
//   5) Salva resultado (temperatura, risco churn, upsell, sinais, resumo)
//
// Rodado via Vercel Cron 1x/dia (às 7h BR = 10h UTC).
// Também pode ser chamado manual: /api/whatsapp-analise-ia?limit=10
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_WHISPER_URL = "https://api.groq.com/openai/v1/audio/transcriptions";
const MODELO_LLM = "llama-3.3-70b-versatile";
const MODELO_WHISPER = "whisper-large-v3";

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

async function transcreverAudio(audioUrl: string, groqKey: string): Promise<string | null> {
  try {
    // Baixa o áudio
    const audioRes = await fetch(audioUrl);
    if (!audioRes.ok) return null;
    const audioBlob = await audioRes.blob();

    // Envia pro Whisper via Groq
    const form = new FormData();
    form.append("file", audioBlob, "audio.ogg");
    form.append("model", MODELO_WHISPER);
    form.append("language", "pt");
    form.append("response_format", "json");

    const res = await fetch(GROQ_WHISPER_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${groqKey}` },
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

async function analisarComLlama(contexto: string, cliente: string, groqKey: string): Promise<any> {
  const prompt = `Você é um analista de relacionamento com cliente da agência de marketing Ruston & Co (franquia V4 Company).

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

Conversa (ordem cronológica):
${contexto}

Responda APENAS com o JSON válido, sem markdown.`;

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${groqKey}`,
    },
    body: JSON.stringify({
      model: MODELO_LLM,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      max_tokens: 1500,
      response_format: { type: "json_object" },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Groq erro ${res.status}: ${err}`);
  }

  const data = await res.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error("resposta vazia do Llama");

  try {
    return {
      analise: JSON.parse(content),
      tokens_entrada: data.usage?.prompt_tokens ?? 0,
      tokens_saida: data.usage?.completion_tokens ?? 0,
    };
  } catch {
    throw new Error(`JSON inválido do Llama: ${content.slice(0, 200)}`);
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
  const GROQ_KEY = process.env.GROQ_API_KEY;

  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  if (!GROQ_KEY) return NextResponse.json({ error: "GROQ_API_KEY não configurada" }, { status: 500 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const url = new URL(req.url);
  const limit = parseInt(url.searchParams.get("limit") ?? "50", 10);

  // 1) Lista números do time Ruston
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

  // 2) Pega conversas com cliente vinculado e msgs novas desde a última análise
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
          transcricao = await transcreverAudio(m.media_url, GROQ_KEY);
          if (transcricao) stats.audios_transcritos++;
        }
        msgsComTranscricao.push({ ...m, transcricao });
      }

      // Dados do cliente
      const { data: cliente } = await supabase
        .from("ruston_clientes")
        .select("nome")
        .eq("id", conv.cliente_id)
        .single();

      // Analisa com Llama
      const contexto = formatarContexto(msgsComTranscricao, numerosRuston);
      if (contexto.length > 50000) {
        // Trunca pros últimos 50k chars (contexto Llama 3.3 é 128k mas conservador)
        // já ordenado cronologicamente, mantém o fim (mais recente)
      }
      const contextoTrunc = contexto.slice(-50000);

      const { analise, tokens_entrada, tokens_saida } = await analisarComLlama(contextoTrunc, cliente?.nome ?? "cliente", GROQ_KEY);

      // Salva análise
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
        custo_estimado_usd: 0,
      });

      stats.analisadas++;
    } catch (e: any) {
      console.error(`[analise] erro na conversa ${conv.id}:`, e?.message ?? e);
      stats.erros++;
    }
  }

  return NextResponse.json({ ok: true, stats });
}
