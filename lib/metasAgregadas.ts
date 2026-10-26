// Metas de Squad (coordenador) e de Empresa (gerente) calculadas a partir do
// realizado dos investidores. Cada métrica do squad/empresa puxa as métricas
// equivalentes da régua dos investidores:
//  - percentual e nota → média dos investidores que lançaram
//  - reais e quantidade → soma
//  - Cumprimento das OKRs → % das metas dos investidores que bateram
// Sem nenhum investidor lançado, a métrica fica manual (valor atual é mantido).
import type { SupabaseClient } from "@supabase/supabase-js";
import type { UnidadeMeta } from "@/lib/types";

export type ItemCatalogo = { metrica: string; label: string; unidade: UnidadeMeta; valor: number; ordem: number };

export const CATALOGO_EMPRESA: ItemCatalogo[] = [
  { metrica: "churn",                  label: "Churn",                                    unidade: "percentual", valor: 5,     ordem: 1 },
  { metrica: "respostas_pesquisa",     label: "Respostas nas pesquisas de satisfação",    unidade: "percentual", valor: 80,    ordem: 2 },
  { metrica: "nps_medio",              label: "NPS Médio",                                unidade: "nota",       valor: 8.5,   ordem: 3 },
  { metrica: "csat_medio",             label: "CSAT Médio",                               unidade: "nota",       valor: 4,     ordem: 4 },
  { metrica: "clientes_safe",          label: "Clientes em Safe",                         unidade: "percentual", valor: 60,    ordem: 5 },
  { metrica: "clientes_roi_positivo",  label: "Clientes com ROI Positivo",                unidade: "percentual", valor: 50,    ordem: 6 },
  { metrica: "timer",                  label: "Timer",                                    unidade: "percentual", valor: 85,    ordem: 7 },
  { metrica: "upsell_mrr",             label: "Upsell MRR",                               unidade: "reais",      valor: 15000, ordem: 8 },
  { metrica: "upsell_one_time",        label: "Upsell One Time",                          unidade: "reais",      valor: 30000, ordem: 9 },
  { metrica: "indicacoes",             label: "Indicações",                               unidade: "quantidade", valor: 20,    ordem: 10 },
  { metrica: "renovacao_contratos",    label: "Taxa de renovação de contratos",           unidade: "percentual", valor: 80,    ordem: 11 },
  { metrica: "cumprimento_okrs_time",  label: "Cumprimento agregado das OKRs do time",    unidade: "percentual", valor: 70,    ordem: 12 },
];

export const CATALOGO_SQUAD: ItemCatalogo[] = [
  { metrica: "churn",                  label: "Churn",                                    unidade: "percentual", valor: 5,      ordem: 1 },
  { metrica: "respostas_pesquisa",     label: "Respostas nas pesquisas de satisfação",    unidade: "percentual", valor: 80,     ordem: 2 },
  { metrica: "nps_medio",              label: "NPS Médio",                                unidade: "nota",       valor: 8.5,    ordem: 3 },
  { metrica: "csat_medio",             label: "CSAT Médio",                               unidade: "nota",       valor: 4,      ordem: 4 },
  { metrica: "clientes_safe",          label: "Clientes em Safe",                         unidade: "percentual", valor: 60,     ordem: 5 },
  { metrica: "clientes_roi_positivo",  label: "Clientes com ROI Positivo",                unidade: "percentual", valor: 50,     ordem: 6 },
  { metrica: "timer",                  label: "Timer",                                    unidade: "percentual", valor: 85,     ordem: 7 },
  { metrica: "upsell_mrr",             label: "Upsell MRR",                               unidade: "reais",      valor: 7500,   ordem: 8 },
  { metrica: "upsell_one_time",        label: "Upsell One Time",                          unidade: "reais",      valor: 15000,  ordem: 9 },
  { metrica: "indicacoes",             label: "Indicações",                               unidade: "quantidade", valor: 10,     ordem: 10 },
  { metrica: "renovacao_contratos",    label: "Taxa de renovação de contratos",           unidade: "percentual", valor: 80,     ordem: 11 },
  { metrica: "cumprimento_okrs_time",  label: "Cumprimento agregado das OKRs do time",    unidade: "percentual", valor: 70,     ordem: 12 },
  { metrica: "mrr_gerenciado_trio",    label: "MRR gerenciado por trio (por trio)",       unidade: "reais",      valor: 100000, ordem: 13 },
];

