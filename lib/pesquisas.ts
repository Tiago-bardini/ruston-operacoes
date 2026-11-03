// Pesquisas do cliente (Pilar 2 do Playbook NPS). As perguntas vêm do Playbook NPS
// da V4 Barcellos & Co. Usado pela tela interna, pela página pública /p/<token> e pela API.

export type TipoPesquisa = "planejamento" | "checkin" | "ee";

export type TipoPergunta = "escala" | "unica" | "multipla" | "texto";

export interface Pergunta {
  id: string;
  titulo?: string;           // rótulo curto em caixa alta (ex.: "Clareza")
  texto: string;
  tipo: TipoPergunta;
  obrigatoria: boolean;
  escala?: { min: number; max: number; minLabel?: string; maxLabel?: string; labels?: Record<number, string> };
  opcoes?: string[];
  // Pontos (0 a 5) de cada opção de escolha única: entra na nota da pesquisa
  pontos?: number[];
  // Só aparece se outra pergunta tiver essa resposta
  se?: { pergunta: string; resposta: string };
}

export interface Formulario {
  tipo: TipoPesquisa;
  titulo: string;
  abertura: string;
  perguntas: Pergunta[];
}

export interface Pesquisa {
  id: string;
  token: string;
  cliente_id: string;
  tipo: TipoPesquisa;
  semana_ee: number | null;
  enviada_por: string | null;
  criada_em: string;
  respondida_em: string | null;
  respostas: Record<string, string | number | string[]> | null;
  nota: number | null;
  cancelada: boolean;
}

export const TIPO_PESQUISA_LABEL: Record<TipoPesquisa, string> = {
  planejamento: "Pós-planejamento",
  checkin: "Pós-check-in",
  ee: "Estruturação Estratégica",
};

export const nomePesquisa = (tipo: TipoPesquisa, semana?: number | null) =>
  tipo === "ee" && semana ? `${TIPO_PESQUISA_LABEL.ee} · ${semana === 5 ? "Entrega final (S5)" : `Semana ${semana}`}` : TIPO_PESQUISA_LABEL[tipo];

// Abaixo disso a pesquisa vira sinal de alerta (flag yellow) no Radar de Churn
export const NOTA_ALERTA = 3;
export const NOTA_GRAVE = 2;

const ESCALA_0_5 = { min: 0, max: 5, minLabel: "Nada satisfeito", maxLabel: "Muito satisfeito" };

const PLANEJAMENTO: Formulario = {
  tipo: "planejamento",
  titulo: "Pesquisa CSAT | Pós Planejamento",
  abertura: "Esta pesquisa rápida leva menos de 2 minutos. Queremos entender o quanto a estratégia entregue (Tráfego, Criativos, LPs e ações) atendeu às suas expectativas para garantirmos total alinhamento antes de ir para a execução.",
  perguntas: [
    { id: "satisfacao_estrategia", texto: "De 0 a 5, o quanto você ficou satisfeito com a estratégia apresentada para o seu negócio?", tipo: "escala", obrigatoria: true, escala: ESCALA_0_5 },
    { id: "plano_expectativas", texto: "O plano apresentado (Tráfego, Criativos, LPs e Ações) atendeu às suas expectativas de crescimento?", tipo: "escala", obrigatoria: true, escala: ESCALA_0_5 },
    { id: "social_media", texto: "O seu projeto contempla Social Media?", tipo: "unica", obrigatoria: true, opcoes: ["Sim", "Não"] },
    { id: "social_alinhada", texto: "A estratégia proposta para as redes sociais está alinhada ao que você esperava?", tipo: "texto", obrigatoria: false, se: { pergunta: "social_media", resposta: "Sim" } },
    { id: "falta_algo", texto: "Falta algo na estratégia entregue ou podemos seguir para a aprovação e execução?", tipo: "texto", obrigatoria: false },
  ],
};

