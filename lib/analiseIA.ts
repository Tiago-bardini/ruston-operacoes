// =====================================================================
// ANÁLISE DE RELACIONAMENTO COM IA — compartilhada entre Reuniões e WhatsApp
// =====================================================================
// As duas análises devolvem os mesmos blocos "extras" (estresse, reclamação,
// intenção de compra, resultado percebido, mudanças no negócio, concorrência,
// compromissos, condução do time e insights). Assim a tela mostra tudo igual.
// =====================================================================

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
export const MODELO_LLM = "claude-sonnet-4-5-20250929";

export type Nivel3 = "nenhum" | "leve" | "alto";

export type AnaliseExtra = {
  estresse: Nivel3;
  estresse_detalhe: string;
  reclamacao: { houve: boolean; motivos: string[] };
  intencao_compra: { nivel: "nenhuma" | "possivel" | "clara"; produtos: string[]; evidencia: string };
  resultado_percebido: { avaliacao: "satisfeito" | "neutro" | "insatisfeito" | "nao_mencionado"; detalhe: string };
  mudancas_negocio: { tipo: string; descricao: string }[];
  concorrencia: { mencionou: boolean; detalhe: string };
  compromissos: { o_que: string; responsavel: string; prazo: string; lado: "ruston" | "cliente" }[];
  conducao: { nota: number; teve_pauta: boolean; apresentou_dados: boolean; fechou_proximos_passos: boolean; comentario: string };
  insights: string[];
  plano_acao: { ponto: string; sugestao: string; responsavel: string; prioridade: "alta" | "media" | "baixa"; prazo: string }[];
  /** Só nas reuniões de Estruturação Estratégica (título com E.E / EE / Estruturação Estratégica) */
  estruturacao?: AvaliacaoEE | null;
};

export type AvaliacaoEE = {
  semana: 1 | 2 | 3 | 4 | 5 | null;
  etapa: string;
  entregas: { item: string; status: "entregue" | "parcial" | "nao_entregue"; comentario: string }[];
  nota_entrega: number;             // 1-5, qualidade do que o time entregou
  cliente_validou: boolean;         // cliente aprovou / concordou com o que foi apresentado
  pontos_fortes: string[];
  lacunas: string[];                // o que faltou entregar ou ficou fraco
  pendencias_proxima_semana: string[];
};

// ============================ ESTRUTURAÇÃO ESTRATÉGICA ============================
// A E.E tem 5 semanas; cada reunião apresenta uma delas.
export const SEMANAS_EE: { semana: number; nome: string; entregas: string[] }[] = [
  { semana: 1, nome: "Boas-vindas / Kickoff", entregas: [
    "Conhecer o negócio do cliente (modelo, público, objetivos)",
    "Revisar o contrato com o cliente e alinhar o que foi vendido",
  ] },
  { semana: 2, nome: "Pesquisa de mercado", entregas: [
    "Pesquisa aprofundada do mercado do cliente",
  ] },
  { semana: 3, nome: "Diagnóstico de Marketing e Vendas", entregas: [
    "Análise das campanhas do cliente",
    "Análise dos criativos",
    "Análise dos concorrentes (o que fazem e o que deixam de fazer)",
    "Confirmação com o cliente para subir as primeiras campanhas de anúncios",
  ] },
  { semana: 4, nome: "Diagnóstico Comercial", entregas: [
    "Diagnóstico do comercial do cliente",
    "Pontos de melhoria do comercial apresentados",
  ] },
  { semana: 5, nome: "Entrega final", entregas: [
    "Compilado final da Estruturação Estratégica entregue ao cliente",
    "Forecast de investimento em mídia para os próximos 12 meses",
  ] },
];

const semAcento = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Título indica reunião de Estruturação Estratégica: "E.E", "E.E.", "EE", "Estruturação Estratégica". */
export function ehEstruturacao(titulo?: string | null): boolean {
  if (!titulo) return false;
  const t = semAcento(titulo);
  return /estruturacao estrategica/.test(t) || /(^|[^a-z0-9])e\.?\s?e\.?(?=$|[^a-z0-9])/.test(t.replace(/\be e\b/g, ""));
}

