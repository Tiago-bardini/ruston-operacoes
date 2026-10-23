// Planejamento do cliente: Ponto de Equilíbrio + Forecasting (planilha Farol BI).
// O banco guarda só o que o GP preenche; todas as fórmulas ficam aqui, então
// qualquer ajuste vale na hora pra todos os clientes. Percentuais são guardados
// "inteiros" (10 = 10%).

/* ================= PONTO DE EQUILÍBRIO ================= */

export type CustoVarPeKey = "pct_frete" | "pct_impostos" | "pct_custo_produto" | "pct_gateway" | "pct_comissao" | "pct_outros_var";
export type CustoFixoPeKey = "fee_v4" | "ferramentas" | "equipe_vendas" | "outros_fixos";

export interface PontoEquilibrioInput {
  produto: string;
  periodo: string;
  faturamento: number | null;
  qtd_vendas: number | null;
  pct_frete: number;
  pct_impostos: number;
  pct_custo_produto: number;
  pct_gateway: number;
  pct_comissao: number;
  pct_outros_var: number;
  // null = usa o MRR do cliente cadastrado na Carteira
  fee_v4: number | null;
  ferramentas: number | null;
  equipe_vendas: number | null;
  outros_fixos: number | null;
  pct_cac_alvo: number;
  pct_cac_aceitavel: number;
  // CAC já mapeado (R$). Vazio = calcula pelo % da margem de contribuição
  cac_alvo_valor: number | null;
}

export const PE_PADRAO: PontoEquilibrioInput = {
  produto: "",
  periodo: "Último mês",
  faturamento: null,
  qtd_vendas: null,
  pct_frete: 0,
  pct_impostos: 10,
  pct_custo_produto: 40,
  pct_gateway: 3.99,
  pct_comissao: 20,
  pct_outros_var: 0,
  fee_v4: null,
  ferramentas: null,
  equipe_vendas: null,
  outros_fixos: null,
  pct_cac_alvo: 40,
  pct_cac_aceitavel: 55,
  cac_alvo_valor: null,
};

export const CUSTOS_VAR_PE: { key: CustoVarPeKey; label: string; dica: string }[] = [
  { key: "pct_frete", label: "Frete de entrega", dica: "Frete pago no mês ÷ faturamento do mesmo período" },
  { key: "pct_impostos", label: "Impostos", dica: "Alíquota atual — pedir ao escritório de contabilidade" },
  { key: "pct_custo_produto", label: "Custo do produto/serviço", dica: "Quanto custa comprar ou produzir o que é vendido" },
  { key: "pct_gateway", label: "Gateway / Taxa transação / Marketplace", dica: "Consultar na plataforma utilizada" },
  { key: "pct_comissao", label: "Comissão de vendas", dica: "O que foi definido com os vendedores" },
  { key: "pct_outros_var", label: "Outros", dica: "Demais gastos variáveis não listados" },
];

export const CUSTOS_FIXOS_PE: { key: CustoFixoPeKey; label: string; dica: string }[] = [
  { key: "fee_v4", label: "Fee V4 Company", dica: "Custo da operação V4 (sem mídia). Vazio = MRR do cliente" },
  { key: "ferramentas", label: "Ferramentas", dica: "CRM, e-mail marketing, chatbot etc." },
  { key: "equipe_vendas", label: "Equipe de vendas (salário base)", dica: "Soma do salário base dos vendedores" },
  { key: "outros_fixos", label: "Outros", dica: "Demais custos fixos do projeto" },
];

export interface CenarioPe {
  cac: number;
  vendas: number | null;      // breakeven nº de vendas (null = margem não cobre o CAC)
  faturamento: number | null;
  custosVariaveis: number | null;
  midia: number | null;
  roas: number | null;
  roi: number | null;
  lucro: number | null;
}

const div = (a: number, b: number) => (b ? a / b : null);

export function calcularPontoEquilibrio(i: PontoEquilibrioInput, mrrCliente: number) {
  const ticket = i.faturamento && i.qtd_vendas ? i.faturamento / i.qtd_vendas : 0;
  const variaveis = CUSTOS_VAR_PE.map((c) => ({ ...c, valor: (ticket * (i[c.key] || 0)) / 100 }));
  const custoVariavel = variaveis.reduce((s, c) => s + c.valor, 0);
  const margem = ticket - custoVariavel;
  const margemPct = div(margem, ticket);
  const fixos = CUSTOS_FIXOS_PE.map((c) => ({
    ...c,
    valor: c.key === "fee_v4" ? (i.fee_v4 ?? mrrCliente) : (i[c.key] ?? 0),
  }));
  const custoFixo = fixos.reduce((s, c) => s + c.valor, 0);

  function cenario(cac: number): CenarioPe {
    const folga = margem - cac;
    const vendas = folga > 0 ? custoFixo / folga : null;
    if (vendas == null) {
      return { cac, vendas: null, faturamento: null, custosVariaveis: null, midia: null, roas: null, roi: null, lucro: null };
    }
    const faturamento = vendas * ticket;
    const custosVariaveis = vendas * custoVariavel;
    const midia = cac * vendas;
    return {
      cac, vendas, faturamento, custosVariaveis, midia,
      roas: div(faturamento, midia),
      roi: div(vendas * margem, midia),
      lucro: faturamento - custoFixo - custosVariaveis - midia,
    };
  }

  return {
    ticket, variaveis, custoVariavel, margem, margemPct, fixos, custoFixo,
    alvo: cenario(i.cac_alvo_valor ?? (margem * i.pct_cac_alvo) / 100),
    aceitavel: cenario((margem * i.pct_cac_aceitavel) / 100),
    stopLoss: margem,
  };
}

