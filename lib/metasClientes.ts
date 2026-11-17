// =====================================================================
// Metas dos Clientes — regras usadas pela tela e pelo MCP
// Meta mensal (leads e faturamento) + lançamento semanal (sábado a sexta,
// a mesma semana da FCA). A semana conta no mês da sua sexta-feira e precisa
// ser lançada até a segunda-feira seguinte. O resultado do mês é a soma das
// semanas, a não ser que alguém informe o total do mês (correção).
// =====================================================================

export type MetaMensal = {
  id: string;
  cliente_id: string;
  ano: number;
  mes: number;
  meta_leads: number | null;
  meta_faturamento: number | null;
  resultado_leads: number | null;        // correção do total do mês (vazio = soma das semanas)
  resultado_faturamento: number | null;
  observacoes: string | null;
  atualizado_por: string | null;
  updated_at: string;
};

export type MetaSemanal = {
  id: string;
  cliente_id: string;
  data_referencia: string;               // sexta-feira (YYYY-MM-DD)
  ano: number;
  mes: number;
  leads: number | null;
  faturamento: number | null;
  observacoes: string | null;
  atualizado_por: string | null;
  updated_at: string;
};

export type SituacaoMeta = "sem_meta" | "meta_incompleta" | "semana_pendente" | "em_andamento" | "sem_resultado" | "completo";

export const SITUACAO_META: Record<SituacaoMeta, string> = {
  sem_meta: "Sem meta",
  meta_incompleta: "Meta incompleta",
  semana_pendente: "Semana não lançada",
  em_andamento: "Em andamento",
  sem_resultado: "Falta resultado",
  completo: "Completo",
};

export const situacaoPendente = (s: SituacaoMeta) =>
  s === "sem_meta" || s === "meta_incompleta" || s === "semana_pendente" || s === "sem_resultado";

const MES_CURTO = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

export function addDias(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Data de hoje no horário de Brasília (YYYY-MM-DD). */
export const hojeIsoBr = () => new Date(Date.now() - 3 * 3600_000).toISOString().slice(0, 10);

/** "dd/mmm" de uma data ISO. */
export const diaMes = (iso: string) => `${iso.slice(8, 10)}/${MES_CURTO[Number(iso.slice(5, 7)) - 1]}`;

/** Rótulo da semana: "31/out a 06/nov". */
export const rotuloSemana = (sexta: string) => `${diaMes(addDias(sexta, -6))} a ${diaMes(sexta)}`;

/** Sextas-feiras do mês (cada uma fecha uma semana que conta nesse mês). */
export function sextasDoMes(ano: number, mes: number): string[] {
  const out: string[] = [];
  const d = new Date(Date.UTC(ano, mes - 1, 1, 12));
  while (d.getUTCDay() !== 5) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCMonth() === mes - 1) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

/** Sexta da semana (sábado a sexta) que contém a data. */
export function sextaDaSemana(iso: string) {
  const dow = new Date(iso + "T12:00:00Z").getUTCDay();
  return addDias(iso, dow === 6 ? 6 : 5 - dow);
}

/** Segunda-feira depois da sexta: último dia para lançar a semana. */
export const prazoDaSemana = (sexta: string) => addDias(sexta, 3);

/** A semana já passou do prazo e é cobrada? */
export const semanaCobrada = (sexta: string, hoje: string) => hoje > prazoDaSemana(sexta);

export const semanaLancada = (s?: MetaSemanal | null) => s?.leads != null && s?.faturamento != null;

export const mesFechadoEm = (ano: number, mes: number, hoje: string) =>
  ano * 12 + mes < Number(hoje.slice(0, 4)) * 12 + Number(hoje.slice(5, 7));

/** Semana que a tela abre por padrão: a última que já fechou (sexta ≤ hoje) no mês, senão a primeira. */
export function semanaPadrao(ano: number, mes: number, hoje: string) {
  const sextas = sextasDoMes(ano, mes);
  const fechadas = sextas.filter((s) => s <= hoje);
  return fechadas[fechadas.length - 1] ?? sextas[0];
}

const pct = (a: number | null, b: number | null) => (a == null || b == null || b <= 0 ? null : (a / b) * 100);

/** Tudo que a tela e o MCP mostram de um cliente no mês. */
export function resumoMeta(meta: MetaMensal | undefined | null, semanas: MetaSemanal[], ano: number, mes: number, hoje: string) {
  const sextas = sextasDoMes(ano, mes);
  const porSexta = new Map(semanas.map((s) => [s.data_referencia, s]));
  const fechado = mesFechadoEm(ano, mes, hoje);
  const cobradas = sextas.filter((s) => semanaCobrada(s, hoje));
  const naoLancadas = cobradas.filter((s) => !semanaLancada(porSexta.get(s)));

  const comLeads = semanas.filter((s) => s.leads != null);
  const comFat = semanas.filter((s) => s.faturamento != null);
  const somaLeads = comLeads.length ? comLeads.reduce((t, s) => t + Number(s.leads), 0) : null;
  const somaFat = comFat.length ? comFat.reduce((t, s) => t + Number(s.faturamento), 0) : null;

  const corrigidoLeads = meta?.resultado_leads != null;
  const corrigidoFat = meta?.resultado_faturamento != null;
  const realLeads = corrigidoLeads ? Number(meta!.resultado_leads) : somaLeads;
  const realFat = corrigidoFat ? Number(meta!.resultado_faturamento) : somaFat;

  const metaLeads = meta?.meta_leads != null ? Number(meta.meta_leads) : null;
  const metaFat = meta?.meta_faturamento != null ? Number(meta.meta_faturamento) : null;

  // Ritmo: quanto da meta já era esperado pelas semanas que passaram do prazo
  const fracao = fechado ? 1 : sextas.length ? cobradas.length / sextas.length : 0;
  const esperadoLeads = metaLeads != null && fracao > 0 ? metaLeads * fracao : null;
  const esperadoFat = metaFat != null && fracao > 0 ? metaFat * fracao : null;

  let situacao: SituacaoMeta;
  if (metaLeads == null && metaFat == null) situacao = "sem_meta";
  else if (metaLeads == null || metaFat == null) situacao = "meta_incompleta";
  else if (naoLancadas.length && !(fechado && corrigidoLeads && corrigidoFat)) situacao = "semana_pendente";
  else if (!fechado) situacao = "em_andamento";
  else if (realLeads == null || realFat == null) situacao = "sem_resultado";
  else situacao = "completo";

  return {
    sextas, cobradas, naoLancadas, fechado, fracao,
    metaLeads, metaFat, somaLeads, somaFat, realLeads, realFat, corrigidoLeads, corrigidoFat,
    esperadoLeads, esperadoFat,
    atingLeads: pct(realLeads, metaLeads), atingFat: pct(realFat, metaFat),
    ritmoLeads: pct(realLeads ?? 0, esperadoLeads), ritmoFat: pct(realFat ?? 0, esperadoFat),
    situacao, pendente: situacaoPendente(situacao),
  };
}
