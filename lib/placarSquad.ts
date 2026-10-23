// Placar semanal por squad (0 a 100): disciplina do time + churn, a partir do
// que o sistema já tem. Mesmo cálculo na tela (/placar) e no snapshot semanal
// (/api/placar-snapshot), que guarda o histórico.
import type { SupabaseClient } from "@supabase/supabase-js";
import { squadExcluido, statusCadencia, type ReuniaoStatus } from "@/lib/types";

export type CriterioKey = "fca" | "reunioes" | "pe" | "tarefas" | "whatsapp" | "churn" | "monetizacao" | "indicacoes";

export const CRITERIOS: { key: CriterioKey; label: string; peso: number; regra: string }[] = [
  { key: "fca", label: "FCA preenchido", peso: 15, regra: "% dos clientes com FCA na semana" },
  { key: "reunioes", label: "Reuniões em dia", peso: 10, regra: "% dos clientes com reunião dentro da cadência" },
  { key: "pe", label: "Ponto de Equilíbrio", peso: 10, regra: "% dos clientes com o PE do mês preenchido" },
  { key: "tarefas", label: "Tarefas no prazo", peso: 15, regra: "% das tarefas do eKyte com prazo na semana entregues no prazo" },
  { key: "whatsapp", label: "Atendimento WhatsApp", peso: 10, regra: "% dos clientes sem alerta de demora da Ruston na semana (esperou 30 min ou ficou sem resposta)" },
  { key: "churn", label: "Churn do mês", peso: 20, regra: "0% de MRR em churn = nota cheia; 5% ou mais = zero" },
  { key: "monetizacao", label: "Monetização", peso: 12, regra: "upsell ganho no mês (MRR + one time) ÷ meta do mês proporcional aos dias que já passaram" },
  { key: "indicacoes", label: "Indicações", peso: 8, regra: "indicações do mês (lançadas em Metas) ÷ meta do mês proporcional aos dias que já passaram" },
];

const CHURN_TETO = 0.05;

export interface Pendencia { cliente: string; motivo: string }

export interface PlacarSquad {
  squad_id: string;
  squad_nome: string;
  cor: string | null;
  clientes: number;
  mrr: number;
  nota: number | null;                                 // 0-100 (null = sem cliente)
  criterios: Record<CriterioKey, { pct: number | null; pontos: number | null; detalhe: string }>;
  pendencias: Pendencia[];
}

/** Sexta da última semana FCA já fechada (sábado→sexta). Na sexta o FCA ainda está
 *  sendo preenchido, então a semana fechada é a anterior. */