/* ================= FORECASTING ================= */

export type CustoFixoFcKey = "v4" | "hospedagem" | "equipe_dev" | "equipe_comercial" | "aluguel" | "ferramentas" | "outros";
export type CustoVarFcKey = "pct_hospedagem" | "pct_imposto" | "pct_materia_prima" | "pct_gateway" | "pct_comissao";

export interface ForecastInput {
  mes_inicio: string;          // "YYYY-MM" — 1º mês projetado (o mês base é o anterior)
  meses: number;               // 12 ou 24
  intervalo_meses: number;     // de quantos em quantos meses cresce o investimento / cai o ROAS
  investimento: number | null;
  cresc_invest_pct: number;
  roas: number | null;
  perda_roas_inicial_pct: number;
  perda_roas_pct: number;
  pedidos: number | null;
  produtos: number | null;
  receita: number | null;
  taxa_retorno_pct: number;
  pct_hospedagem: number;
  pct_imposto: number;
  pct_materia_prima: number;
  pct_gateway: number;
  gateway_por_item: number;
  pct_comissao: number;
  // Custo fixo do mês base. v4 null = MRR do cliente
  fixos: Record<CustoFixoFcKey, number | null>;
  // Ajustes mês a mês (chave = nº do mês projetado, 1..N). Sem ajuste = regra padrão
  ajuste_cresc_invest: Record<string, number>;
  ajuste_perda_roas: Record<string, number>;
  ajuste_fixos: Partial<Record<CustoFixoFcKey, Record<string, number>>>;
}