/** Métrica de squad/empresa → nomes das métricas dos investidores que a compõem (sem acento, minúsculo) */
export const ORIGEM_INVESTIDOR: Record<string, { nomes: string[]; regra: "media" | "soma" }> = {
  churn:                 { nomes: ["churn"], regra: "media" },
  respostas_pesquisa:    { nomes: ["respostas csat/nps"], regra: "media" },
  // "CSAT/NPS Nota Média" dos investidores vem na escala de 1 a 5, igual ao CSAT. O NPS (0 a 10) segue manual
  csat_medio:            { nomes: ["csat", "csat/nps nota media"], regra: "media" },
  clientes_safe:         { nomes: ["clientes em safe"], regra: "media" },
  clientes_roi_positivo: { nomes: ["carteira de clientes com roi"], regra: "media" },
  timer:                 { nomes: ["timer"], regra: "media" },
  upsell_mrr:            { nomes: ["upsell mrr"], regra: "soma" },
  upsell_one_time:       { nomes: ["upsell onetime", "upsell one time"], regra: "soma" },
  indicacoes:            { nomes: ["indicacao", "indicacoes"], regra: "soma" },
  renovacao_contratos:   { nomes: ["taxa de renovacao de contratos"], regra: "media" },
};
export const METRICA_CUMPRIMENTO = "cumprimento_okrs_time";

/** Texto curto da regra, mostrado na tela */
export function regraAuto(metrica: string): string | null {
  if (metrica === METRICA_CUMPRIMENTO) return "% das metas dos investidores que bateram";
  const o = ORIGEM_INVESTIDOR[metrica];
  if (!o) return null;
  return `${o.regra === "media" ? "média" : "soma"} dos investidores`;
}

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
const menorMelhor = (nome: string) => { const n = norm(nome); return n.includes("churn") || n.includes("refacao"); };