/** Semana citada no título ("S3", "Semana 3"), se houver. */
export function semanaNoTitulo(titulo?: string | null): number | null {
  const m = semAcento(titulo ?? "").match(/(?:^|[^a-z0-9])(?:s|semana)\s?([1-5])(?![0-9])/);
  return m ? Number(m[1]) : null;
}

function blocoEE(titulo?: string) {
  const sem = semanaNoTitulo(titulo);
  const roteiro = SEMANAS_EE.map((s) => `Semana ${s.semana} – ${s.nome}:\n${s.entregas.map((e) => `  • ${e}`).join("\n")}`).join("\n");
  return `
ESTA É UMA REUNIÃO DA ESTRUTURAÇÃO ESTRATÉGICA (E.E). A E.E tem 5 semanas, cada uma com entregas definidas:
${roteiro}
${sem ? `O título indica a Semana ${sem}; confirme pelo conteúdo.` : "Identifique pelo conteúdo qual semana está sendo apresentada."}

Além do relacionamento, AVALIE O QUE O TIME ENTREGOU nesta semana, preenchendo "estruturacao":
  "estruturacao": {
    "semana": 1 | 2 | 3 | 4 | 5 | null,
    "etapa": "nome da semana",
    "entregas": [{ "item": "cada entrega esperada da semana", "status": "entregue" | "parcial" | "nao_entregue", "comentario": "o que foi apresentado ou o que faltou" }],
    "nota_entrega": 1-5,
    "cliente_validou": true | false,
    "pontos_fortes": ["o que o time apresentou bem"],
    "lacunas": ["o que faltou ou ficou superficial"],
    "pendencias_proxima_semana": ["o que precisa estar pronto para a próxima semana"]
  }
Regras da E.E:
- Liste TODAS as entregas esperadas da semana em "entregas", mesmo as que não apareceram (status "nao_entregue")
- "nota_entrega" avalia profundidade e qualidade do que foi apresentado, não o humor do cliente
- "cliente_validou" true só se o cliente concordou/aprovou de forma explícita (na semana 3: autorizou subir as campanhas)
- Se for reunião interna de preparo, avalie o quanto a entrega está pronta para ser apresentada
`;
}

export type AnaliseReuniao = AnaliseExtra & {
  resumo_executivo: string;
  topicos_discutidos: string[];
  decisoes: string[];
  proximos_passos: string;
  temperatura: "quente" | "morna" | "fria";
  sentimento: "positivo" | "neutro" | "negativo";
  risco_churn: "baixo" | "medio" | "alto";
  oportunidade_upsell: "nenhuma" | "possivel" | "clara";
  sinais_positivos: string[];
  sinais_negativos: string[];
};

/** Trecho do JSON pedido ao Claude com os blocos extras (reunião e WhatsApp). */
export const SCHEMA_EXTRAS = `  "estresse": "nenhum" | "leve" | "alto",
  "estresse_detalhe": "o que mostra o nível de estresse do cliente (frase curta, vazio se nenhum)",
  "reclamacao": { "houve": true | false, "motivos": ["do que o cliente reclamou"] },
  "intencao_compra": { "nivel": "nenhuma" | "possivel" | "clara", "produtos": ["serviço/produto da Ruston/V4 que ele demonstrou interesse"], "evidencia": "o que ele disse" },
  "resultado_percebido": { "avaliacao": "satisfeito" | "neutro" | "insatisfeito" | "nao_mencionado", "detalhe": "como o cliente enxerga o retorno que está tendo" },
  "mudancas_negocio": [{ "tipo": "verba" | "decisor" | "sazonalidade" | "lancamento" | "estrutura" | "outro", "descricao": "o que mudou ou vai mudar no negócio do cliente" }],
  "concorrencia": { "mencionou": true | false, "detalhe": "outra agência, freelancer, levar pra dentro de casa..." },
  "compromissos": [{ "o_que": "o que foi prometido", "responsavel": "nome ou área", "prazo": "data ou prazo citado, vazio se não houver", "lado": "ruston" | "cliente" }],
  "conducao": { "nota": 1-5, "teve_pauta": true | false, "apresentou_dados": true | false, "fechou_proximos_passos": true | false, "comentario": "o que o time Ruston fez bem ou pode melhorar" },
  "insights": ["2 a 4 insights práticos e acionáveis para o time"],
  "plano_acao": [{ "ponto": "reclamação ou ponto levantado", "sugestao": "como resolver, passo concreto", "responsavel": "cargo sugerido (account, gestor de tráfego, coordenador...)", "prioridade": "alta" | "media" | "baixa", "prazo": "prazo sugerido (ex.: 48h, esta semana)" }]`;

