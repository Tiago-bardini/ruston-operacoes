// =====================================================================
// CONFERÊNCIA DE E.E — a IA confere o material da semana antes de ir pro
// cliente: (A) qualidade da entrega contra o padrão da semana e
// (B) coerência com o que o cliente falou nas reuniões anteriores.
// =====================================================================

export const SEMANAS_CONFERENCIA: { semana: number; nome: string; checklist: string[] }[] = [
  { semana: 1, nome: "Kickoff", checklist: [
    "Entendimento do negócio: modelo, produtos/serviços, ticket, margem, sazonalidade",
    "Objetivos e metas do cliente com número e prazo",
    "Público-alvo e canais de venda atuais",
    "Escopo do contrato e expectativas alinhadas (o que foi vendido)",
    "Cronograma das 5 semanas da E.E e responsáveis de cada lado",
    "Acessos e materiais solicitados (contas de anúncio, CRM, dados de vendas)",
  ] },
  { semana: 2, nome: "Pesquisa / Diagnóstico de Mercado", checklist: [
    "Tamanho e dinâmica do mercado (dados com fonte)",
    "Público e persona com dores, desejos e objeções reais",
    "Concorrentes diretos e indiretos: posicionamento, oferta, preço, canais",
    "Diferenciais e posicionamento do cliente frente aos concorrentes",
    "Oportunidades e ameaças concretas (SWOT ou equivalente)",
    "Conclusões que ligam a pesquisa a decisões de marketing e vendas",
  ] },
  { semana: 3, nome: "Diagnóstico de Mídia", checklist: [
    "Análise das campanhas atuais com métricas (investimento, CPM, CTR, CPL/CPA, conversões, ROAS)",
    "Estrutura das contas, rastreamento (pixel, conversões, UTMs) e problemas encontrados",
    "Análise dos criativos: o que funciona, o que não funciona e por quê",
    "Análise dos anúncios dos concorrentes (biblioteca de anúncios): o que fazem e o que deixam de fazer",
    "Canais, públicos e verba recomendados, coerentes com meta e ticket do cliente",
    "Plano das primeiras campanhas e próximo passo de aprovação para subir os anúncios",
  ] },
  { semana: 4, nome: "Diagnóstico de Vendas", checklist: [
    "Funil comercial mapeado com taxas de conversão por etapa",
    "Processo, CRM e tempo de resposta ao lead",
    "Time comercial: papéis, rotina, script e abordagem",
    "Gargalos priorizados com evidência (dados, ligações, cliente oculto)",
    "Plano de melhoria do comercial com responsáveis e prazos",
  ] },
  { semana: 5, nome: "Apresentação final", checklist: [
    "Compilado das semanas anteriores com as conclusões principais",
    "Plano de ação priorizado (90 dias) com responsáveis",
    "Forecast de investimento em mídia para 12 meses com metas e KPIs",
    "Projeção de resultado coerente com ticket, margem e ponto de equilíbrio do cliente",
    "Próximos passos claros, incluindo a continuidade com a assessoria",
  ] },
];

export const nomeSemana = (s: number) => SEMANAS_CONFERENCIA.find((x) => x.semana === s)?.nome ?? `Semana ${s}`;

export type Veredito = "apresentar" | "ajustar" | "refazer";
export type Gravidade = "alta" | "media" | "baixa";

export type ParecerEE = {
  semana: number;
  veredito: Veredito;
  nota_geral: number;
  resumo: string;
  pontos_fortes: string[];
  checklist: { item: string; status: "ok" | "parcial" | "faltando"; slides: string; comentario: string }[];
  criterios: { criterio: string; nota: number; comentario: string }[];
  coerencia: {
    tipo: "divergencia" | "nao_considerado" | "alinhado";
    gravidade: Gravidade;
    slide: string;
    apresentacao: string;
    cliente_disse: string;
    fonte: string;
  }[];
  ajustes: { prioridade: Gravidade; slide: string; ajuste: string }[];
  perguntas_cliente: string[];
  limitacoes: string;
};

export type ReuniaoContexto = {
  data_reuniao: string;
  titulo: string | null;
  transcricao: string | null;
  resumo: string | null;
  decisoes: string | null;
  proximos_passos: string | null;
};

