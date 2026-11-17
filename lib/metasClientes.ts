// =====================================================================
// Metas dos Clientes — regras usadas pela tela e pelo MCP
// Meta mensal (leads e faturamento) + lançamento semanal. A semana vai de
// sábado a sexta, mas é FECHADA dentro do mês: a primeira começa no dia 01 e
// a última termina no último dia do mês (podem ficar mais curtas). Cada semana
// é identificada pelo seu último dia (data_referencia) e precisa ser lançada
// até a segunda-feira seguinte. O resultado do mês é a soma das semanas, a não
// ser que alguém informe o total do mês (correção).
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
  data_referencia: string;               // último dia da semana: sexta ou o último dia do mês (YYYY-MM-DD)
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

const diaSemana = (iso: string) => new Date(iso + "T12:00:00Z").getUTCDay(); // 0=dom ... 5=sex, 6=sáb
const primeiroDia = (iso: string) => iso.slice(0, 8) + "01";
const ultimoDia = (iso: string) => {
  const d = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)), 0, 12));
  return d.toISOString().slice(0, 10);
};
const maior = (a: string, b: string) => (a > b ? a : b);
const menor = (a: string, b: string) => (a < b ? a : b);

/** Primeiro dia da semana que contém a data: o sábado anterior, sem sair do mês. */
export const inicioDaSemana = (iso: string) => maior(addDias(iso, -((diaSemana(iso) + 1) % 7)), primeiroDia(iso));

/** Último dia da semana que contém a data: a sexta seguinte, sem sair do mês. É o id da semana. */
export const fimDaSemana = (iso: string) => {
  const dow = diaSemana(iso);
  return menor(addDias(iso, dow === 6 ? 6 : 5 - dow), ultimoDia(iso));
};

/** Semana anterior (pode ser do mês anterior). */
export const semanaAnterior = (fim: string) => fimDaSemana(addDias(inicioDaSemana(fim), -1));

/** Rótulo da semana: "01/nov a 06/nov". */
export const rotuloSemana = (fim: string) => {
  const ini = inicioDaSemana(fim);
  return ini === fim ? diaMes(fim) : `${diaMes(ini)} a ${diaMes(fim)}`;
};

/** Dias da semana (1 a 7). */
const diasDaSemana = (fim: string) =>
  Math.round((Date.parse(fim) - Date.parse(inicioDaSemana(fim))) / 86_400_000) + 1;

/** Semanas do mês, pelo último dia de cada uma (a primeira começa no dia 01, a última termina no fim do mês). */
export function semanasDoMes(ano: number, mes: number): string[] {
  const out: string[] = [];
  let d = `${ano}-${String(mes).padStart(2, "0")}-01`;
  const fimMes = ultimoDia(d);
  while (d <= fimMes) {
    const fim = fimDaSemana(d);
    out.push(fim);
    d = addDias(fim, 1);
  }
  return out;
}

/** Prazo para lançar: a segunda-feira depois do último dia da semana. */
export const prazoDaSemana = (fim: string) => addDias(fim, ((1 - diaSemana(fim) + 7) % 7) || 7);

/** A semana já passou do prazo e é cobrada? */
export const semanaCobrada = (fim: string, hoje: string) => hoje > prazoDaSemana(fim);

export const semanaLancada = (s?: MetaSemanal | null) => s?.leads != null && s?.faturamento != null;

export const mesFechadoEm = (ano: number, mes: number, hoje: string) =>
  ano * 12 + mes < Number(hoje.slice(0, 4)) * 12 + Number(hoje.slice(5, 7));

/** Semana que a tela abre por padrão: a última que já terminou no mês, senão a primeira. */
export function semanaPadrao(ano: number, mes: number, hoje: string) {
  const semanas = semanasDoMes(ano, mes);
  const fechadas = semanas.filter((s) => s <= hoje);
  return fechadas[fechadas.length - 1] ?? semanas[0];
}

const pct = (a: number | null, b: number | null) => (a == null || b == null || b <= 0 ? null : (a / b) * 100);

/** Tudo que a tela e o MCP mostram de um cliente no mês. */
export function resumoMeta(meta: MetaMensal | undefined | null, semanas: MetaSemanal[], ano: number, mes: number, hoje: string) {
  const sextas = semanasDoMes(ano, mes);
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
  const diasMes = sextas.reduce((t, s) => t + diasDaSemana(s), 0);
  const fracao = fechado ? 1 : diasMes ? cobradas.reduce((t, s) => t + diasDaSemana(s), 0) / diasMes : 0;
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