export const REGRAS_EXTRAS = `- "estresse alto" só com sinais claros (irritação, cobrança dura, ultimato)
- "intencao_compra clara" só quando o cliente pede ou pergunta de um serviço novo/maior
- "resultado_percebido nao_mencionado" quando o assunto não apareceu
- compromissos: só o que foi combinado de fato, com o dono que foi citado
- conducao avalia o time Ruston (pauta, dados, próximos passos com dono e prazo)
- insights devem ser específicos deste cliente, nada genérico
- plano_acao: um item para cada reclamação e cada ponto de atenção levantado, com uma solução prática
  que a agência consegue executar; prioridade "alta" para o que ameaça o contrato. Lista vazia se não houver pontos`;

export async function chamarClaude(prompt: string, apiKey: string, maxTokens = 6000) {
  const res = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODELO_LLM,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic erro ${res.status}: ${await res.text()}`);

  const data = await res.json();
  const content: string = data.content?.[0]?.text ?? "";
  if (!content) throw new Error("resposta vazia do Claude");

  // Remove markdown se vier
  const limpo = content.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim();
  try {
    return {
      json: JSON.parse(limpo),
      tokens_entrada: (data.usage?.input_tokens ?? 0) as number,
      tokens_saida: (data.usage?.output_tokens ?? 0) as number,
    };
  } catch {
    throw new Error(`JSON inválido do Claude: ${limpo.slice(0, 200)}`);
  }
}

/** Prompt da reunião. `interna` = só o time Ruston/V4 falando sobre o cliente. */
/** Resumo escrito à mão: "coo" = 1:1 COO X Cliente · "ge_ee" = gerente com o cliente após a Estruturação Estratégica */
export type ResumoManual = "coo" | "ge_ee";

export function promptReuniao(opts: { cliente: string; titulo?: string; interna: boolean; transcricao: string; resumo?: ResumoManual }) {
  const contexto = opts.resumo === "ge_ee"
    ? `Esta foi a reunião/ligação do GERENTE da Ruston com o cliente "${opts.cliente}" depois da entrega da Estruturação Estratégica.
Não há transcrição: o texto abaixo é o RESUMO escrito pelo gerente. Avalie como o cliente recebeu a Estruturação Estratégica,
se está confiante para seguir, e os riscos e oportunidades para a fase seguinte.
Em "conducao", avalie pelo resumo se a conversa fechou próximos passos com dono e prazo (sem informação, nota 3).`
    : opts.resumo === "coo"
    ? `Esta foi uma conversa 1:1 por telefone entre o coordenador da Ruston e o cliente "${opts.cliente}".
Não há transcrição: o texto abaixo é o RESUMO escrito pelo coordenador depois da ligação. Analise o cliente pelo que ele relatou.
Em "conducao", avalie pelo resumo se a conversa fechou próximos passos com dono e prazo (sem informação, nota 3).`
    : opts.interna
    ? `Esta é uma reunião INTERNA do time Ruston sobre o cliente "${opts.cliente}" (o cliente não estava presente).
Avalie o cliente pelo que o time relatou dele. Em "conducao", avalie se a reunião interna gerou um plano claro.`
    : `Esta é uma reunião entre o time Ruston e o cliente "${opts.cliente}".`;
  const ee = !opts.resumo && ehEstruturacao(opts.titulo);

  return `Você é um analista sênior de relacionamento com cliente da agência de marketing Ruston & Co (franquia V4 Company).

${contexto}
${opts.titulo ? `Título da reunião: ${opts.titulo}\n` : ""}
Retorne APENAS um JSON válido (sem markdown, sem texto antes/depois) com esta estrutura:

{
  "resumo_executivo": "2-3 frases com o ponto principal da reunião",
  "topicos_discutidos": ["principais tópicos"],
  "decisoes": ["decisões tomadas"],
  "proximos_passos": "o que precisa acontecer até a próxima reunião",
  "temperatura": "quente" | "morna" | "fria",
  "sentimento": "positivo" | "neutro" | "negativo",
  "risco_churn": "baixo" | "medio" | "alto",
  "oportunidade_upsell": "nenhuma" | "possivel" | "clara",
  "sinais_positivos": ["sinais positivos"],
  "sinais_negativos": ["sinais de alerta"],
${SCHEMA_EXTRAS}${ee ? `,\n  "estruturacao": { ...conforme instruções da E.E abaixo }` : ""}
}
${ee ? blocoEE(opts.titulo) : ""}

Regras:
- Dê peso MAIOR ao que o tomador de decisão (dono/gerente) falou
- "risco_churn alto" só com sinais explícitos (ultimato, reclamação séria, falou em cancelar)
- "oportunidade_upsell clara" só quando o cliente pede mais serviço ou aumenta orçamento
${REGRAS_EXTRAS}
- Se não identificar algo, use lista vazia, false ou "nenhum"/"nenhuma"
- Português brasileiro, direto e prático

${opts.resumo === "ge_ee" ? "Resumo do gerente" : opts.resumo === "coo" ? "Resumo do coordenador" : "Transcrição"}:
${opts.transcricao.slice(0, 150000)}`;
}

/** Junta listas em texto para as colunas antigas (decisoes é text). */
export function listaParaTexto(v: unknown): string | null {
  if (Array.isArray(v)) return v.length ? v.map((x) => `• ${x}`).join("\n") : null;
  return typeof v === "string" && v.trim() ? v : null;
}

/** Só os blocos extras, para guardar junto da análise do WhatsApp. */
export function extrairExtras(a: any): AnaliseExtra {
  return {
    estresse: a?.estresse ?? "nenhum",
    estresse_detalhe: a?.estresse_detalhe ?? "",
    reclamacao: a?.reclamacao ?? { houve: false, motivos: [] },
    intencao_compra: a?.intencao_compra ?? { nivel: "nenhuma", produtos: [], evidencia: "" },
    resultado_percebido: a?.resultado_percebido ?? { avaliacao: "nao_mencionado", detalhe: "" },
    mudancas_negocio: a?.mudancas_negocio ?? [],
    concorrencia: a?.concorrencia ?? { mencionou: false, detalhe: "" },
    compromissos: a?.compromissos ?? [],
    conducao: a?.conducao ?? { nota: 0, teve_pauta: false, apresentou_dados: false, fechou_proximos_passos: false, comentario: "" },
    insights: a?.insights ?? [],
    plano_acao: a?.plano_acao ?? [],
    estruturacao: a?.estruturacao ?? null,
  };
}

/** Colunas de ruston_reunioes_cliente preenchidas a partir da análise. */
export function colunasDaAnalise(a: AnaliseReuniao, tokens: { tokens_entrada: number; tokens_saida: number }) {
  return {
    resumo: a.resumo_executivo ?? null,
    decisoes: listaParaTexto(a.decisoes),
    proximos_passos: listaParaTexto(a.proximos_passos),
    temperatura: a.temperatura ?? null,
    sentimento: a.sentimento ?? null,
    risco_churn: a.risco_churn ?? null,
    oportunidade_upsell: a.oportunidade_upsell ?? null,
    estresse: a.estresse ?? null,
    analise_ia: a,
    analisado_em: new Date().toISOString(),
    modelo: MODELO_LLM,
    tokens_entrada: tokens.tokens_entrada,
    tokens_saida: tokens.tokens_saida,
  };
}