export type ValorAuto = { valor: number; investidores: number };
/** Quantos investidores deveriam lançar cada métrica (cargo tem a métrica na régua) */
export type Esperados = Record<string, number>;
export type ResultadoAgregado = {
  empresa: Record<string, ValorAuto>;
  squads: Record<string, Record<string, ValorAuto>>;
  esperadosEmpresa: Esperados;
  esperadosSquad: Record<string, Esperados>;
};

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function calcularMetasAgregadas(supabase: SupabaseClient, ano: number, mes: number): Promise<ResultadoAgregado> {
  const [{ data: ps }, { data: mt }, { data: rg }, { data: rl }] = await Promise.all([
    supabase.from("ruston_pessoas").select("id, cargo, squad_id, nivel_senioridade, nivel_v").eq("ativo", true),
    supabase.from("ruston_okr_metricas").select("id, cargo, nome").eq("ativo", true),
    supabase.from("ruston_okr_metas").select("metrica_id, nivel, versao_v, valor_meta").eq("ano", ano).eq("mes", mes),
    supabase.from("ruston_okr_realizado_investidor").select("pessoa_id, metrica_id, valor_realizado")
      .eq("ano", ano).eq("mes", mes).not("valor_realizado", "is", null),
  ]);
  const pessoas = new Map(((ps ?? []) as any[]).map((p) => [p.id, p]));
  const metricas = new Map(((mt ?? []) as any[]).map((m) => [m.id, m]));
  const regua = (rg ?? []) as any[];

  // Uma linha por lançamento do investidor, já com squad, métrica e se bateu
  const linhas = ((rl ?? []) as any[]).flatMap((r) => {
    const p = pessoas.get(r.pessoa_id);
    const m = metricas.get(r.metrica_id);
    if (!p || !m) return [];
    const meta = regua.find((g) => g.metrica_id === m.id && g.nivel === p.nivel_senioridade && g.versao_v === p.nivel_v)?.valor_meta;
    const valor = Number(r.valor_realizado);
    const bateu = meta ? (menorMelhor(m.nome) ? valor <= Number(meta) : valor >= Number(meta)) : null;
    return [{ pessoa: p.id, squad: p.squad_id as string | null, nome: norm(m.nome), valor, bateu }];
  });

  function agregar(l: typeof linhas): Record<string, ValorAuto> {
    const out: Record<string, ValorAuto> = {};
    for (const [metrica, o] of Object.entries(ORIGEM_INVESTIDOR)) {
      const v = l.filter((x) => o.nomes.includes(x.nome));
      if (!v.length) continue;
      const soma = v.reduce((a, x) => a + x.valor, 0);
      out[metrica] = {
        valor: Math.round((o.regra === "media" ? soma / v.length : soma) * 100) / 100,
        investidores: new Set(v.map((x) => x.pessoa)).size,
      };
    }
    const comMeta = l.filter((x) => x.bateu != null);
    if (comMeta.length) {
      out[METRICA_CUMPRIMENTO] = {
        valor: Math.round((comMeta.filter((x) => x.bateu).length / comMeta.length) * 1000) / 10,
        investidores: new Set(comMeta.map((x) => x.pessoa)).size,
      };
    }
    return out;
  }

  const squads: Record<string, Record<string, ValorAuto>> = {};
  new Set(linhas.map((x) => x.squad).filter(Boolean) as string[]).forEach((s) => {
    squads[s] = agregar(linhas.filter((x) => x.squad === s));
  });

  // Investidores esperados por métrica: pessoas ativas cujo cargo tem a métrica na régua
  const nomesPorCargo = new Map<string, Set<string>>();
  metricas.forEach((m: any) => {
    if (!nomesPorCargo.has(m.cargo)) nomesPorCargo.set(m.cargo, new Set());
    nomesPorCargo.get(m.cargo)!.add(norm(m.nome));
  });
  function esperados(lista: any[]): Esperados {
    const out: Esperados = {};
    for (const [metrica, o] of Object.entries(ORIGEM_INVESTIDOR)) {
      const n = lista.filter((p) => o.nomes.some((x) => nomesPorCargo.get(p.cargo)?.has(x))).length;
      if (n) out[metrica] = n;
    }
    const comRegua = lista.filter((p) => nomesPorCargo.has(p.cargo)).length;
    if (comRegua) out[METRICA_CUMPRIMENTO] = comRegua;
    return out;
  }
  const todas = Array.from(pessoas.values());
  const esperadosSquad: Record<string, Esperados> = {};
  new Set(todas.map((p: any) => p.squad_id).filter(Boolean) as string[]).forEach((s) => {
    esperadosSquad[s] = esperados(todas.filter((p: any) => p.squad_id === s));
  });
  return { empresa: agregar(linhas), squads, esperadosEmpresa: esperados(todas), esperadosSquad };
}

/** Grava o realizado automático nas metas de Squad e Empresa do mês (cria as linhas que faltarem). */
export async function sincronizarMetasAgregadas(supabase: SupabaseClient, ano: number, mes: number): Promise<ResultadoAgregado> {
  const res = await calcularMetasAgregadas(supabase, ano, mes);

  async function gravar(tabela: string, catalogo: ItemCatalogo[], valores: Record<string, ValorAuto>, squadId?: string) {
    if (!Object.keys(valores).length) return;
    let q = supabase.from(tabela).select("id, metrica, valor_realizado").eq("ano", ano).eq("mes", mes);
    if (squadId) q = q.eq("squad_id", squadId);
    const { data } = await q;
    const existentes = new Map(((data ?? []) as any[]).map((r) => [r.metrica, r]));
    for (const [metrica, v] of Object.entries(valores)) {
      const atual = existentes.get(metrica);
      if (atual) {
        if (Number(atual.valor_realizado) !== v.valor || atual.valor_realizado == null) {
          await supabase.from(tabela).update({ valor_realizado: v.valor }).eq("id", atual.id);
        }
      } else {
        const c = catalogo.find((x) => x.metrica === metrica);
        if (!c) continue;
        await supabase.from(tabela).insert({
          ...(squadId ? { squad_id: squadId } : {}), ano, mes,
          metrica: c.metrica, metrica_label: c.label, unidade: c.unidade, valor_meta: c.valor, ordem: c.ordem,
          valor_realizado: v.valor,
        });
      }
    }
  }

  await gravar("ruston_metas_empresa", CATALOGO_EMPRESA, res.empresa);
  for (const [squadId, valores] of Object.entries(res.squads)) {
    await gravar("ruston_metas_squad", CATALOGO_SQUAD, valores, squadId);
  }
  return res;
}