export function semanaFechada(hoje = new Date()): string {
  const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const volta = (d.getDay() + 2) % 7 || 7; // sáb=1, dom=2 ... qui=6, sex=7
  d.setDate(d.getDate() - volta);
  return iso(d);
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function inicioDaSemana(sexta: string): string {
  const d = new Date(sexta + "T12:00:00");
  d.setDate(d.getDate() - 6);
  return iso(d);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export async function calcularPlacar(supabase: SupabaseClient, sexta: string): Promise<PlacarSquad[]> {
  const sabado = inicioDaSemana(sexta);
  const [ano, mes] = sexta.split("-").map(Number);
  const iniMes = `${sexta.slice(0, 7)}-01`;
  const fimMes = iso(new Date(ano, mes, 0));

  // Metas mensais contam só a parte do mês que já passou até a sexta
  const fracaoMes = Number(sexta.slice(8, 10)) / Number(fimMes.slice(8, 10));

  const [{ data: sq }, { data: cs }, { data: fc }, { data: st }, { data: pe }, { data: tk }, { data: al }, { data: ch }, { data: mm }, { data: mo }, { data: mi }] = await Promise.all([
    supabase.from("ruston_squads").select("id, nome, cor").eq("ativo", true).order("nome"),
    supabase.from("ruston_clientes_view").select("id, nome, mrr, squad_id, ativo, etapa, churn_realizado"),
    supabase.from("ruston_fca_view").select("cliente_id").eq("data_referencia", sexta),
    supabase.from("ruston_reunioes_status").select("*"),
    supabase.from("ruston_cliente_pe_mensal").select("cliente_id").eq("ano", ano).eq("mes", mes),
    supabase.from("ruston_ekyte_tasks_dashboard")
      .select("cliente_id, current_due_date, resolved_date, situation")
      .eq("pessoa_ativa", true).not("cliente_id", "is", null)
      .gte("current_due_date", `${sabado}T00:00:00`).lte("current_due_date", `${sexta}T23:59:59`)
      .limit(20000),
    // Só falha do time: "grupo_mudo" é o cliente que não fala, não conta
    supabase.from("ruston_whatsapp_alertas").select("cliente_id, tipo")
      .in("tipo", ["sla_30min", "ruston_mudo"]).not("cliente_id", "is", null)
      .gte("criado_em", `${sabado}T00:00:00`).lte("criado_em", `${sexta}T23:59:59`),
    supabase.from("ruston_churn_solicitacoes").select("cliente_id, mrr, status")
      .gte("data_solicitacao", iniMes).lte("data_solicitacao", fimMes).neq("status", "revertido"),
    supabase.from("ruston_monetizacao_metas").select("squad_id, valor_meta").eq("ano", ano).eq("mes", mes),
    // Mesma data de referência da tela de Monetização
    supabase.from("ruston_monetizacao_view")
      .select("cliente_squad_id, valor_mrr_estimado, valor_onetime_estimado, data_prevista_fechamento, data_ganho")
      .eq("estagio", "ganho"),
    supabase.from("ruston_metas_squad").select("squad_id, valor_meta, valor_realizado")
      .eq("ano", ano).eq("mes", mes).eq("metrica", "indicacoes"),
  ]);

  const todos = (cs ?? []) as any[];
  const squadDoCliente = Object.fromEntries(todos.map((c) => [c.id, c.squad_id]));
  const nomeDoCliente = Object.fromEntries(todos.map((c) => [c.id, c.nome]));
  const ativos = todos.filter((c) => c.ativo && !c.churn_realizado && c.etapa !== "cancelado" && c.etapa !== "suspenso");
  const comFca = new Set(((fc ?? []) as any[]).map((f) => f.cliente_id));
  const comPe = new Set(((pe ?? []) as any[]).map((p) => p.cliente_id));
  const status = Object.fromEntries(((st ?? []) as ReuniaoStatus[]).map((s) => [s.cliente_id, s]));
  const comAlerta: Record<string, string> = {};
  ((al ?? []) as any[]).forEach((a) => { comAlerta[a.cliente_id] ??= a.tipo; });
  const agora = Date.now();

  // ISSAS fica fora da disputa
  return ((sq ?? []) as any[]).filter((s) => !squadExcluido(s.nome)).map((s) => {
    const cl = ativos.filter((c) => c.squad_id === s.id);
    const ids = new Set(cl.map((c) => c.id));
    const mrr = cl.reduce((a, c) => a + (Number(c.mrr) || 0), 0);
    const pend: Pendencia[] = [];
    const pct = (ok: number, total: number) => (total ? ok / total : null);

    // FCA
    cl.filter((c) => !comFca.has(c.id)).forEach((c) => pend.push({ cliente: c.nome, motivo: "Sem FCA na semana" }));
    const fcaPct = pct(cl.filter((c) => comFca.has(c.id)).length, cl.length);

    // Reuniões
    const emDia = cl.filter((c) => {
      const r = status[c.id];
      const ok = r && ["ok", "proximo"].includes(statusCadencia(r));
      if (!ok) pend.push({ cliente: c.nome, motivo: r?.ultima_reuniao ? `Reunião atrasada (${r.dias_sem_reuniao} dias)` : "Sem reunião registrada" });
      return ok;
    });
    const reuPct = pct(emDia.length, cl.length);

    // Ponto de Equilíbrio do mês
    cl.filter((c) => !comPe.has(c.id)).forEach((c) => pend.push({ cliente: c.nome, motivo: "PE do mês não preenchido" }));
    const pePct = pct(cl.filter((c) => comPe.has(c.id)).length, cl.length);

    // Tarefas com prazo na semana (canceladas e ainda no prazo ficam de fora)
    let noPrazo = 0, atrasadas = 0;
    ((tk ?? []) as any[]).filter((t) => ids.has(t.cliente_id) && t.situation !== 40).forEach((t) => {
      const prazo = new Date(t.current_due_date).getTime();
      if (t.resolved_date) {
        if (new Date(t.resolved_date).getTime() <= prazo + 86399000) noPrazo++; else atrasadas++;
      } else if (prazo < agora) atrasadas++;
    });
    const tarPct = pct(noPrazo, noPrazo + atrasadas);

    // WhatsApp
    cl.filter((c) => comAlerta[c.id]).forEach((c) => pend.push({
      cliente: c.nome,
      motivo: comAlerta[c.id] === "sla_30min" ? "Cliente esperou mais de 30 min no WhatsApp" : "Ruston sem responder no grupo do WhatsApp",
    }));
    const waPct = pct(cl.filter((c) => !comAlerta[c.id]).length, cl.length);

    // Churn do mês (solicitações não revertidas), sobre o MRR atual + o que saiu
    const churns = ((ch ?? []) as any[]).filter((c) => squadDoCliente[c.cliente_id] === s.id);
    const mrrChurn = churns.reduce((a, c) => a + (Number(c.mrr) || 0), 0);
    churns.forEach((c) => pend.push({ cliente: nomeDoCliente[c.cliente_id] ?? "Cliente", motivo: `Pedido de churn no mês (${c.status})` }));
    const churnTaxa = mrr + mrrChurn ? mrrChurn / (mrr + mrrChurn) : 0;
    const churnPct = cl.length || churns.length ? Math.max(0, 1 - churnTaxa / CHURN_TETO) : null;

    // Monetização: ganho no mês até a sexta ÷ meta proporcional
    const metaMon = ((mm ?? []) as any[]).filter((m) => m.squad_id === s.id).reduce((a, m) => a + (Number(m.valor_meta) || 0), 0);
    const ganhoMon = ((mo ?? []) as any[]).filter((o) => {
      const ref = (o.data_prevista_fechamento ?? o.data_ganho ?? "").slice(0, 10);
      return o.cliente_squad_id === s.id && ref >= iniMes && ref <= sexta;
    }).reduce((a, o) => a + (Number(o.valor_mrr_estimado) || 0) + (Number(o.valor_onetime_estimado) || 0), 0);
    const esperadoMon = metaMon * fracaoMes;
    const monPct = esperadoMon > 0 ? Math.min(1, ganhoMon / esperadoMon) : null;

    // Indicações: lançadas na tela de Metas (vazio com meta = zero indicação)
    const ind = ((mi ?? []) as any[]).find((m) => m.squad_id === s.id);
    const metaInd = Number(ind?.valor_meta) || 0;
    const feitasInd = Number(ind?.valor_realizado) || 0;
    const indPct = metaInd > 0 ? Math.min(1, feitasInd / (metaInd * fracaoMes)) : null;

    const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
    const valores: Record<CriterioKey, { pct: number | null; detalhe: string }> = {
      fca: { pct: fcaPct, detalhe: `${cl.filter((c) => comFca.has(c.id)).length} de ${cl.length} clientes` },
      reunioes: { pct: reuPct, detalhe: `${emDia.length} de ${cl.length} clientes` },
      pe: { pct: pePct, detalhe: `${cl.filter((c) => comPe.has(c.id)).length} de ${cl.length} clientes` },
      tarefas: { pct: tarPct, detalhe: noPrazo + atrasadas ? `${noPrazo} de ${noPrazo + atrasadas} no prazo` : "sem tarefa com prazo na semana" },
      whatsapp: { pct: waPct, detalhe: `${cl.filter((c) => comAlerta[c.id]).length} cliente(s) com alerta` },
      churn: { pct: churnPct, detalhe: mrrChurn ? `${brl(mrrChurn)} (${(churnTaxa * 100).toFixed(1)}% do MRR)` : "nenhum pedido no mês" },
      monetizacao: { pct: monPct, detalhe: metaMon ? `${brl(ganhoMon)} de ${brl(esperadoMon)} esperados até aqui (meta ${brl(metaMon)})` : "sem meta de monetização no mês" },
      indicacoes: { pct: indPct, detalhe: metaInd ? `${feitasInd} de ${metaInd} no mês${ind?.valor_realizado == null ? " (não lançado em Metas)" : ""}` : "sem meta de indicações no mês" },
    };

    // Critério sem dado não pune: o peso dele é redistribuído entre os outros
    const comDado = CRITERIOS.filter((c) => valores[c.key].pct != null);
    const pesoTotal = comDado.reduce((a, c) => a + c.peso, 0);
    const criterios = Object.fromEntries(CRITERIOS.map((c) => {
      const v = valores[c.key];
      return [c.key, { ...v, pontos: v.pct == null ? null : Math.round(v.pct * c.peso * 10) / 10 }];
    })) as PlacarSquad["criterios"];
    const nota = cl.length && pesoTotal
      ? Math.round((comDado.reduce((a, c) => a + (valores[c.key].pct ?? 0) * c.peso, 0) / pesoTotal) * 100)
      : null;

    return { squad_id: s.id, squad_nome: s.nome, cor: s.cor, clientes: cl.length, mrr, nota, criterios, pendencias: pend };
  });
}
