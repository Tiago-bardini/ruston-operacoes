// =====================================================================
// REALIZADO AUTOMÁTICO DAS METAS DOS INVESTIDORES
// Algumas métricas da régua já têm o dado dentro do sistema. Aqui o realizado
// do mês é calculado pela carteira de cada investidor:
//   GP → campo GP (account) do cliente · Tráfego → Gestor de Tráfego · Designer → Designer
//
//  - Carteira de clientes com ROI: % da carteira com a aba ROI preenchida no mês
//  - Churn: MRR dos churns confirmados no mês (mês em que o cliente pediu) ÷ MRR da carteira
//  - Clientes em safe: % dos clientes com FCA no mês que tiveram nota final ≥ 9
//  - Respostas CSAT/NPS: pesquisas respondidas ÷ enviadas no mês
//  - CSAT/NPS nota média: média das notas das pesquisas respondidas no mês (escala 0 a 5)
//  - Clientes promotores: % das respostas com nota ≥ 4,5 (equivale a 9-10 no NPS)
//  - Upsell MRR / Onetime: monetizações ganhas no mês
//
// O valor fica gravado em ruston_okr_realizado_investidor com automatico = true.
// Se alguém digitar o valor na mão, vira manual (automatico = false) e o sistema
// não sobrescreve mais, até clicar em "voltar ao automático".
// =====================================================================
import type { SupabaseClient } from "@supabase/supabase-js";

export const SAFE_NOTA_MIN = 9;
const PROMOTOR_NOTA_MIN = 4.5;

const CAMPO_CARTEIRA: Record<string, "account_id" | "gestor_trafego_id" | "designer_id"> = {
  gestor_projetos: "account_id",
  gestor_trafego: "gestor_trafego_id",
  designer: "designer_id",
};

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Métricas (nome normalizado) que o sistema calcula sozinho */
export const METRICAS_AUTOMATICAS: Record<string, string> = {
  "carteira de clientes com roi": "% da carteira com a aba ROI preenchida no mês",
  "churn": "MRR dos churns confirmados no mês ÷ MRR da carteira",
  "clientes em safe": `% dos clientes com FCA no mês com nota final ≥ ${SAFE_NOTA_MIN}`,
  "respostas csat/nps": "pesquisas respondidas ÷ enviadas no mês",
  "csat/nps nota media": "média das notas das pesquisas respondidas no mês (0 a 5)",
  "clientes promotores": "% das respostas com nota ≥ 4,5 (9-10 no NPS)",
  "upsell mrr": "MRR das monetizações ganhas no mês",
  "upsell onetime": "valor pontual das monetizações ganhas no mês",
  "upsell one time": "valor pontual das monetizações ganhas no mês",
};

export function regraAutomatica(nomeMetrica: string): string | null {
  return METRICAS_AUTOMATICAS[norm(nomeMetrica)] ?? null;
}

export type ValorCalculado = { valor: number; detalhe: string };

type Cliente = {
  id: string; mrr: number | null; ativo: boolean; data_churn: string | null; data_assinatura: string | null;
  account_id: string | null; gestor_trafego_id: string | null; designer_id: string | null; squad_id: string | null;
};

const r1 = (n: number) => Math.round(n * 10) / 10;
const r2 = (n: number) => Math.round(n * 100) / 100;
const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });

/* eslint-disable @typescript-eslint/no-explicit-any */
async function carregarBase(supabase: SupabaseClient, ano: number, mes: number) {
  const mm = String(mes).padStart(2, "0");
  const ini = `${ano}-${mm}-01`;
  const fimDate = new Date(ano, mes, 0);
  const fim = `${ano}-${mm}-${String(fimDate.getDate()).padStart(2, "0")}`;
  const proxIni = mes === 12 ? `${ano + 1}-01-01` : `${ano}-${String(mes + 1).padStart(2, "0")}-01`;

  const [{ data: cs }, { data: ch }, { data: roi }, { data: fca }, { data: pq }, { data: mon }] = await Promise.all([
    supabase.from("ruston_clientes")
      .select("id, mrr, ativo, data_churn, data_assinatura, account_id, gestor_trafego_id, designer_id, squad_id"),
    supabase.from("ruston_churn_solicitacoes").select("cliente_id, ano, mes, mrr, status").eq("status", "confirmado"),
    supabase.from("ruston_cliente_roi_mensal").select("cliente_id, dados").eq("ano", ano).eq("mes", mes),
    supabase.from("ruston_fca_view").select("cliente_id, nota_final, data_referencia").eq("ano", ano).eq("mes", mes),
    supabase.from("ruston_pesquisas").select("cliente_id, criada_em, respondida_em, nota, cancelada")
      .eq("cancelada", false).gte("criada_em", ini).lt("criada_em", proxIni),
    supabase.from("ruston_monetizacao_view").select("cliente_id, estagio, data_ganho, valor_mrr_estimado, valor_onetime_estimado")
      .eq("estagio", "ganho").gte("data_ganho", ini).lte("data_ganho", fim),
  ]);

  const churns = (ch ?? []) as { cliente_id: string; ano: number; mes: number; mrr: number | null }[];
  const ref = ano * 12 + mes;
  // Churn confirmado no mês ou depois: o cliente ainda fazia parte da carteira neste mês
  const churnDoMesOuDepois = new Set(churns.filter((c) => c.ano * 12 + c.mes >= ref).map((c) => c.cliente_id));
  const churnDoMes = new Map<string, number | null>();
  churns.filter((c) => c.ano === ano && c.mes === mes).forEach((c) => churnDoMes.set(c.cliente_id, c.mrr));

  // Carteira do mês: ativos hoje + quem saiu neste mês ou depois; não entra quem assinou depois do mês
  const clientes = ((cs ?? []) as Cliente[]).filter((c) => {
    if (c.data_assinatura && c.data_assinatura > fim) return false;
    if (c.ativo) return true;
    if (churnDoMesOuDepois.has(c.id)) return true;
    return !!c.data_churn && c.data_churn >= ini;
  });

  const comRoi = new Set(((roi ?? []) as any[])
    .filter((r) => r.dados && Object.values(r.dados).some((v) => v !== null && v !== "" && v !== 0))
    .map((r) => r.cliente_id as string));

  const fcaPorCliente = new Map<string, number>();
  ((fca ?? []) as any[])
    .sort((a, b) => String(b.data_referencia).localeCompare(String(a.data_referencia)))
    .forEach((f) => { if (f.nota_final != null && !fcaPorCliente.has(f.cliente_id)) fcaPorCliente.set(f.cliente_id, Number(f.nota_final)); });

  return { clientes, churnDoMes, comRoi, fcaPorCliente, pesquisas: (pq ?? []) as any[], monetizacoes: (mon ?? []) as any[] };
}

type Base = Awaited<ReturnType<typeof carregarBase>>;

/** Churn % do MRR de um conjunto de clientes */
function churnDe(carteira: Cliente[], base: Base): ValorCalculado | null {
  if (!carteira.length) return null;
  const mrrBase = carteira.reduce((s, c) => s + Number((base.churnDoMes.has(c.id) ? base.churnDoMes.get(c.id) : null) ?? c.mrr ?? 0), 0);
  if (mrrBase <= 0) return null;
  const saiu = carteira.filter((c) => base.churnDoMes.has(c.id));
  const mrrChurn = saiu.reduce((s, c) => s + Number(base.churnDoMes.get(c.id) ?? c.mrr ?? 0), 0);
  return {
    valor: r2((mrrChurn / mrrBase) * 100),
    detalhe: `${saiu.length} churn(s) · ${brl(mrrChurn)} de ${brl(mrrBase)} de MRR`,
  };
}

function calcularPorCarteira(carteira: Cliente[], base: Base): Record<string, ValorCalculado> {
  const out: Record<string, ValorCalculado> = {};
  if (!carteira.length) return out;
  const ids = new Set(carteira.map((c) => c.id));

  const comRoi = carteira.filter((c) => base.comRoi.has(c.id)).length;
  out["carteira de clientes com roi"] = {
    valor: r1((comRoi / carteira.length) * 100),
    detalhe: `${comRoi} de ${carteira.length} clientes com ROI preenchido`,
  };

  const ch = churnDe(carteira, base);
  if (ch) out["churn"] = ch;

  const notas = carteira.map((c) => base.fcaPorCliente.get(c.id)).filter((n): n is number => n != null);
  if (notas.length) {
    const safe = notas.filter((n) => n >= SAFE_NOTA_MIN).length;
    out["clientes em safe"] = {
      valor: r1((safe / notas.length) * 100),
      detalhe: `${safe} de ${notas.length} clientes com FCA no mês (nota ≥ ${SAFE_NOTA_MIN}) · carteira de ${carteira.length}`,
    };
  }

  const pq = base.pesquisas.filter((p) => ids.has(p.cliente_id));
  const resp = pq.filter((p) => p.respondida_em);
  if (pq.length) {
    out["respostas csat/nps"] = { valor: r1((resp.length / pq.length) * 100), detalhe: `${resp.length} de ${pq.length} pesquisas respondidas` };
  }
  const comNota = resp.filter((p) => p.nota != null).map((p) => Number(p.nota));
  if (comNota.length) {
    out["csat/nps nota media"] = { valor: r2(comNota.reduce((a, b) => a + b, 0) / comNota.length), detalhe: `média de ${comNota.length} resposta(s)` };
    const prom = comNota.filter((n) => n >= PROMOTOR_NOTA_MIN).length;
    out["clientes promotores"] = { valor: r1((prom / comNota.length) * 100), detalhe: `${prom} de ${comNota.length} respostas com nota ≥ 4,5` };
  }

  const mon = base.monetizacoes.filter((m) => ids.has(m.cliente_id));
  const mrrUp = mon.reduce((s, m) => s + Number(m.valor_mrr_estimado ?? 0), 0);
  const oneUp = mon.reduce((s, m) => s + Number(m.valor_onetime_estimado ?? 0), 0);
  out["upsell mrr"] = { valor: r2(mrrUp), detalhe: `${mon.length} monetização(ões) ganha(s) no mês` };
  out["upsell onetime"] = { valor: r2(oneUp), detalhe: `${mon.length} monetização(ões) ganha(s) no mês` };
  out["upsell one time"] = out["upsell onetime"];
  return out;
}

