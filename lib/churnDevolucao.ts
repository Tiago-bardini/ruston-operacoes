// Devolução de dinheiro no churn, com parcelamento (migration 045).
// Sem parcelamento (parcelas = 1, sem início), o valor inteiro cai no mês da
// solicitação, como antes. Parcelado, cada mês recebe a sua parcela no churn.

export type ChurnDevolucaoInfo = {
  ano: number; mes: number; mrr: number | null; status: string;
  valor_devolucao?: number | null;
  devolucao_parcelas?: number | null;
  devolucao_inicio?: string | null; // YYYY-MM-DD (dia 1 do mês da 1ª parcela)
};

const idx = (ano: number, mes: number) => ano * 12 + (mes - 1);

export function parcelasDe(s: ChurnDevolucaoInfo): number {
  return Math.max(1, Math.round(Number(s.devolucao_parcelas || 1)));
}

export function inicioDevolucao(s: ChurnDevolucaoInfo): { ano: number; mes: number } {
  if (s.devolucao_inicio) {
    const [a, m] = s.devolucao_inicio.split("-").map(Number);
    if (a && m) return { ano: a, mes: m };
  }
  return { ano: s.ano, mes: s.mes };
}

/** Qual parcela cai neste mês (1..n), ou null se nenhuma */
export function parcelaNoMes(s: ChurnDevolucaoInfo, ano: number, mes: number): { numero: number; de: number; valor: number } | null {
  const total = Number(s.valor_devolucao || 0);
  if (total <= 0) return null;
  const n = parcelasDe(s);
  const ini = inicioDevolucao(s);
  const i = idx(ano, mes) - idx(ini.ano, ini.mes);
  if (i < 0 || i >= n) return null;
  const parcela = Math.round((total / n) * 100) / 100;
  // A última parcela absorve o arredondamento
  const valor = i === n - 1 ? Math.round((total - parcela * (n - 1)) * 100) / 100 : parcela;
  return { numero: i + 1, de: n, valor };
}

export function devolucaoNoMes(s: ChurnDevolucaoInfo, ano: number, mes: number): number {
  return parcelaNoMes(s, ano, mes)?.valor ?? 0;
}

/** MRR conta só no mês da solicitação; a devolução conta pela parcela do mês */
export function mrrNoMes(s: ChurnDevolucaoInfo, ano: number, mes: number): number {
  return s.ano === ano && s.mes === mes ? Number(s.mrr || 0) : 0;
}

export function valorChurnNoMes(s: ChurnDevolucaoInfo, ano: number, mes: number): number {
  return mrrNoMes(s, ano, mes) + devolucaoNoMes(s, ano, mes);
}

/** A solicitação pesa no churn deste mês? (pedida no mês ou com parcela caindo nele) */
export function contaNoMes(s: ChurnDevolucaoInfo, ano: number, mes: number): boolean {
  return (s.ano === ano && s.mes === mes) || devolucaoNoMes(s, ano, mes) > 0;
}

/** Junta listas sem repetir a mesma solicitação */
export function unirPorId<T extends { id?: string }>(...listas: T[][]): T[] {
  const m = new Map<string, T>();
  listas.flat().forEach((x, i) => m.set(x.id ?? `_${i}`, x));
  return Array.from(m.values());
}