const CHECKIN: Formulario = {
  tipo: "checkin",
  titulo: "Avaliação do Check-in",
  abertura: "Leva menos de 1 minuto. Sua avaliação ajuda a deixar o próximo check-in ainda mais útil para você.",
  perguntas: [
    { id: "clareza", titulo: "Clareza das informações e resultados", texto: "As informações, métricas de resultado e investimentos apresentados ficaram claros para você?", tipo: "unica", obrigatoria: true,
      opcoes: ["Sim, tudo ficou extremamente claro e transparente.", "Em grande parte, mas ainda tenho algumas dúvidas.", "Não, achei a apresentação confusa ou complexa."], pontos: [5, 3, 0] },
    { id: "alinhamento", titulo: "Alinhamento com expectativas", texto: "O panorama apresentado hoje atendeu às suas expectativas para esta semana?", tipo: "escala", obrigatoria: true,
      escala: { min: 1, max: 5, labels: { 1: "Totalmente desalinhado", 2: "Ficou abaixo do esperado", 3: "Atendeu parcialmente", 4: "Atendeu completamente", 5: "Superou as expectativas" } } },
    { id: "temas", titulo: "Relevância dos conteúdos", texto: "Quais dos temas abordados foram mais valiosos para você na reunião de hoje?", tipo: "multipla", obrigatoria: false,
      opcoes: ["Balanço financeiro e investimentos do período", "Resultados das métricas principais (KPIs)", "Análise dos criativos/ações vencedores", "Próximos passos e plano de ação futuro", "Oportunidades e gargalos identificados"] },
    { id: "proximos_passos", titulo: "Próximos passos", texto: "Ficou claro para você o que o time fará ao longo desta próxima semana?", tipo: "unica", obrigatoria: true,
      opcoes: ["Sim, sei exatamente o que está sendo executado e o que esperar.", "Tenho uma ideia geral, mas gostaria de mais detalhes no acompanhamento.", "Não, não entendi os próximos passos."], pontos: [5, 3, 0] },
    { id: "satisfacao_geral", titulo: "Satisfação geral", texto: "De forma geral, como você avalia o check-in de hoje?", tipo: "unica", obrigatoria: true,
      opcoes: ["Excelente (Produtiva e direto ao ponto)", "Boa (Atendeu ao objetivo)", "Neutra (Poderia ser melhor)", "Ruim (Desgastante / Pouco proveitosa)"], pontos: [5, 4, 2, 0] },
    { id: "comentario", titulo: "Elogio, crítica ou sugestão", texto: "Quer deixar algum elogio, crítica ou sugestão para o nosso próximo check-in?", tipo: "texto", obrigatoria: false },
  ],
};

// EE: perguntas por semana, a partir das reuniões da E.E (S1 kickoff, S2 mercado, S3 marketing, S4 comercial).
// A S5 (entrega final) usa o link da pesquisa da matriz e não é gerada pelo sistema.
export const SEMANA_EE_MATRIZ = 5;

const SIM_PARCIAL_NAO = { tipo: "unica" as const, obrigatoria: true, opcoes: ["Sim", "Parcialmente", "Não"], pontos: [5, 3, 0] };
const COMENTARIO_FINAL: Pergunta = { id: "comentario", titulo: "Espaço livre", texto: "Quer deixar algum comentário, elogio ou sugestão para o time?", tipo: "texto", obrigatoria: false };
const satisfacao = (texto: string): Pergunta => ({ id: "satisfacao_semana", texto, tipo: "escala", obrigatoria: true, escala: ESCALA_0_5 });
const SEMANA_DESTA = "De 0 a 5, quão satisfeito você ficou com a entrega desta semana?";

