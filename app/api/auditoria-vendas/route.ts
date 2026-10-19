import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 300;

const OPENAI_WHISPER_URL = "https://api.openai.com/v1/audio/transcriptions";
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";

export async function POST(req: Request) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;

  if (!OPENAI_KEY) return NextResponse.json({ error: "OPENAI_API_KEY nao configurada" }, { status: 500 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY nao configurada" }, { status: 500 });

  try {
    const formData = await req.formData();
    const clienteNome = formData.get("cliente_nome") as string || "Cliente";
    let contrato = formData.get("contrato") as string || "";
    const contratoPdf = formData.get("contrato_pdf") as File | null;
    const contratoLink = formData.get("contrato_link") as string || "";
    const transcricaoTexto = formData.get("transcricao_texto") as string || "";
    const transcricaoFiles = formData.getAll("transcricao_files") as File[];

    if (!transcricaoFiles.length && !transcricaoTexto.trim()) {
      return NextResponse.json({ error: "Envie pelo menos uma transcricao" }, { status: 400 });
    }

    // Extrair texto do PDF se enviado
    if (contratoPdf && contratoPdf.size > 0) {
      try {
        const pdfModule = await import("pdf-parse");
        const pdfParse = (pdfModule as any).default ?? pdfModule;
        const buffer = Buffer.from(await contratoPdf.arrayBuffer());
        const pdfData = await pdfParse(buffer);
        contrato = pdfData.text ?? "";
      } catch (e: any) {
        console.error("[auditoria] erro ao ler PDF:", e?.message);
        contrato = "[Erro ao ler PDF - analise sem contrato]";
      }
    }

    // 1. Ler transcricoes dos arquivos enviados
    const transcricoes: string[] = [];

    // Adiciona transcricao colada primeiro
    if (transcricaoTexto.trim()) {
      transcricoes.push(transcricaoTexto.trim());
    }

    // Ler cada arquivo de transcricao (PDF ou TXT)
    for (let i = 0; i < transcricaoFiles.length; i++) {
      const file = transcricaoFiles[i];
      if (!file || file.size === 0) continue;

      try {
        if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
          const pdfModule = await import("pdf-parse");
          const pdfParse = (pdfModule as any).default ?? pdfModule;
          const buffer = Buffer.from(await file.arrayBuffer());
          const pdfData = await pdfParse(buffer);
          if (pdfData.text) transcricoes.push(`[Call ${i + 1} - ${file.name}]\n${pdfData.text}`);
        } else {
          const text = await file.text();
          if (text.trim()) transcricoes.push(`[Call ${i + 1} - ${file.name}]\n${text}`);
        }
      } catch (e: any) {
        console.error(`[auditoria] erro ao ler arquivo ${file.name}:`, e?.message);
        transcricoes.push(`[Call ${i + 1} - ${file.name}: erro ao ler arquivo]`);
      }
    }

    const transcricao = transcricoes.join("\n\n---\n\n");

    if (transcricao.length < 50) {
      return NextResponse.json({ error: "Transcricao muito curta" }, { status: 400 });
    }

    // 2. Analise com Claude
    const prompt = `Voce e um auditor senior de vendas da agencia de marketing Ruston & Co (franquia V4 Company).

Analise esta transcricao de call de vendas com o cliente "${clienteNome}" e retorne APENAS um JSON valido (sem markdown) com esta estrutura:

{
  "promessas_vendidas": [
    {"item": "descricao do que foi prometido", "valor": "valor mencionado ou null", "prazo": "prazo mencionado ou null"}
  ],
  "servicos_mencionados": ["lista de servicos/entregas mencionados na call"],
  "valores_mencionados": {"mrr": "valor mensal mencionado ou null", "setup": "valor setup ou null", "investimento_midia": "valor midia ou null"},
  "condicoes_especiais": ["descontos, bonus, condicoes especiais prometidas"],
  ${contrato ? `"auditoria_contrato": {
    "conformidades": ["itens que batem entre call e contrato"],
    "divergencias": ["itens prometidos na call mas ausentes no contrato"],
    "extras_contrato": ["itens no contrato nao mencionados na call"],
    "risco": "baixo" | "medio" | "alto"
  },` : ""}
  "concorrentes_mencionados": [
    {"nome": "nome do concorrente", "contexto": "o que o cliente falou sobre ele"}
  ],
  "dores_cliente": ["lista de dores/problemas mencionados pelo cliente"],
  "metas_cliente": ["metas e objetivos mencionados"],
  "metricas_cliente": {"faturamento": "se mencionado", "ticket_medio": "se mencionado", "qtd_clientes": "se mencionado", "investimento_atual": "se mencionado"},
  "insights_operacionais": ["insights prontos pro time operacional usar ao iniciar o trabalho"],
  "pesquisa_concorrentes": [
    {"nome": "nome do concorrente", "o_que_pesquisar": "site, redes, anuncios, posicionamento - descreva o que o time deve investigar"}
  ],
  "brief_operacional": "paragrafo de 3-5 linhas resumindo tudo que o time precisa saber para comecar a trabalhar com esse cliente",
  "alertas": ["qualquer ponto de atencao - promessas dificeis de cumprir, expectativas irreais, etc"]
}

Regras:
- Extraia TUDO que foi prometido, mesmo implicitamente
- Identifique TODOS os concorrentes mencionados, mesmo de passagem
- Seja especifico nos valores e prazos
- Insights devem ser acionaveis pro time
- Use portugues brasileiro

${contrato ? `\nConteudo do contrato:\n${contrato.slice(0, 30000)}\n` : ""}
Transcricao da call:
${transcricao.slice(0, 100000)}`;

    const claudeRes = await fetch(ANTHROPIC_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-5-20250929",
        max_tokens: 4000,
        temperature: 0.2,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!claudeRes.ok) {
      return NextResponse.json({ error: `Claude: ${await claudeRes.text()}` }, { status: 500 });
    }

    const claudeData = await claudeRes.json();
    const content = claudeData.content?.[0]?.text ?? "";
    const clean = content.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();

    let analise: any;
    try { analise = JSON.parse(clean); } catch {
      return NextResponse.json({ error: "JSON invalido", raw: clean.slice(0, 500) }, { status: 500 });
    }

    return NextResponse.json({ ok: true, analise, transcricao: transcricao.slice(0, 5000) });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message ?? e) }, { status: 500 });
  }
}