function proximoMes(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function forecastPadrao(): ForecastInput {
  return {
    mes_inicio: proximoMes(),
    meses: 12,
    intervalo_meses: 3,
    investimento: null,
    cresc_invest_pct: 10,
    roas: null,
    perda_roas_inicial_pct: 30,
    perda_roas_pct: 2,
    pedidos: null,
    produtos: null,
    receita: null,
    taxa_retorno_pct: 0,
    pct_hospedagem: 5,
    pct_imposto: 10,
    pct_materia_prima: 0,
    pct_gateway: 3.99,
    gateway_por_item: 0.5,
    pct_comissao: 10,
    fixos: { v4: null, hospedagem: null, equipe_dev: null, equipe_comercial: null, aluguel: null, ferramentas: null, outros: null },
    ajuste_cresc_invest: {},
    ajuste_perda_roas: {},
    ajuste_fixos: {},
  };
}

export const CUSTOS_FIXOS_FC: { key: CustoFixoFcKey; label: string }[] = [
  { key: "v4", label: "Fee V4" },
  { key: "hospedagem", label: "Hospedagem" },
  { key: "equipe_dev", label: "Equipe de desenvolvimento" },
  { key: "equipe_comercial", label: "Equipe comercial" },
  { key: "aluguel", label: "Aluguel" },
  { key: "ferramentas", label: "Ferramentas" },
  { key: "outros", label: "Outros gastos" },
];

export const CUSTOS_VAR_FC: { key: CustoVarFcKey; label: string }[] = [
  { key: "pct_hospedagem", label: "Hospedagem" },
  { key: "pct_imposto", label: "Imposto" },
  { key: "pct_materia_prima", label: "Matéria-prima / Custo produto" },
  { key: "pct_gateway", label: "Gateway / Taxa transação / Mkt place" },
  { key: "pct_comissao", label: "Comissão" },
];

export interface ColunaForecast {
  mes: number;                 // 0 = mês base
  ano: number;
  mesCalendario: number;       // 1..12
  investimento: number;
  crescInvestPct: number | null;
  roas: number;
  perdaRoasPct: number | null;
  pedidos: number;
  produtos: number;
  receitaNovos: number;
  receitaTotal: number;
  ticket: number;
  variaveis: Record<CustoVarFcKey, number>;
  custoVariavel: number;
  margem: number;
  margemPct: number | null;
  fixos: Record<CustoFixoFcKey, number>;
  custoFixo: number;
  ebitda: number;
  ebitdaPct: number | null;
}

export function calcularForecast(i: ForecastInput, mrrCliente: number): ColunaForecast[] {
  const [anoIni, mesIni] = i.mes_inicio.split("-").map(Number);
  const intervalo = Math.max(1, i.intervalo_meses || 3);
  const pedidosBase = i.pedidos ?? 0;
  const receitaBase = i.receita ?? 0;
  const ticket = pedidosBase ? receitaBase / pedidosBase : 0;
  const itensPorPedido = pedidosBase ? (i.produtos ?? 0) / pedidosBase : 0;
  const trimestral = (m: number) => m > 1 && (m - 1) % intervalo === 0;

  function custos(novos: number, total: number, produtos: number) {
    const v: Record<CustoVarFcKey, number> = {
      pct_hospedagem: (novos * i.pct_hospedagem) / 100,
      pct_imposto: (total * i.pct_imposto) / 100,
      pct_materia_prima: (total * i.pct_materia_prima) / 100,
      pct_gateway: (total * i.pct_gateway) / 100 + produtos * (i.gateway_por_item || 0),
      pct_comissao: (total * i.pct_comissao) / 100,
    };
    return { v, soma: Object.values(v).reduce((s, x) => s + x, 0) };
  }

  function fechar(c: Omit<ColunaForecast, "variaveis" | "custoVariavel" | "margem" | "margemPct" | "custoFixo" | "ebitda" | "ebitdaPct">): ColunaForecast {
    const { v, soma } = custos(c.receitaNovos, c.receitaTotal, c.produtos);
    const custoFixo = Object.values(c.fixos).reduce((s, x) => s + x, 0);
    const margem = c.receitaTotal - soma;
    const ebitda = c.receitaTotal - soma - custoFixo - c.investimento;
    return {
      ...c, variaveis: v, custoVariavel: soma, margem, custoFixo, ebitda,
      margemPct: div(margem, c.receitaTotal),
      ebitdaPct: div(ebitda, c.receitaTotal),
    };
  }

  const fixosBase = Object.fromEntries(
    CUSTOS_FIXOS_FC.map(({ key }) => [key, key === "v4" ? (i.fixos.v4 ?? mrrCliente) : (i.fixos[key] ?? 0)])
  ) as Record<CustoFixoFcKey, number>;

  const dataBase = new Date(anoIni, mesIni - 2, 1);
  const colunas: ColunaForecast[] = [fechar({
    mes: 0, ano: dataBase.getFullYear(), mesCalendario: dataBase.getMonth() + 1,
    investimento: i.investimento ?? 0, crescInvestPct: null,
    roas: i.roas ?? 0, perdaRoasPct: null,
    pedidos: pedidosBase, produtos: i.produtos ?? 0,
    receitaNovos: receitaBase, receitaTotal: receitaBase, ticket,
    fixos: fixosBase,
  })];

  for (let m = 1; m <= i.meses; m++) {
    const ant = colunas[m - 1];
    const d = new Date(anoIni, mesIni - 1 + (m - 1), 1);
    const crescInvestPct = i.ajuste_cresc_invest[m] ?? (trimestral(m) ? i.cresc_invest_pct : 0);
    const perdaRoasPct = i.ajuste_perda_roas[m]
      ?? (m === 1 ? i.perda_roas_inicial_pct : trimestral(m) ? i.perda_roas_pct : 0);
    const investimento = ant.investimento * (1 + crescInvestPct / 100);
    const roas = ant.roas * (1 - perdaRoasPct / 100);
    const receitaNovos = roas * investimento;
    const pedidos = ticket ? receitaNovos / ticket : 0;
    const fixos = Object.fromEntries(
      CUSTOS_FIXOS_FC.map(({ key }) => [key, i.ajuste_fixos[key]?.[m] ?? ant.fixos[key]])
    ) as Record<CustoFixoFcKey, number>;
    colunas.push(fechar({
      mes: m, ano: d.getFullYear(), mesCalendario: d.getMonth() + 1,
      investimento, crescInvestPct, roas, perdaRoasPct,
      pedidos, produtos: pedidos * itensPorPedido,
      receitaNovos, receitaTotal: receitaNovos + (ant.receitaNovos * i.taxa_retorno_pct) / 100,
      ticket, fixos,
    }));
  }
  return colunas;
}

/* ================= HELPERS ================= */

export interface PlanejamentoCliente {
  cliente_id: string;
  ponto_equilibrio: Partial<PontoEquilibrioInput>;
  forecast: Partial<ForecastInput>;
  updated_at: string | null;
}

// Junta o que foi salvo com o modelo padrão — campo novo no modelo aparece
// automaticamente em clientes que já tinham planejamento salvo.
export function comPadraoPe(salvo?: Partial<PontoEquilibrioInput>): PontoEquilibrioInput {
  return { ...PE_PADRAO, ...(salvo ?? {}) };
}

export function comPadraoForecast(salvo?: Partial<ForecastInput>): ForecastInput {
  const p = forecastPadrao();
  return {
    ...p, ...(salvo ?? {}),
    fixos: { ...p.fixos, ...(salvo?.fixos ?? {}) },
    ajuste_cresc_invest: { ...(salvo?.ajuste_cresc_invest ?? {}) },
    ajuste_perda_roas: { ...(salvo?.ajuste_perda_roas ?? {}) },
    ajuste_fixos: { ...(salvo?.ajuste_fixos ?? {}) },
  };
}

export function formatNum(v: number | null | undefined, casas = 0): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
}

export function formatPct(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
}