const EE_SEMANAS: Record<number, { tema: string; perguntas: Pergunta[] }> = {
  1: { tema: "Kickoff", perguntas: [
    satisfacao("De 0 a 5, quão satisfeito você ficou com o kickoff do projeto?"),
    { id: "clareza_cronograma", texto: "Ficou claro o que vai acontecer nas próximas 5 semanas e o que será entregue em cada uma?", ...SIM_PARCIAL_NAO },
    { id: "entendeu_negocio", texto: "Você sentiu que o time da V4 entendeu o seu negócio, seus objetivos e suas metas?", ...SIM_PARCIAL_NAO },
    { id: "faltou_falar", texto: "Tem algo importante sobre o seu negócio que você sente que não falamos e precisamos saber?", tipo: "texto", obrigatoria: false },
    COMENTARIO_FINAL,
  ] },
  2: { tema: "Mercado", perguntas: [
    satisfacao(SEMANA_DESTA),
    { id: "personas", texto: "As personas apresentadas retratam bem os clientes que você atende hoje?", ...SIM_PARCIAL_NAO },
    { id: "dados_mercado", texto: "Os dados de mercado e o potencial de faturamento trouxeram algo novo para você?", tipo: "unica", obrigatoria: true,
      opcoes: ["Sim, muita coisa nova", "Algumas coisas", "Não, eu já sabia"], pontos: [5, 3, 0] },
    { id: "aprendizado", texto: "Qual foi o principal aprendizado sobre o seu mercado ou sobre os seus concorrentes?", tipo: "texto", obrigatoria: false },
    COMENTARIO_FINAL,
  ] },
  3: { tema: "Marketing", perguntas: [
    satisfacao(SEMANA_DESTA),
    { id: "diagnostico_marketing", texto: "O diagnóstico de marca, redes sociais, site e Google refletiu a realidade da sua empresa?", ...SIM_PARCIAL_NAO },
    { id: "clareza_mudancas", texto: "Ficou claro o que vamos mudar no marketing e por onde vamos começar (anúncios, perfil, criativos)?", ...SIM_PARCIAL_NAO },
    { id: "duvidas", texto: "Ficou alguma dúvida ou discordância sobre o que foi apresentado?", tipo: "texto", obrigatoria: false },
    COMENTARIO_FINAL,
  ] },
  4: { tema: "Comercial", perguntas: [
    satisfacao(SEMANA_DESTA),
    { id: "diagnostico_comercial", texto: "O diagnóstico do atendimento (cliente oculto) mostrou com fidelidade como o seu comercial funciona hoje?", ...SIM_PARCIAL_NAO },
    { id: "seguranca_aplicar", texto: "Você se sente seguro para colocar em prática o que foi proposto?", tipo: "unica", obrigatoria: true,
      opcoes: ["Sim", "Em parte, preciso de ajuda", "Não"], pontos: [5, 3, 0] },
    { id: "aprendizado", texto: "Qual foi o principal aprendizado sobre o seu comercial?", tipo: "texto", obrigatoria: false },
    COMENTARIO_FINAL,
  ] },
};

// Pesquisa EE antiga, sem semana definida
const EE_SEMANAL: Pergunta[] = [
  satisfacao(SEMANA_DESTA),
  { id: "clareza_negocio", texto: "A entrega desta semana trouxe clareza sobre o seu negócio?", ...SIM_PARCIAL_NAO },
  { id: "aprendizado", texto: "Qual foi o principal aprendizado ou descoberta que você teve com essa entrega?", tipo: "texto", obrigatoria: false },
  COMENTARIO_FINAL,
];

// Mantido só para exibir pesquisas de S5 geradas antes da regra da matriz
const EE_FINAL: Pergunta[] = [
  { id: "profundidade_diagnostico", texto: "De 0 a 5, quão satisfeito você ficou com a profundidade do Diagnóstico entregue?", tipo: "escala", obrigatoria: true, escala: ESCALA_0_5 },
  { id: "analises_gargalos", texto: "Como avalia as análises e gargalos apontados em Vendas, Marketing, Redes e Cliente Oculto?", tipo: "escala", obrigatoria: true, escala: ESCALA_0_5 },
  { id: "pontos_cegos", texto: "O diagnóstico trouxe clareza sobre os reais pontos cegos do seu negócio hoje?", tipo: "unica", obrigatoria: true, opcoes: ["Sim", "Parcialmente", "Não"], pontos: [5, 3, 0] },
  { id: "aprendizado", texto: "Qual foi o principal aprendizado ou descoberta que você teve com essa entrega?", tipo: "texto", obrigatoria: false },
];