/** Cabe tudo num orçamento de caracteres: cada reunião recebe uma fatia igual (o que sobra de uma passa pra outra). */
export function montarReunioes(reunioes: ReuniaoContexto[], orcamento = 200_000): string {
  if (reunioes.length === 0) return "(nenhuma reunião anterior registrada para este cliente)";
  const textos = reunioes.map((r) => {
    const partes = [
      r.resumo && `Resumo: ${r.resumo}`,
      r.decisoes && `Decisões: ${r.decisoes}`,
      r.proximos_passos && `Próximos passos: ${r.proximos_passos}`,
      r.transcricao && `Transcrição:\n${r.transcricao}`,
    ].filter(Boolean).join("\n");
    return { cab: `### Reunião ${formatarData(r.data_reuniao)} – ${r.titulo ?? "sem título"}`, corpo: partes || "(sem conteúdo)" };
  });
  let restante = orcamento;
  const ordem = textos.map((t, i) => ({ i, len: t.corpo.length })).sort((a, b) => a.len - b.len);
  const limite: number[] = [];
  ordem.forEach((o, k) => {
    const fatia = Math.floor(restante / (ordem.length - k));
    limite[o.i] = Math.min(o.len, fatia);
    restante -= limite[o.i];
  });
  return textos.map((t, i) => {
    const corpo = t.corpo.length > limite[i] ? t.corpo.slice(0, limite[i]) + "\n[...cortado por tamanho]" : t.corpo;
    return `${t.cab}\n${corpo}`;
  }).join("\n\n");
}

function formatarData(d: string) {
  const [a, m, dia] = d.slice(0, 10).split("-");
  return `${dia}/${m}/${a}`;
}

export function promptConferencia(o: {
  cliente: string;
  semana: number;
  padrao: string;
  reunioes: string;
  planejamento: string;
  observacao: string;
  materialTexto?: string;
}) {
  const sem = SEMANAS_CONFERENCIA.find((s) => s.semana === o.semana)!;
  return `Você é o gerente de qualidade da Ruston (franquia V4 Company) e confere a Estruturação Estratégica (E.E) antes de ela ser apresentada ao cliente.
A E.E tem 5 semanas: 1 Kickoff · 2 Pesquisa/Diagnóstico de Mercado · 3 Diagnóstico de Mídia · 4 Diagnóstico de Vendas · 5 Apresentação final.

CLIENTE: ${o.cliente}
MATERIAL A CONFERIR: Semana ${o.semana} – ${sem.nome}
${o.materialTexto ? `\n=== MATERIAL (texto extraído) ===\n${o.materialTexto}\n=== FIM DO MATERIAL ===\n` : "O material está no documento anexo."}

=== CHECKLIST DA SEMANA ${o.semana} ===
${sem.checklist.map((c) => `• ${c}`).join("\n")}
${o.padrao.trim() ? `\n=== PADRÃO V4 / POP DESTA SEMANA (régua principal; prevalece sobre o checklist acima) ===\n${o.padrao.trim()}\n` : ""}
=== O QUE O CLIENTE JÁ FALOU (reuniões anteriores, da mais antiga para a mais recente) ===
${o.reunioes}

=== PLANEJAMENTO DO CLIENTE NO SISTEMA ===
${o.planejamento || "(não preenchido)"}
${o.observacao.trim() ? `\n=== OBSERVAÇÃO DO GERENTE PARA ESTA CONFERÊNCIA ===\n${o.observacao.trim()}\n` : ""}
FAÇA DUAS CHECAGENS:

A) QUALIDADE DA ENTREGA
- Confira cada item do checklist (e do padrão V4, se houver): "ok", "parcial" ou "faltando", citando os slides/páginas onde aparece.
- Avalie com nota 0-10: "Profundidade da análise", "Dados e evidências" (número com fonte, print, métrica real), "Personalização ao cliente" (é sobre ESTE cliente ou é genérico?), "Recomendações acionáveis", "Clareza e narrativa", "Acabamento" (erros de português, slide poluído, dado inconsistente entre slides, nome de outro cliente esquecido).
- Seja criterioso: aponte número sem fonte, conclusão sem dado que a sustente, recomendação genérica que serviria para qualquer cliente, conta que não fecha.

B) COERÊNCIA COM O CLIENTE
- Compare o material com o que o CLIENTE disse nas reuniões: metas, ticket, margem, verba, público, canais que vendem, o que já tentou, restrições, objeções, prioridades e prazos.
- "divergencia": o material contradiz o que o cliente disse sem justificar a mudança.
- "nao_considerado": o cliente trouxe algo importante e o material ignora.
- "alinhado": pontos-chave que o material respeitou (no máximo 4, só os relevantes).
- "cliente_disse" deve ser a fala do cliente o mais literal possível, e "fonte" a reunião (data e título). NUNCA invente fala ou reunião. Se não houver reunião que trate do assunto, não crie o item.
- Diferencie o que o cliente disse do que o time da Ruston/V4 disse. Estratégia pode evoluir: só é divergência se contradiz sem explicar.

REGRAS DE NOTA E VEREDITO
- 9-10: pronto, padrão das melhores E.E · 7-8: ajustes pequenos · 5-6: ajustes relevantes · abaixo de 5: refazer.
- "refazer": falta item essencial da semana OU há divergência de gravidade alta que muda a recomendação.
- "ajustar": dá para apresentar depois de corrigir os ajustes de prioridade alta.
- "apresentar": só se nada de prioridade alta ficar pendente.
- Ajustes concretos, por slide, escritos como instrução ("Slide 7: trocar X por Y porque o cliente disse Z"). Ordene por prioridade.
- "perguntas_cliente": o que ainda falta saber do cliente para fechar a entrega (máx. 5).
- "limitacoes": o que limitou a conferência (ex.: poucas reuniões registradas, slides só com imagem). Vazio se nada.
- Português do Brasil, direto, sem enrolação.

Entregue o parecer pela ferramenta registrar_parecer. Liste no checklist todos os itens do padrão/checklist da semana.`;
}

