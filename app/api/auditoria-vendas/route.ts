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

CONTEXTO: Na Ruston, o time comercial (closers) faz calls de vendas com potenciais clientes. Nessas calls, o closer geralmente:
- Faz CLIENTE OCULTO antes da call (analisa site, redes sociais, anuncios do cliente)
- Apresenta um PRE-DIAGNOSTICO ao cliente (pontos fortes e fracos do marketing digital atual)
- Analisa o site do cliente, seus anuncios no Google/Meta, suas redes sociais
- Propoe servicos da Ruston baseado nas dores encontradas
- Negocia valores (MRR mensal, setup, investimento em midia)

Analise esta transcricao de call de vendas com o cliente "${clienteNome}" e retorne APENAS um JSON valido (sem markdown) com esta estrutura:

{
  "dados_cliente": {
    "nome_empresa": "nome da empresa do cliente",
    "segmento": "segmento/nicho de atuacao",
    "regiao": "cidade/estado/regiao que atende",
    "site": "URL do site se mencionado",
    "redes_sociais": ["redes sociais mencionadas com @"],
    "tempo_mercado": "se mencionado",
    "porte": "micro/pequeno/medio/grande — inferir pelo contexto"
  },
  "diagnostico_closer": {
    "analise_site": "o que o closer falou sobre o site do cliente (pontos positivos e negativos)",
    "analise_anuncios": "o que o closer encontrou nos anuncios digitais (Google Ads, Meta Ads)",
    "analise_redes_sociais": "o que o closer observou nas redes sociais",
    "analise_seo": "se mencionou SEO, posicionamento no Google",
    "pontos_fortes": ["pontos positivos identificados pelo closer"],
    "pontos_fracos": ["problemas e oportunidades de melhoria identificados"],
    "dados_apresentados": ["dados, numeros e metricas que o closer mostrou ao cliente"]
  },
  "o_que_foi_vendido": [
    {"servico": "nome exato do servico vendido", "descricao": "detalhes do que inclui", "valor_mensal": "R$ X ou null", "valor_setup": "R$ X ou null", "prazo_entrega": "prazo mencionado ou null", "frequencia": "mensal/semanal/pontual"}
  ],
  "valores": {
    "mrr_total": "valor mensal total combinado",
    "setup_total": "valor de setup/implantacao",
    "investimento_midia": "verba de midia mencionada",
    "desconto_aplicado": "se houve desconto, qual",
    "prazo_contrato": "duracao do contrato mencionada",
    "forma_pagamento": "se mencionou forma de pagamento"
  },
  "condicoes_especiais": ["descontos, bonus, condicoes especiais prometidas"],
  "dores_cliente": ["TODAS as dores e problemas que o cliente mencionou"],
  "metas_cliente": ["metas e objetivos que o cliente quer atingir"],
  "metricas_cliente": {
    "faturamento": "se mencionado",
    "ticket_medio": "se mencionado",
    "qtd_clientes_atuais": "se mencionado",
    "investimento_atual_marketing": "se mencionado",
    "custo_aquisicao_cliente": "se mencionado",
    "taxa_conversao": "se mencionado"
  },
  "concorrentes": {
    "mencionados_na_call": [
      {"nome": "nome do concorrente", "contexto": "o que foi dito sobre ele", "url_site": "se mencionado"}
    ],
    "sugeridos_pela_ia": [
      {"nome": "nome provavel de concorrente", "motivo": "por que seria concorrente (mesmo segmento, mesma regiao)", "o_que_pesquisar": "site, Google Ads, Meta Ads, redes sociais — descreva o que o time deve investigar"}
    ]
  },
  "insights_operacionais": [
    "insights ACIONAVEIS e ESPECIFICOS para o time de marketing usar desde o primeiro dia. Baseie-se no diagnostico do closer e nas dores do cliente. Ex: 'Cliente nao tem Landing Page — priorizar criacao de LP de captura antes de subir campanhas', 'Site sem tag do Google — instalar GTM e pixels antes de iniciar trafego'"
  ],
  "brief_operacional": "paragrafo de 5-8 linhas resumindo TUDO que o time precisa saber para comecar: quem e o cliente, o que faz, qual a dor principal, o que foi vendido, quais sao as prioridades, e o que o closer prometeu",
  "alertas": ["promessas dificeis de cumprir, expectativas irreais do cliente, prazos apertados, divergencias entre o que foi dito e o que normalmente se entrega"]
}

REGRAS IMPORTANTES:
1. DIAGNOSTICO DO CLOSER: Extraia TUDO que o closer apresentou como analise previa (cliente oculto). Isso e ouro pro time operacional.
2. O QUE FOI VENDIDO: Seja PRECISO. Liste cada servico com valor, prazo e frequencia. O time precisa saber exatamente o que entregar.
3. CONCORRENTES: Se o cliente NAO mencionou concorrentes, use os dados que voce tem (segmento, regiao, porte) para SUGERIR provaveis concorrentes. Descreva o que o time deve pesquisar em cada um (site, Google Ads, Meta Ads, redes sociais, posicionamento).
4. INSIGHTS: Devem ser especificos e acionaveis. Nada generico como "melhorar o marketing". Diga EXATAMENTE o que fazer.
5. Contrato: ${contrato ? "Compare o que foi vendido com o contrato abaixo." : "Nao ha contrato para comparar — foque na analise da call."}
6. Use portugues brasileiro.

${contrato ? `\nConteudo do contrato:\n${contrato.slice(0, 30000)}\n` : ""}
Transcricao da(s) call(s):
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