export function formularioDe(tipo: TipoPesquisa, semana?: number | null): Formulario {
  if (tipo === "planejamento") return PLANEJAMENTO;
  if (tipo === "checkin") return CHECKIN;
  const final = semana === SEMANA_EE_MATRIZ;
  const doTema = semana ? EE_SEMANAS[semana] : undefined;
  return {
    tipo: "ee",
    titulo: `Pesquisa de Satisfação EE${final ? " | Entrega final" : semana ? ` | Semana ${semana}${doTema ? ` · ${doTema.tema}` : ""}` : ""}`,
    abertura: final
      ? "Esta pesquisa rápida leva menos de 2 minutos. Seu feedback é fundamental para sabermos se a Estruturação Estratégica (Marketing e Vendas) trouxe clareza sobre os pontos cegos e gargalos do seu negócio."
      : "Leva menos de 1 minuto. Queremos saber como foi a entrega desta semana da Estruturação Estratégica.",
    perguntas: final ? EE_FINAL : doTema?.perguntas ?? EE_SEMANAL,
  };
}

/** Pergunta visível com as respostas atuais (perguntas condicionais) */
export const perguntaVisivel = (p: Pergunta, respostas: Record<string, unknown>) =>
  !p.se || respostas[p.se.pergunta] === p.se.resposta;

/** Valida as respostas: devolve o texto do erro ou null */
export function validarRespostas(f: Formulario, respostas: Record<string, unknown>): string | null {
  for (const p of f.perguntas) {
    if (!perguntaVisivel(p, respostas)) continue;
    const r = respostas[p.id];
    const vazio = r == null || r === "" || (Array.isArray(r) && r.length === 0);
    if (p.obrigatoria && vazio) return `Responda: "${p.texto}"`;
    if (vazio) continue;
    if (p.tipo === "escala" && p.escala && (typeof r !== "number" || r < p.escala.min || r > p.escala.max)) return `Resposta inválida em: "${p.texto}"`;
    if (p.tipo === "unica" && !p.opcoes?.includes(r as string)) return `Resposta inválida em: "${p.texto}"`;
    if (p.tipo === "multipla" && (!Array.isArray(r) || r.some((x) => !p.opcoes?.includes(x)))) return `Resposta inválida em: "${p.texto}"`;
    if (p.tipo === "texto" && (typeof r !== "string" || r.length > 3000)) return `Resposta inválida em: "${p.texto}"`;
  }
  return null;
}

/** Nota da pesquisa de 0 a 5: média das escalas (convertidas para 0–5) e das escolhas com pontos */
export function calcularNota(f: Formulario, respostas: Record<string, unknown>): number | null {
  const notas: number[] = [];
  for (const p of f.perguntas) {
    const r = respostas[p.id];
    if (p.tipo === "escala" && p.escala && typeof r === "number") {
      notas.push(((r - p.escala.min) / (p.escala.max - p.escala.min)) * 5);
    } else if (p.tipo === "unica" && p.pontos && typeof r === "string") {
      const i = p.opcoes?.indexOf(r) ?? -1;
      if (i >= 0) notas.push(p.pontos[i]);
    }
  }
  if (!notas.length) return null;
  return Math.round((notas.reduce((s, n) => s + n, 0) / notas.length) * 10) / 10;
}

export const corNota = (n: number | null) =>
  n == null ? "text-brand-muted" : n < NOTA_GRAVE ? "text-red-300" : n < NOTA_ALERTA ? "text-amber-300" : n < 4 ? "text-sky-300" : "text-emerald-300";

/** Respostas abertas (texto) de uma pesquisa respondida, para leitura rápida */
export function comentariosDe(p: Pesquisa): { pergunta: string; texto: string }[] {
  if (!p.respostas) return [];
  const f = formularioDe(p.tipo, p.semana_ee);
  return f.perguntas
    .filter((q) => q.tipo === "texto" && typeof p.respostas?.[q.id] === "string" && (p.respostas[q.id] as string).trim())
    .map((q) => ({ pergunta: q.texto, texto: p.respostas![q.id] as string }));
}