const txt = { type: "string" } as const;
const grav = { type: "string", enum: ["alta", "media", "baixa"] } as const;
const lista = (items: object) => ({ type: "array", items });

/** Formato do parecer (tool use da API: a IA preenche o objeto, sem JSON quebrado). */
export const FERRAMENTA_PARECER = {
  name: "registrar_parecer",
  description: "Registra o parecer da conferência da E.E.",
  input_schema: {
    type: "object",
    required: ["semana", "veredito", "nota_geral", "resumo", "pontos_fortes", "checklist", "criterios", "coerencia", "ajustes", "perguntas_cliente", "limitacoes"],
    properties: {
      semana: { type: "integer" },
      veredito: { type: "string", enum: ["apresentar", "ajustar", "refazer"] },
      nota_geral: { type: "number", description: "0 a 10" },
      resumo: { ...txt, description: "2 a 4 frases com o veredito e o porquê" },
      pontos_fortes: lista(txt),
      checklist: lista({ type: "object", required: ["item", "status", "slides", "comentario"], properties: {
        item: txt, status: { type: "string", enum: ["ok", "parcial", "faltando"] }, slides: txt, comentario: txt } }),
      criterios: lista({ type: "object", required: ["criterio", "nota", "comentario"], properties: {
        criterio: txt, nota: { type: "number" }, comentario: txt } }),
      coerencia: lista({ type: "object", required: ["tipo", "gravidade", "slide", "apresentacao", "cliente_disse", "fonte"], properties: {
        tipo: { type: "string", enum: ["divergencia", "nao_considerado", "alinhado"] }, gravidade: grav,
        slide: txt, apresentacao: txt, cliente_disse: txt, fonte: txt } }),
      ajustes: lista({ type: "object", required: ["prioridade", "slide", "ajuste"], properties: { prioridade: grav, slide: txt, ajuste: txt } }),
      perguntas_cliente: lista(txt),
      limitacoes: txt,
    },
  },
};

/** Tira tags, scripts e estilos de um HTML e devolve o texto legível. */
export function htmlParaTexto(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/section)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
