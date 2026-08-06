"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  ClienteView, Pessoa, Squad, MetaEmpresa, MetaSquad, FcaView, HeadcountPlanejado, Cargo,
} from "@/lib/types";
import {
  MESES_LABEL, formatBRL, statusVencimento, diasParaVencimento,
  NIVEL_LABEL, V_LABEL, CARGO_LABEL,
} from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

interface OkrMetricaLite {
  id: string;
  cargo: string;
  nome: string;
  unidade: string;
}
interface OkrMetaLite {
  metrica_id: string;
  nivel: string;
  versao_v: string;
  valor_meta: number | null;
}
interface OkrRealizadoLite {
  pessoa_id: string;
  metrica_id: string;
  valor_realizado: number | null;
}

const CARGOS_OPERACIONAIS: Cargo[] = ["coordenador", "gestor_projetos", "gestor_trafego", "designer"];
const MES_ATUAL = new Date().getMonth() + 1;
const ANO_ATUAL = new Date().getFullYear();

export default function CockpitPage() {
  const supabase = createClient();
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [metasEmpresa, setMetasEmpresa] = useState<MetaEmpresa[]>([]);
  const [metasSquad, setMetasSquad] = useState<MetaSquad[]>([]);
  const [fcas, setFcas] = useState<FcaView[]>([]);
  const [headcount, setHeadcount] = useState<HeadcountPlanejado[]>([]);
  const [okrMetricas, setOkrMetricas] = useState<OkrMetricaLite[]>([]);
  const [okrMetasRegua, setOkrMetasRegua] = useState<OkrMetaLite[]>([]);
  const [okrRealizados, setOkrRealizados] = useState<OkrRealizadoLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [mes, setMes] = useState(MES_ATUAL);
  const [ano, setAno] = useState(ANO_ATUAL);
  const [squadFiltro, setSquadFiltro] = useState<string>("");  // "" = Todos
  const { isGerente, squadId: perfilSquadId } = useUsuarioPerfil();

  // Coordenador/Investidor: força filtro pelo próprio squad
  useEffect(() => {
    if (!isGerente && perfilSquadId) setSquadFiltro(perfilSquadId);
  }, [isGerente, perfilSquadId]);

  async function load() {
    setLoading(true);
    const [
      { data: cs }, { data: ps }, { data: sq },
      { data: me }, { data: ms }, { data: fc }, { data: hc },
      { data: okm }, { data: okr }, { data: okra },
    ] = await Promise.all([
      supabase.from("ruston_clientes_view").select("*").eq("ativo", true),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true),
      supabase.from("ruston_squads").select("*").eq("ativo", true).eq("incluir_em_comparativo", true),
      supabase.from("ruston_metas_empresa").select("*").eq("ano", ano).eq("mes", mes),
      supabase.from("ruston_metas_squad").select("*").eq("ano", ano).eq("mes", mes),
      supabase.from("ruston_fca_view").select("*").eq("ano", ano).eq("mes", mes),
      supabase.from("ruston_headcount_planejado").select("*"),
      supabase.from("ruston_okr_metricas").select("id,cargo,nome,unidade").eq("ativo", true),
      supabase.from("ruston_okr_metas").select("metrica_id,nivel,versao_v,valor_meta").eq("ano", ano).eq("mes", mes),
      supabase.from("ruston_okr_realizado_investidor").select("pessoa_id,metrica_id,valor_realizado").eq("ano", ano).eq("mes", mes),
    ]);
    setClientes((cs as ClienteView[]) ?? []);
    setPessoas((ps as Pessoa[]) ?? []);
    setSquads((sq as Squad[]) ?? []);
    setMetasEmpresa((me as MetaEmpresa[]) ?? []);
    setMetasSquad((ms as MetaSquad[]) ?? []);
    setFcas((fc as FcaView[]) ?? []);
    setHeadcount((hc as HeadcountPlanejado[]) ?? []);
    setOkrMetricas((okm as OkrMetricaLite[]) ?? []);
    setOkrMetasRegua((okr as OkrMetaLite[]) ?? []);
    setOkrRealizados((okra as OkrRealizadoLite[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);

  // ============ Filtragem por squad ============
  const clientesFiltrados = useMemo(() => {
    if (!squadFiltro) return clientes;
    return clientes.filter((c) => c.squad_id === squadFiltro);
  }, [clientes, squadFiltro]);

  const pessoasFiltradas = useMemo(() => {
    if (!squadFiltro) return pessoas;
    return pessoas.filter((p) => p.compartilhado_entre_squads || p.squad_id === squadFiltro);
  }, [pessoas, squadFiltro]);

  const fcasFiltrados = useMemo(() => {
    if (!squadFiltro) return fcas;
    return fcas.filter((f) => f.cliente_squad_id === squadFiltro);
  }, [fcas, squadFiltro]);

  // ============ KPIs derivados ============

  const mrrTotal = useMemo(
    () => clientesFiltrados.reduce((s, c) => s + (Number(c.mrr) || 0), 0),
    [clientesFiltrados]
  );

  const clientesAtivos = clientesFiltrados.length;

  const ticketMedio = clientesAtivos > 0 ? mrrTotal / clientesAtivos : 0;

  const ltvMedio = useMemo(() => {
    const comLT = clientesFiltrados.filter((c) => c.lt_meses != null);
    if (comLT.length === 0) return 0;
    return comLT.reduce((s, c) => s + (c.lt_meses ?? 0) * (Number(c.mrr) || 0), 0) / comLT.length;
  }, [clientes]);

  const ltMedio = useMemo(() => {
    const comLT = clientesFiltrados.filter((c) => c.lt_meses != null);
    if (comLT.length === 0) return null;
    return comLT.reduce((s, c) => s + (c.lt_meses ?? 0), 0) / comLT.length;
  }, [clientes]);

  const custoOperacional = useMemo(() => {
    return pessoasFiltradas.filter((p) => p.ativo).reduce((s, p) => s + (Number(p.salario) || 0), 0);
  }, [pessoasFiltradas]);

  const margemEstimada = mrrTotal - custoOperacional;
  const margemPct = mrrTotal > 0 ? (margemEstimada / mrrTotal) * 100 : 0;

  // FCA médio (só clientes com FCA no mês)
  const fcaMedio = useMemo(() => {
    const comNota = fcasFiltrados.filter((f) => f.nota_final != null);
    if (comNota.length === 0) return null;
    return comNota.reduce((s, f) => s + (f.nota_final ?? 0), 0) / comNota.length;
  }, [fcasFiltrados]);

  // % Metas Empresa batidas
  const metasEmpresaBatidas = useMemo(() => {
    const preenchidas = metasEmpresa.filter((m) => m.valor_realizado != null);
    if (preenchidas.length === 0) return { pct: 0, batidas: 0, total: metasEmpresa.length };
    const batidas = preenchidas.filter((m) => {
      const menorMelhor = m.metrica === "churn";
      return menorMelhor
        ? (m.valor_realizado ?? 0) <= m.valor_meta
        : (m.valor_realizado ?? 0) >= m.valor_meta;
    }).length;
    return { pct: Math.round((batidas / metasEmpresa.length) * 100), batidas, total: metasEmpresa.length };
  }, [metasEmpresa]);

  // Churn % — pega da meta_empresa se preenchido
  const churnAtual = metasEmpresa.find((m) => m.metrica === "churn")?.valor_realizado ?? null;

  // Bandeira FCA — contagem
  const fcaContagem = useMemo(() => {
    const verde = fcasFiltrados.filter((f) => f.bandeira === "verde").length;
    const amarelo = fcasFiltrados.filter((f) => f.bandeira === "amarelo").length;
    const vermelho = fcasFiltrados.filter((f) => f.bandeira === "vermelho").length;
    return { verde, amarelo, vermelho };
  }, [fcasFiltrados]);

  // ============ Alertas críticos ============

  const contratosVencidos = clientesFiltrados.filter((c) => statusVencimento(c.data_vencimento_contrato) === "vencido");
  const contratosCriticos = clientesFiltrados.filter((c) => statusVencimento(c.data_vencimento_contrato) === "critico");
  const contratosAtencao = clientesFiltrados.filter((c) => statusVencimento(c.data_vencimento_contrato) === "atencao");

  const fcaVermelhos = fcasFiltrados.filter((f) => f.bandeira === "vermelho");

  const gapHeadcount = useMemo(() => {
    return squads.flatMap((s) => {
      return CARGOS_OPERACIONAIS.map((c) => {
        const plan = headcount.find((h) => h.squad_id === s.id && h.cargo === c);
        const atual = pessoas.filter((p) => !p.compartilhado_entre_squads && p.squad_id === s.id && p.cargo === c).length;
        const planejado = plan?.quantidade_planejada ?? 0;
        return { squad: s, cargo: c, planejado, atual, gap: atual - planejado };
      }).filter((g) => g.gap < 0);
    });
  }, [squads, pessoas, headcount]);

  const fcasRascunho = fcasFiltrados.filter((f) => f.status !== "validado");

  // ============ Ranking squads ============

  const rankingSquads = useMemo(() => {
    return squads.map((s) => {
      const ms = metasSquad.filter((m) => m.squad_id === s.id);
      const total = ms.length;
      const batidas = ms.filter((m) => {
        if (m.valor_realizado == null) return false;
        const menor = m.metrica === "churn";
        return menor ? m.valor_realizado <= m.valor_meta : m.valor_realizado >= m.valor_meta;
      }).length;
      const pct = total > 0 ? Math.round((batidas / total) * 100) : 0;
      return { squad: s, batidas, total, pct };
    }).sort((a, b) => b.pct - a.pct);
  }, [squads, metasSquad]);

  // ============ Top 3 investidores por cargo ============

  const top3PorCargo = useMemo(() => {
    const cargosComMetricas = Array.from(new Set(okrMetricas.map((m) => m.cargo)));
    return cargosComMetricas.map((cargo) => {
      const metricasCargo = okrMetricas.filter((m) => m.cargo === cargo);
      const pessoasCargo = pessoas.filter(
        (p) => p.cargo === cargo && p.nivel_senioridade && p.nivel_v && p.ativo
      );
      const rank = pessoasCargo.map((p) => {
        let batidas = 0;
        metricasCargo.forEach((m) => {
          const meta = okrMetasRegua.find(
            (r) => r.metrica_id === m.id && r.nivel === p.nivel_senioridade && r.versao_v === p.nivel_v
          );
          const real = okrRealizados.find((r) => r.metrica_id === m.id && r.pessoa_id === p.id);
          if (!meta?.valor_meta || real?.valor_realizado == null) return;
          const menor = m.nome.toLowerCase().includes("churn") || m.nome.toLowerCase().includes("refação");
          if (menor ? real.valor_realizado <= meta.valor_meta : real.valor_realizado >= meta.valor_meta) {
            batidas++;
          }
        });
        const total = metricasCargo.length;
        const pct = total > 0 ? Math.round((batidas / total) * 100) : 0;
        return { pessoa: p, batidas, total, pct };
      }).sort((a, b) => b.pct - a.pct).slice(0, 3);
      return { cargo, top: rank };
    }).filter((c) => c.top.length > 0);
  }, [okrMetricas, okrMetasRegua, okrRealizados, pessoas]);

  // ============ Timeline (últimos 6 meses de MRR — usa clientes atuais como aproximação) ============

  const timelineDados = useMemo(() => {
    // Simplificação: mostra MRR total do mês vs mrr - churn simulado
    const hoje = new Date(ano, mes - 1, 1);
    return Array.from({ length: 6 }, (_, i) => {
      const d = new Date(hoje);
      d.setMonth(d.getMonth() - (5 - i));
      return {
        label: `${MESES_LABEL[d.getMonth()].slice(0, 3)}/${String(d.getFullYear()).slice(-2)}`,
        mes: d.getMonth() + 1,
        ano: d.getFullYear(),
        // Aproximação: usa MRR atual (não temos histórico). Sistema evolui quando o user
        // preencher metas mensais e realizados nos meses passados.
        valor: mrrTotal,
      };
    });
  }, [ano, mes, mrrTotal]);

  const totalAlertas = contratosVencidos.length + contratosCriticos.length
    + fcaVermelhos.length + gapHeadcount.length + fcasRascunho.length;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Cockpit</h1>
          <p className="text-sm text-brand-muted">
            Visão executiva · {MESES_LABEL[mes - 1]}/{ano}
            {squadFiltro && squads.find((s) => s.id === squadFiltro)
              ? ` · ${squads.find((s) => s.id === squadFiltro)?.nome}`
              : isGerente ? " · Unidade completa" : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="input max-w-[180px]"
            value={squadFiltro}
            onChange={(e) => setSquadFiltro(e.target.value)}
            disabled={!isGerente}
            title={!isGerente ? "Você vê apenas o seu squad" : ""}
          >
            {isGerente && <option value="">Unidade completa</option>}
            {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <select className="input max-w-[140px]" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES_LABEL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {[ANO_ATUAL - 1, ANO_ATUAL, ANO_ATUAL + 1].map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {loading && <p className="text-brand-muted">Carregando cockpit...</p>}

      {!loading && (
        <>
          {/* ============ ALERTA GLOBAL ============ */}
          {totalAlertas > 0 && (
            <div className="mb-6 card border border-amber-500/40 bg-amber-500/5">
              <p className="text-[10px] uppercase tracking-wide text-amber-300">Atenção</p>
              <p className="mt-1 text-2xl font-bold text-amber-300">
                {totalAlertas} {totalAlertas === 1 ? "item" : "itens"} precisam da sua atenção
              </p>
            </div>
          )}

          {/* ============ KPIs PRINCIPAIS ============ */}
          <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <KPI label="MRR total" valor={formatBRL(mrrTotal)} cor="text-brand" sublabel={`${clientesAtivos} clientes ativos`} />
            <KPI label="Ticket médio" valor={formatBRL(ticketMedio)} sublabel="MRR ÷ clientes" />
            <KPI
              label="Churn"
              valor={churnAtual != null ? `${churnAtual}%` : "—"}
              cor={churnAtual != null && churnAtual <= 5 ? "text-emerald-300" : "text-red-300"}
              sublabel="meta ≤ 5%"
            />
            <KPI
              label="FCA médio"
              valor={fcaMedio != null ? fcaMedio.toFixed(2) : "—"}
              cor={
                fcaMedio == null ? "text-brand-muted" :
                fcaMedio >= 8 ? "text-emerald-300" :
                fcaMedio >= 6 ? "text-amber-300" :
                "text-red-300"
              }
              sublabel={`${fcaContagem.verde}🟢 ${fcaContagem.amarelo}🟡 ${fcaContagem.vermelho}🔴`}
            />
            <KPI
              label="Metas empresa"
              valor={`${metasEmpresaBatidas.pct}%`}
              cor={metasEmpresaBatidas.pct >= 70 ? "text-emerald-300" : "text-amber-300"}
              sublabel={`${metasEmpresaBatidas.batidas}/${metasEmpresaBatidas.total} batidas`}
            />
            <KPI
              label="Margem estimada"
              valor={formatBRL(margemEstimada)}
              cor={margemEstimada > 0 ? "text-emerald-300" : "text-red-300"}
              sublabel={`${margemPct.toFixed(0)}% · custo ${formatBRL(custoOperacional)}`}
            />
          </div>

          {/* ============ 2 COLUNAS: RANKING SQUADS + LTV ============ */}
          <div className="mb-6 grid grid-cols-1 gap-4 xl:grid-cols-3">
            {/* Ranking rápido de squads */}
            <div className="card xl:col-span-2">
              <p className="mb-3 text-sm font-semibold">🏆 Ranking Squads · {MESES_LABEL[mes - 1]}</p>
              {rankingSquads.length === 0 && <p className="text-xs text-brand-muted">Sem squads.</p>}
              <div className="space-y-2">
                {rankingSquads.map((r, i) => (
                  <div key={r.squad.id} className="flex items-center gap-3">
                    <span className="w-8 text-center text-lg font-bold">
                      {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `${i + 1}º`}
                    </span>
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-lg font-bold text-white text-xs"
                      style={{ backgroundColor: r.squad.cor || "#1a1a1a" }}
                    >
                      {r.squad.nome.charAt(0)}
                    </div>
                    <span className="flex-1 text-sm font-medium">{r.squad.nome}</span>
                    <span className="text-xs text-brand-muted">{r.batidas}/{r.total}</span>
                    <div className="w-32 h-2 rounded-full bg-white/5 overflow-hidden">
                      <div
                        className={`h-full ${r.pct >= 80 ? "bg-emerald-500" : r.pct >= 50 ? "bg-amber-500" : "bg-red-500"}`}
                        style={{ width: `${r.pct}%` }}
                      />
                    </div>
                    <span className="w-12 text-right text-sm font-semibold">{r.pct}%</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Card LTV + info extra */}
            <div className="card">
              <p className="mb-3 text-sm font-semibold">📊 Métricas da carteira</p>
              <div className="space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-brand-muted">LT médio da unidade</p>
                  <p className="text-xl font-bold">
                    {ltMedio != null ? `${ltMedio.toFixed(1)} meses` : "—"}
                  </p>
                  <p className="text-[10px] text-brand-muted">tempo médio de contrato ativo</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-brand-muted">LTV médio estimado</p>
                  <p className="text-xl font-bold">{formatBRL(ltvMedio)}</p>
                  <p className="text-[10px] text-brand-muted">MRR × LT em meses</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-brand-muted">Time total</p>
                  <p className="text-xl font-bold">{pessoas.length} pessoas</p>
                  <p className="text-[10px] text-brand-muted">custo mensal {formatBRL(custoOperacional)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wide text-brand-muted">MRR por pessoa</p>
                  <p className="text-xl font-bold">
                    {pessoas.length > 0 ? formatBRL(mrrTotal / pessoas.length) : "—"}
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* ============ TOP 3 INVESTIDORES POR CADEIRA ============ */}
          {top3PorCargo.length > 0 && (
            <div className="mb-6">
              <p className="mb-3 text-sm font-semibold">🏆 Top 3 investidores por cadeira</p>
              <div className={`grid gap-3 grid-cols-1 md:grid-cols-2 ${top3PorCargo.length >= 3 ? "xl:grid-cols-3" : ""}`}>
                {top3PorCargo.map(({ cargo, top }) => (
                  <div key={cargo} className="card">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-brand">
                      {CARGO_LABEL[cargo as Cargo] ?? cargo}
                    </p>
                    <div className="space-y-2">
                      {top.map((r, i) => (
                        <div key={r.pessoa.id} className="flex items-center gap-2">
                          <span className="w-8 text-center text-lg">
                            {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="truncate text-sm font-medium">{r.pessoa.nome}</p>
                            <p className="text-[10px] text-brand-muted">
                              {r.pessoa.nivel_senioridade ? NIVEL_LABEL[r.pessoa.nivel_senioridade] : "—"} {r.pessoa.nivel_v ? V_LABEL[r.pessoa.nivel_v] : ""}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`text-lg font-bold ${
                              r.pct >= 80 ? "text-emerald-300" :
                              r.pct >= 50 ? "text-amber-300" :
                              "text-red-300"
                            }`}>{r.pct}%</p>
                            <p className="text-[9px] text-brand-muted">{r.batidas}/{r.total}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ============ CENTRAL DE ALERTAS ============ */}
          {totalAlertas > 0 && (
            <div className="mb-6">
              <p className="mb-3 text-sm font-semibold">⚠️ Central de alertas</p>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {contratosVencidos.length > 0 && (
                  <AlertCard
                    titulo="Contratos vencidos"
                    n={contratosVencidos.length}
                    lista={contratosVencidos.map((c) => c.nome)}
                    cor="red"
                    href="/clientes"
                  />
                )}
                {contratosCriticos.length > 0 && (
                  <AlertCard
                    titulo="Vencem em ≤30 dias"
                    n={contratosCriticos.length}
                    lista={contratosCriticos.map((c) => c.nome)}
                    cor="orange"
                    href="/clientes"
                  />
                )}
                {contratosAtencao.length > 0 && (
                  <AlertCard
                    titulo="Vencem em ≤60 dias"
                    n={contratosAtencao.length}
                    lista={contratosAtencao.map((c) => c.nome)}
                    cor="amber"
                    href="/clientes"
                  />
                )}
                {fcaVermelhos.length > 0 && (
                  <AlertCard
                    titulo="FCA vermelho"
                    n={fcaVermelhos.length}
                    lista={fcaVermelhos.map((f) => f.cliente_nome)}
                    cor="red"
                    href="/fca"
                  />
                )}
                {gapHeadcount.length > 0 && (
                  <AlertCard
                    titulo="Vagas em aberto"
                    n={gapHeadcount.reduce((s, g) => s - g.gap, 0)}
                    lista={gapHeadcount.map((g) => `${g.squad.nome} · ${g.cargo} (${-g.gap})`)}
                    cor="amber"
                    href="/headcount"
                  />
                )}
                {fcasRascunho.length > 0 && (
                  <AlertCard
                    titulo="FCAs sem validação"
                    n={fcasRascunho.length}
                    lista={fcasRascunho.map((f) => f.cliente_nome)}
                    cor="amber"
                    href="/fca"
                  />
                )}
              </div>
            </div>
          )}

          {/* ============ TIMELINE ============ */}
          <div className="card">
            <p className="mb-3 text-sm font-semibold">📈 Evolução MRR — últimos 6 meses</p>
            <p className="mb-4 text-[10px] text-brand-muted">
              Como o histórico mensal ainda está sendo populado, esta timeline usa o MRR atual como referência.
              Quando você preencher metas/realizados dos meses passados, ela evolui.
            </p>
            <div className="flex items-end gap-2 h-32">
              {timelineDados.map((d) => (
                <div key={d.label} className="flex flex-1 flex-col items-center gap-2">
                  <div className="w-full flex-1 flex items-end">
                    <div
                      className="w-full bg-brand/60 rounded-t"
                      style={{ height: `${100}%` }}
                      title={formatBRL(d.valor)}
                    />
                  </div>
                  <p className="text-[10px] text-brand-muted">{d.label}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/* ============================== KPI CARD ============================== */

function KPI({ label, valor, cor, sublabel }: {
  label: string; valor: string; cor?: string; sublabel?: string;
}) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${cor ?? "text-white"}`}>{valor}</p>
      {sublabel && <p className="mt-1 text-[10px] text-brand-muted">{sublabel}</p>}
    </div>
  );
}

/* ============================== ALERT CARD ============================== */

function AlertCard({ titulo, n, lista, cor, href }: {
  titulo: string; n: number; lista: string[]; cor: "red" | "orange" | "amber"; href: string;
}) {
  const cores = {
    red:    "border-red-500/40 bg-red-500/5 text-red-300",
    orange: "border-orange-500/40 bg-orange-500/5 text-orange-300",
    amber:  "border-amber-500/40 bg-amber-500/5 text-amber-300",
  };
  return (
    <a href={href} className={`card border ${cores[cor]} hover:brightness-125 transition`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wide opacity-70">{titulo}</p>
          <p className="mt-1 text-2xl font-bold">{n}</p>
        </div>
        <span className="text-xs opacity-50">→</span>
      </div>
      <p className="mt-2 text-[10px] text-brand-muted line-clamp-2">
        {lista.slice(0, 4).join(" · ")}
        {lista.length > 4 ? ` · +${lista.length - 4}` : ""}
      </p>
    </a>
  );
}