/** Churn real por squad (time/coordenador) e da empresa, pela carteira do squad */
export async function calcularChurnTimes(supabase: SupabaseClient, ano: number, mes: number) {
  const base = await carregarBase(supabase, ano, mes);
  const squads: Record<string, ValorCalculado> = {};
  new Set(base.clientes.map((c) => c.squad_id).filter(Boolean) as string[]).forEach((s) => {
    const v = churnDe(base.clientes.filter((c) => c.squad_id === s), base);
    if (v) squads[s] = v;
  });
  return { empresa: churnDe(base.clientes, base), squads };
}

/** Só calcula (sem gravar): pessoa_id → métrica (nome normalizado) → valor */
export async function calcularRealizadoInvestidores(supabase: SupabaseClient, ano: number, mes: number) {
  const [base, { data: ps }] = await Promise.all([
    carregarBase(supabase, ano, mes),
    supabase.from("ruston_pessoas").select("id, nome, cargo").eq("ativo", true).in("cargo", Object.keys(CAMPO_CARTEIRA)),
  ]);
  return ((ps ?? []) as { id: string; nome: string; cargo: string }[]).map((p) => ({
    pessoa: p,
    valores: calcularPorCarteira(base.clientes.filter((c) => c[CAMPO_CARTEIRA[p.cargo]] === p.id), base),
  }));
}

/** Calcula e grava o realizado automático de todos os investidores no mês. Não mexe no que foi digitado à mão. */
export async function sincronizarRealizadoAutomatico(supabase: SupabaseClient, ano: number, mes: number): Promise<void> {
  const hoje = new Date();
  if (ano * 12 + mes > hoje.getFullYear() * 12 + hoje.getMonth() + 1) return; // mês futuro

  const [base, { data: ps }, { data: mt }, { data: rl, error: errRl }] = await Promise.all([
    carregarBase(supabase, ano, mes),
    supabase.from("ruston_pessoas").select("id, cargo").eq("ativo", true).in("cargo", Object.keys(CAMPO_CARTEIRA)),
    supabase.from("ruston_okr_metricas").select("id, cargo, nome").eq("ativo", true),
    supabase.from("ruston_okr_realizado_investidor").select("id, pessoa_id, metrica_id, valor_realizado, automatico, detalhe_auto")
      .eq("ano", ano).eq("mes", mes),
  ]);
  if (errRl) return; // coluna "automatico" ainda não existe (SQL não rodado)

  const existentes = new Map(((rl ?? []) as any[]).map((r) => [`${r.pessoa_id}|${r.metrica_id}`, r]));
  const metricas = ((mt ?? []) as any[]).filter((m) => METRICAS_AUTOMATICAS[norm(m.nome)]);

  for (const p of (ps ?? []) as { id: string; cargo: string }[]) {
    const campo = CAMPO_CARTEIRA[p.cargo];
    const doCargo = metricas.filter((m) => m.cargo === p.cargo);
    if (!campo || !doCargo.length) continue;
    const valores = calcularPorCarteira(base.clientes.filter((c) => c[campo] === p.id), base);
    for (const m of doCargo) {
      const v = valores[norm(m.nome)];
      if (!v) continue;
      const atual = existentes.get(`${p.id}|${m.id}`);
      if (atual) {
        if (atual.automatico === false && atual.valor_realizado != null) continue; // manual: respeita
        if (atual.automatico && Number(atual.valor_realizado) === v.valor && atual.detalhe_auto === v.detalhe) continue;
        await supabase.from("ruston_okr_realizado_investidor")
          .update({ valor_realizado: v.valor, automatico: true, detalhe_auto: v.detalhe }).eq("id", atual.id);
      } else {
        await supabase.from("ruston_okr_realizado_investidor").insert({
          pessoa_id: p.id, metrica_id: m.id, ano, mes, valor_realizado: v.valor, automatico: true, detalhe_auto: v.detalhe,
        });
      }
    }
  }
}
