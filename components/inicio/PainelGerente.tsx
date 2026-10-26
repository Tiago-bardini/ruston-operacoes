"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClienteView, Pessoa, Squad, HeadcountPlanejado, ReuniaoStatus, Cargo } from "@/lib/types";
import { formatBRL, formatDate, MESES_LABEL, CARGO_LABEL, diasParaVencimento, squadExcluido } from "@/lib/types";
import { avaliarRiscoChurn, carregarDadosRadar, type AvaliacaoRisco, type DadosClienteRadar } from "@/lib/radarChurn";
import { calcularPlacar, semanaFechada, inicioDaSemana, type PlacarSquad } from "@/lib/placarSquad";

// Painel do Gerente: "a operação está saudável e onde eu preciso agir esta semana?"
// Todas as contas seguem as telas de origem (Churn, Monetização, Placar, Radar, Headcount).

type ChurnSol = { cliente_id: string; ano: number; mes: number; status: string; mrr: number; data_solicitacao: string; cliente: { squad_id: string | null } | null };
type MonetMeta = { squad_id: string; valor_meta: number };
type MonetOp = {
  cliente_squad_id: string | null; estagio: string; valor_mrr_estimado: number; valor_onetime_estimado: number;
  data_ganho: string | null; data_prevista_fechamento: string | null;
};
type ForecastLite = { ano: number; mes: number; meta_mrr: number | null; mrr_realizado: number | null; mrr_total_snapshot: number | null };
type FcaLite = { cliente_squad_id: string | null; nota_final: number | null };
type PlacarHist = { semana: string; nota: number | null };
type OkrMetrica = { id: string; cargo: string; nome: string };
type OkrMeta = { metrica_id: string; nivel: string; versao_v: string; valor_meta: number | null; ano: number; mes: number };
type OkrReal = { pessoa_id: string; metrica_id: string; valor_realizado: number | null; ano: number; mes: number };

const CARGOS_OPERACIONAIS: Cargo[] = ["coordenador", "gestor_projetos", "gestor_trafego", "designer"];
const chave = (a: number, m: number) => a * 12 + m;

function mesesAtras(n: number) {
  const h = new Date();
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(h.getFullYear(), h.getMonth() - (n - 1 - i), 1);
    return { ano: d.getFullYear(), mes: d.getMonth() + 1 };
  });
}

const pctFmt = (v: number | null, casas = 1) =>
  v == null ? "—" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}%`;

export default function PainelGerente() {
  const supabase = createClient();
  const hoje = new Date();
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth() + 1;
  const meses6 = useMemo(() => mesesAtras(6), []);

  const [loading, setLoading] = useState(true);
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [headcount, setHeadcount] = useState<HeadcountPlanejado[]>([]);
  const [churnSol, setChurnSol] = useState<ChurnSol[]>([]);
  const [bases, setBases] = useState<{ ano: number; mes: number; mrr_base: number }[]>([]);
  const [forecast, setForecast] = useState<ForecastLite[]>([]);
  const [monetMetas, setMonetMetas] = useState<MonetMeta[]>([]);
  const [monetOps, setMonetOps] = useState<MonetOp[]>([]);
  const [fcas, setFcas] = useState<FcaLite[]>([]);
  const [reunioes, setReunioes] = useState<ReuniaoStatus[]>([]);
  const [riscos, setRiscos] = useState<(DadosClienteRadar & { av: AvaliacaoRisco })[]>([]);
  const [placar, setPlacar] = useState<PlacarSquad[]>([]);
  const [placarHist, setPlacarHist] = useState<PlacarHist[]>([]);
  const [okrMetricas, setOkrMetricas] = useState<OkrMetrica[]>([]);
  const [okrMetas, setOkrMetas] = useState<OkrMeta[]>([]);
  const [okrReal, setOkrReal] = useState<OkrReal[]>([]);
  const semana = semanaFechada();

  useEffect(() => {
    async function load() {
      setLoading(true);
      const ini = meses6[0];
      const ini6 = `${ini.ano}-${String(ini.mes).padStart(2, "0")}-01`;
      const ini3 = meses6[3];
      const [
        { data: cs }, { data: ps }, { data: sq }, { data: hc }, { data: ch }, { data: bs }, { data: fc },
        { data: mm }, { data: mo }, { data: fa }, { data: rs }, dadosRadar, pl, { data: ph },
        { data: okm }, { data: okt }, { data: okr },
      ] = await Promise.all([
        supabase.from("ruston_clientes_view").select("*").eq("ativo", true),
        supabase.from("ruston_pessoas").select("*").eq("ativo", true),
        supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
        supabase.from("ruston_headcount_planejado").select("*"),
        supabase.from("ruston_churn_solicitacoes").select("cliente_id,ano,mes,status,mrr,data_solicitacao,cliente:ruston_clientes(squad_id)").gte("data_solicitacao", ini6),
        supabase.from("ruston_churn_mrr_base").select("ano,mes,mrr_base"),
        supabase.from("ruston_forecast").select("ano,mes,meta_mrr,mrr_realizado,mrr_total_snapshot"),
        supabase.from("ruston_monetizacao_metas").select("squad_id,valor_meta").eq("ano", ano).eq("mes", mes),
        supabase.from("ruston_monetizacao_view").select("cliente_squad_id,estagio,valor_mrr_estimado,valor_onetime_estimado,data_ganho,data_prevista_fechamento").eq("ativo", true),
        supabase.from("ruston_fca_view").select("cliente_squad_id,nota_final").eq("ano", ano).eq("mes", mes),
        supabase.from("ruston_reunioes_status").select("*"),
        carregarDadosRadar(supabase),
        calcularPlacar(supabase, semana),
        supabase.from("ruston_placar_squad").select("semana,nota").gte("semana", ini6),
        supabase.from("ruston_okr_metricas").select("id,cargo,nome").eq("ativo", true),
        supabase.from("ruston_okr_metas").select("metrica_id,nivel,versao_v,valor_meta,ano,mes").gte("ano", ini3.ano),
        supabase.from("ruston_okr_realizado_investidor").select("pessoa_id,metrica_id,valor_realizado,ano,mes").gte("ano", ini3.ano),
      ]);
      setClientes((cs as ClienteView[]) ?? []);
      setPessoas((ps as Pessoa[]) ?? []);
      setSquads((sq as Squad[]) ?? []);
      setHeadcount((hc as HeadcountPlanejado[]) ?? []);
      setChurnSol((ch as unknown as ChurnSol[]) ?? []);
      setBases(((bs ?? []) as { ano: number; mes: number; mrr_base: number }[]).map((b) => ({ ...b, mrr_base: Number(b.mrr_base) })));
      setForecast((fc as ForecastLite[]) ?? []);
      setMonetMetas((mm as MonetMeta[]) ?? []);
      setMonetOps((mo as MonetOp[]) ?? []);
      setFcas((fa as FcaLite[]) ?? []);
      setReunioes((rs as ReuniaoStatus[]) ?? []);
      setRiscos(dadosRadar.map((d) => ({ ...d, av: avaliarRiscoChurn(d) })));
      setPlacar(pl);
      setPlacarHist((ph as PlacarHist[]) ?? []);
      setOkrMetricas((okm as OkrMetrica[]) ?? []);
      setOkrMetas((okt as OkrMeta[]) ?? []);
      setOkrReal((okr as OkrReal[]) ?? []);
      setLoading(false);
    }
    load();
    // eslint-disable-next-line
  }, []);

  const squadDoCliente = useMemo(() => new Map(clientes.map((c) => [c.id, c.squad_id])), [clientes]);
  const mrrAtual = useMemo(() => clientes.reduce((s, c) => s + (Number(c.mrr) || 0), 0), [clientes]);

  /** MRR de referência do mês: travado na aba Churn > fechamento do Forecast > MRR de hoje (mês corrente) */
  function mrrDoMes(a: number, m: number): number | null {
    const b = bases.find((x) => x.ano === a && x.mes === m);
    if (b) return b.mrr_base;
    const f = forecast.find((x) => x.ano === a && x.mes === m);
    if (f?.mrr_total_snapshot) return Number(f.mrr_total_snapshot);
    if (a === ano && m === mes) return mrrAtual;
    if (f?.mrr_realizado) return Number(f.mrr_realizado);
    return null;
  }

  function churnDoMes(a: number, m: number, squadId?: string) {
    const lista = churnSol.filter((s) => s.ano === a && s.mes === m && s.status !== "revertido"
      && (!squadId || s.cliente?.squad_id === squadId));
    const planejado = lista.reduce((x, s) => x + (Number(s.mrr) || 0), 0);
    const confirmado = lista.filter((s) => s.status === "confirmado").reduce((x, s) => x + (Number(s.mrr) || 0), 0);
    return { planejado, confirmado };
  }

  /* ---------- 1. Saúde da receita ---------- */
  const receita = useMemo(() => {
    const prev = mesesAtras(2)[0];
    const mrrPassado = mrrDoMes(prev.ano, prev.mes);
    const metaMrr = forecast.find((f) => f.ano === ano && f.mes === mes)?.meta_mrr ?? null;
    const base = mrrDoMes(ano, mes) ?? mrrAtual;
    const ch = churnDoMes(ano, mes);

    const mesStr = `${ano}-${String(mes).padStart(2, "0")}`;
    const metaMonet = monetMetas.reduce((s, m) => s + Number(m.valor_meta || 0), 0);
    const valor = (o: MonetOp) => Number(o.valor_mrr_estimado ?? 0) + Number(o.valor_onetime_estimado ?? 0);
    const ganho = monetOps.filter((o) => o.estagio === "ganho" && (o.data_prevista_fechamento ?? o.data_ganho)?.slice(0, 7) === mesStr);
    const monetRealizado = ganho.reduce((s, o) => s + valor(o), 0);
    const upsellMrrGanho = ganho.reduce((s, o) => s + Number(o.valor_mrr_estimado ?? 0), 0);
    const pipeline = monetOps.filter((o) => !["ganho", "perdido"].includes(o.estagio) && o.data_prevista_fechamento?.slice(0, 7) === mesStr)
      .reduce((s, o) => s + Number(o.valor_mrr_estimado ?? 0), 0);

    // Fechamento previsto: MRR de hoje + upsell recorrente ainda em negociação − retenções que ainda não saíram
    const emRetencaoAberto = churnSol.filter((s) => s.ano === ano && s.mes === mes && ["solicitado", "em_retencao"].includes(s.status)
      && squadDoCliente.has(s.cliente_id)).reduce((x, s) => x + (Number(s.mrr) || 0), 0);
    const fechamentoPrevisto = mrrAtual + pipeline - emRetencaoAberto;

    const venc = (ate: number, de: number) => clientes.filter((c) => {
      const d = diasParaVencimento(c.data_vencimento_contrato);
      return d != null && d > de && d <= ate;
    });
    const vencidos = clientes.filter((c) => { const d = diasParaVencimento(c.data_vencimento_contrato); return d != null && d < 0; });
    return {
      mrrPassado, metaMrr: metaMrr != null && metaMrr > 0 ? Number(metaMrr) : null, base,
      churnPlanejado: ch.planejado, churnConfirmado: ch.confirmado,
      pctPlanejado: base ? (ch.planejado / base) * 100 : null, pctConfirmado: base ? (ch.confirmado / base) * 100 : null,
      metaMonet, monetRealizado, upsellMrrGanho, pipeline, emRetencaoAberto, fechamentoPrevisto,
      vencidos, v30: venc(30, -1), v60: venc(60, 30), v90: venc(90, 60),
    };
    // eslint-disable-next-line
  }, [clientes, churnSol, bases, forecast, monetMetas, monetOps, mrrAtual]);

  /* ---------- 2. Comparativo dos squads ---------- */
  const comparativo = useMemo(() => squads.filter((s) => !squadExcluido(s.nome)).map((s) => {
    const cl = clientes.filter((c) => c.squad_id === s.id);
    const mrr = cl.reduce((x, c) => x + (Number(c.mrr) || 0), 0);
    const ch = churnDoMes(ano, mes, s.id);
    const pl = placar.find((p) => p.squad_id === s.id);
    const notas = fcas.filter((f) => f.cliente_squad_id === s.id && f.nota_final != null).map((f) => Number(f.nota_final));
    const custo = pessoas.filter((p) => p.squad_id === s.id && !p.compartilhado_entre_squads).reduce((x, p) => x + (Number(p.salario) || 0), 0);
    return {
      squad: s, clientes: cl.length, mrr,
      // Base = MRR de hoje + o que já saiu (confirmado), pra não descontar quem já cancelou
      churnPct: mrr + ch.confirmado ? (ch.planejado / (mrr + ch.confirmado)) * 100 : null,
      nota: pl?.nota ?? null,
      fca: notas.length ? notas.reduce((a, b) => a + b, 0) / notas.length : null,
      tarefas: pl?.criterios.tarefas.pct != null ? pl.criterios.tarefas.pct * 100 : null,
      margem: mrr - custo, margemPct: mrr ? ((mrr - custo) / mrr) * 100 : null,
      fcaPct: pl?.criterios.fca.pct ?? null, pePct: pl?.criterios.pe.pct ?? null,
    };
    // eslint-disable-next-line
  }), [squads, clientes, churnSol, placar, fcas, pessoas]);

  // Pior de cada coluna fica em vermelho
  const piores = useMemo(() => {
    const pior = (vals: (number | null)[], menorPior = true) => {
      const v = vals.filter((x): x is number => x != null);
      if (v.length < 2) return null;
      return menorPior ? Math.min(...v) : Math.max(...v);
    };
    return {
      churnPct: pior(comparativo.map((c) => c.churnPct), false),
      nota: pior(comparativo.map((c) => c.nota)),
      fca: pior(comparativo.map((c) => c.fca)),
      tarefas: pior(comparativo.map((c) => c.tarefas)),
      margemPct: pior(comparativo.map((c) => c.margemPct)),
    };
  }, [comparativo]);

  /* ---------- 3. Onde agir ---------- */
  const emRetencao = useMemo(() => clientes.filter((c) => c.etapa === "em_recuperacao").map((c) => {
    const sol = churnSol.filter((s) => s.cliente_id === c.id && ["solicitado", "em_retencao"].includes(s.status))
      .sort((a, b) => b.data_solicitacao.localeCompare(a.data_solicitacao))[0];
    const desde = sol?.data_solicitacao ?? c.updated_at?.slice(0, 10);
    const dias = desde ? Math.floor((Date.now() - new Date(desde + "T00:00:00").getTime()) / 86400000) : null;
    return { c, desde, dias };
  }).sort((a, b) => (b.dias ?? 0) - (a.dias ?? 0)), [clientes, churnSol]);

  const topRisco = useMemo(() => riscos
    .filter((r) => r.av.nivel === "critico" || r.av.nivel === "atencao")
    .sort((a, b) => (Number(b.cliente.mrr) || 0) - (Number(a.cliente.mrr) || 0))
    .slice(0, 5), [riscos]);

  const semReuniao = useMemo(() => {
    const ativos = new Map(clientes.map((c) => [c.id, c]));
    return reunioes.filter((r) => ativos.has(r.cliente_id) && r.dias_sem_reuniao > 30)
      .map((r) => ({ r, c: ativos.get(r.cliente_id)! }))
      .sort((a, b) => (Number(b.c.mrr) || 0) - (Number(a.c.mrr) || 0));
  }, [reunioes, clientes]);

  /* ---------- 4. Time ---------- */
  const vagas = useMemo(() => squads.flatMap((s) => CARGOS_OPERACIONAIS.map((cargo) => {
    const plan = headcount.find((h) => h.squad_id === s.id && h.cargo === cargo)?.quantidade_planejada ?? 0;
    const atual = pessoas.filter((p) => !p.compartilhado_entre_squads && p.squad_id === s.id && p.cargo === cargo).length;
    return { squad: s.nome, cargo, plan, atual };
  })), [squads, headcount, pessoas]);
  const hcPlanejado = vagas.reduce((s, v) => s + v.plan, 0);
  const hcReal = vagas.reduce((s, v) => s + v.atual, 0);
  const vagasAbertas = vagas.filter((v) => v.atual < v.plan);

  const carga = useMemo(() => {
    const m = new Map<string, { nome: string; papel: string; clientes: number; mrr: number }>();
    const add = (nome: string | null, papel: string, c: ClienteView) => {
      if (!nome) return;
      const k = `${papel}|${nome}`;
      const x = m.get(k) ?? { nome, papel, clientes: 0, mrr: 0 };
      x.clientes++; x.mrr += Number(c.mrr) || 0;
      m.set(k, x);
    };
    clientes.forEach((c) => { add(c.account_nome, "Gestor de Projetos", c); add(c.gestor_trafego_nome, "Gestor de Tráfego", c); });
    return Array.from(m.values()).sort((a, b) => b.clientes - a.clientes);
  }, [clientes]);
  const mediaCarga = (papel: string) => {
    const l = carga.filter((c) => c.papel === papel);
    return l.length ? l.reduce((s, c) => s + c.clientes, 0) / l.length : 0;
  };

  // Metas dos investidores: último mês (dos últimos 3) com realizado lançado
  const okrResumo = useMemo(() => {
    const comDado = meses6.slice(3).reverse().find(({ ano: a, mes: m }) => okrReal.some((r) => r.ano === a && r.mes === m && r.valor_realizado != null));
    if (!comDado) return null;
    const { ano: a, mes: m } = comDado;
    let investidores = 0, bateram = 0, metasAval = 0, metasBatidas = 0;
    pessoas.filter((p) => p.nivel_senioridade && p.nivel_v && !(p.squad_id && squads.find((s) => s.id === p.squad_id && squadExcluido(s.nome))))
      .forEach((p) => {
        let av = 0, bt = 0;
        okrMetricas.filter((mt) => mt.cargo === p.cargo).forEach((mt) => {
          const meta = okrMetas.find((r) => r.ano === a && r.mes === m && r.metrica_id === mt.id && r.nivel === p.nivel_senioridade && r.versao_v === p.nivel_v);
          const real = okrReal.find((r) => r.ano === a && r.mes === m && r.metrica_id === mt.id && r.pessoa_id === p.id);
          if (!meta?.valor_meta || real?.valor_realizado == null) return;
          av++;
          const menor = mt.nome.toLowerCase().includes("churn") || mt.nome.toLowerCase().includes("refação");
          if (menor ? real.valor_realizado <= meta.valor_meta : real.valor_realizado >= meta.valor_meta) bt++;
        });
        if (!av) return;
        investidores++; metasAval += av; metasBatidas += bt;
        if (bt / av >= 0.7) bateram++;
      });
    return { ano: a, mes: m, investidores, bateram, metasAval, metasBatidas };
  }, [meses6, okrReal, okrMetas, okrMetricas, pessoas, squads]);

  /* ---------- 5. Tendência ---------- */
  const tendencia = useMemo(() => meses6.map(({ ano: a, mes: m }) => {
    const mrr = mrrDoMes(a, m);
    const ch = churnDoMes(a, m);
    const notas = placarHist.filter((p) => {
      const [y, mm] = p.semana.split("-").map(Number);
      return y === a && mm === m && p.nota != null;
    }).map((p) => Number(p.nota));
    return {
      label: `${MESES_LABEL[m - 1].slice(0, 3)}/${String(a).slice(-2)}`, mrr,
      churnPct: mrr ? (ch.planejado / mrr) * 100 : null,
      placar: notas.length ? Math.round(notas.reduce((x, y) => x + y, 0) / notas.length) : null,
    };
    // eslint-disable-next-line
  }), [meses6, bases, forecast, churnSol, placarHist, mrrAtual]);
  const maxMrr = Math.max(1, ...tendencia.map((t) => t.mrr ?? 0));

  if (loading) return <p className="text-brand-muted">Carregando painel do gerente...</p>;

  const varMes = receita.mrrPassado ? ((mrrAtual - receita.mrrPassado) / receita.mrrPassado) * 100 : null;
  const somaMrr = (l: ClienteView[]) => l.reduce((s, c) => s + (Number(c.mrr) || 0), 0);
  const semanaLabel = `${formatDate(inicioDaSemana(semana)).slice(0, 5)} a ${formatDate(semana).slice(0, 5)}`;

  return (
    <div className="space-y-8">
      {/* ============ 1. SAÚDE DA RECEITA ============ */}
      <section>
        <Titulo icone="💰" texto={`Saúde da receita · ${MESES_LABEL[mes - 1]}/${ano}`} />
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          <Kpi label="MRR atual" valor={formatBRL(mrrAtual)} cor="text-brand"
            sub={`${clientes.length} clientes${varMes != null ? ` · ${varMes >= 0 ? "+" : ""}${pctFmt(varMes)} vs mês passado` : ""}`} />
          <Kpi label="Meta de MRR" valor={receita.metaMrr ? formatBRL(receita.metaMrr) : "—"}
            cor={receita.metaMrr && mrrAtual >= receita.metaMrr ? "text-emerald-300" : "text-amber-300"}
            sub={receita.metaMrr ? `${Math.round((mrrAtual / receita.metaMrr) * 100)}% atingido · falta ${formatBRL(Math.max(0, receita.metaMrr - mrrAtual))}` : "cadastre no Forecast"}
            href="/forecast" />
          <Kpi label="Churn Planejado" valor={pctFmt(receita.pctPlanejado, 2)}
            cor={receita.pctPlanejado != null && receita.pctPlanejado <= 5 ? "text-emerald-300" : "text-red-300"}
            sub={`${formatBRL(receita.churnPlanejado)} · meta ≤ 5%`} href="/churn" />
          <Kpi label="Churn confirmado" valor={pctFmt(receita.pctConfirmado, 2)}
            cor={receita.pctConfirmado != null && receita.pctConfirmado <= 5 ? "text-emerald-300" : "text-red-400"}
            sub={formatBRL(receita.churnConfirmado)} href="/churn" />
          <Kpi label="Monetização" valor={formatBRL(receita.monetRealizado)}
            cor={receita.metaMonet && receita.monetRealizado >= receita.metaMonet ? "text-emerald-300" : "text-amber-300"}
            sub={receita.metaMonet ? `meta ${formatBRL(receita.metaMonet)} · ${Math.round((receita.monetRealizado / receita.metaMonet) * 100)}%` : "sem meta cadastrada no mês"}
            href="/monetizacao" />
          <Kpi label="Fechamento previsto" valor={formatBRL(receita.fechamentoPrevisto)}
            cor={receita.fechamentoPrevisto >= mrrAtual ? "text-emerald-300" : "text-red-300"}
            sub={`+${formatBRL(receita.pipeline)} upsell em negociação · −${formatBRL(receita.emRetencaoAberto)} em retenção`}
            href="/forecast" />
        </div>

        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[
            { t: "Contratos vencidos", l: receita.vencidos, cor: "border-red-500/40 text-red-300" },
            { t: "Vencem em até 30 dias", l: receita.v30, cor: "border-orange-500/40 text-orange-300" },
            { t: "Vencem em 31 a 60 dias", l: receita.v60, cor: "border-amber-500/40 text-amber-300" },
            { t: "Vencem em 61 a 90 dias", l: receita.v90, cor: "border-white/10 text-gray-200" },
          ].map((b) => (
            <a key={b.t} href="/clientes" className={`card border p-3 transition hover:brightness-125 ${b.cor}`}>
              <p className="text-[10px] uppercase tracking-wide opacity-70">{b.t}</p>
              <p className="mt-1 text-xl font-bold">{formatBRL(somaMrr(b.l))}</p>
              <p className="text-[10px] text-brand-muted line-clamp-2">
                {b.l.length === 0 ? "nenhum" : `${b.l.length} · ${b.l.slice(0, 3).map((c) => c.nome).join(", ")}${b.l.length > 3 ? "…" : ""}`}
              </p>
            </a>
          ))}
        </div>
      </section>

      {/* ============ 2. COMPARATIVO DOS SQUADS ============ */}
      <section>
        <Titulo icone="⚖️" texto="Comparativo dos squads" sub={`Placar e tarefas da semana fechada (${semanaLabel}) · o resto, mês atual · em vermelho, o pior de cada coluna`} />
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="px-4 py-3">Squad</th>
                <th className="px-4 py-3">MRR</th>
                <th className="px-4 py-3">Churn Planejado</th>
                <th className="px-4 py-3">Placar</th>
                <th className="px-4 py-3">FCA médio</th>
                <th className="px-4 py-3">Tarefas no prazo</th>
                <th className="px-4 py-3">Margem</th>
              </tr>
            </thead>
            <tbody>
              {comparativo.map((c) => {
                const r = (v: number | null, p: number | null) => (v != null && p != null && v === p ? "text-red-400 font-semibold" : "");
                return (
                  <tr key={c.squad.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{c.squad.nome}</p>
                      <p className="text-[10px] text-brand-muted">{c.clientes} clientes</p>
                    </td>
                    <td className="px-4 py-3">{formatBRL(c.mrr)}</td>
                    <td className={`px-4 py-3 ${r(c.churnPct, piores.churnPct)}`}>{pctFmt(c.churnPct)}</td>
                    <td className={`px-4 py-3 ${r(c.nota, piores.nota)}`}>{c.nota ?? "—"}</td>
                    <td className={`px-4 py-3 ${r(c.fca, piores.fca)}`}>{c.fca != null ? c.fca.toFixed(2) : "—"}</td>
                    <td className={`px-4 py-3 ${r(c.tarefas, piores.tarefas)}`}>{pctFmt(c.tarefas, 0)}</td>
                    <td className={`px-4 py-3 ${r(c.margemPct, piores.margemPct)}`}>
                      {formatBRL(c.margem)} <span className="text-[10px] text-brand-muted">{pctFmt(c.margemPct, 0)}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ============ 3. ONDE AGIR ============ */}
      <section>
        <Titulo icone="🎯" texto="Onde agir" sub="Só o que precisa de decisão do gerente" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Bloco titulo={`Clientes Em Retenção (${emRetencao.length}) · ${formatBRL(somaMrr(emRetencao.map((e) => e.c)))}`} href="/churn">
            {emRetencao.length === 0 && <Vazio texto="Nenhum cliente em retenção 🎉" />}
            {emRetencao.map(({ c, desde, dias }) => (
              <Linha key={c.id} titulo={c.nome}
                sub={`${c.squad_nome ?? "—"} · dono: ${c.account_nome ?? c.coordenador_nome ?? "sem responsável"}`}
                direita={formatBRL(c.mrr)}
                direitaSub={dias != null ? `${dias} ${dias === 1 ? "dia" : "dias"} em retenção` : desde ?? ""}
                alerta={dias != null && dias > 15} />
            ))}
          </Bloco>

          <Bloco titulo="Top 5 em risco por MRR" href="/health-score">
            {topRisco.length === 0 && <Vazio texto="Nenhum cliente em risco" />}
            {topRisco.map(({ cliente: c, av }) => (
              <Linha key={c.id} titulo={c.nome}
                sub={av.sinais[0]?.texto ?? "—"}
                direita={formatBRL(c.mrr)}
                direitaSub={av.nivel === "critico" ? `Crítico · risco ${av.risco}` : `Atenção · risco ${av.risco}`}
                alerta={av.nivel === "critico"} />
            ))}
          </Bloco>

          <Bloco titulo={`Sem reunião há mais de 30 dias (${semReuniao.length}) · ${formatBRL(somaMrr(semReuniao.map((s) => s.c)))}`} href="/reunioes">
            {semReuniao.length === 0 && <Vazio texto="Todos com reunião no último mês" />}
            {semReuniao.slice(0, 8).map(({ r, c }) => (
              <Linha key={c.id} titulo={c.nome} sub={`${c.squad_nome ?? "—"} · ${c.account_nome ?? "sem GP"}`}
                direita={formatBRL(c.mrr)}
                direitaSub={r.ultima_reuniao ? `${r.dias_sem_reuniao} dias` : "nunca registrada"}
                alerta={!r.ultima_reuniao || r.dias_sem_reuniao > 45} />
            ))}
            {semReuniao.length > 8 && <p className="pt-1 text-[10px] text-brand-muted">+{semReuniao.length - 8} clientes</p>}
          </Bloco>

          <Bloco titulo={`Disciplina dos squads · semana ${semanaLabel}`} href="/placar">
            {comparativo.map((c) => {
              const f = c.fcaPct, p = c.pePct;
              return (
                <div key={c.squad.id} className="flex items-center gap-3 rounded-md p-2">
                  <p className="w-24 shrink-0 text-sm font-medium">{c.squad.nome}</p>
                  <Barra label="FCA preenchido" pct={f} />
                  <Barra label="Ponto de Equilíbrio" pct={p} />
                </div>
              );
            })}
          </Bloco>
        </div>
      </section>

      {/* ============ 4. TIME ============ */}
      <section>
        <Titulo icone="👥" texto="Time" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Bloco titulo={`Headcount: ${hcReal} de ${hcPlanejado} planejados`} href="/headcount">
            {vagasAbertas.length === 0 && <Vazio texto="Nenhuma vaga em aberto" />}
            {vagasAbertas.map((v) => (
              <Linha key={`${v.squad}-${v.cargo}`} titulo={`${v.squad} · ${CARGO_LABEL[v.cargo]}`}
                sub={`${v.atual} de ${v.plan}`} direita={`${v.plan - v.atual} vaga${v.plan - v.atual > 1 ? "s" : ""}`} alerta />
            ))}
          </Bloco>

          <Bloco titulo="Carga por pessoa" href="/pessoas">
            {["Gestor de Projetos", "Gestor de Tráfego"].map((papel) => {
              const media = mediaCarga(papel);
              return (
                <div key={papel} className="mb-2">
                  <p className="px-2 text-[10px] uppercase tracking-wide text-brand-muted">{papel} · média {media.toFixed(1)} clientes</p>
                  {carga.filter((c) => c.papel === papel).map((c) => (
                    <Linha key={c.nome} titulo={c.nome} sub={formatBRL(c.mrr)}
                      direita={`${c.clientes} clientes`}
                      direitaSub={c.clientes > media * 1.3 ? "acima da média" : ""}
                      alerta={c.clientes > media * 1.3} />
                  ))}
                </div>
              );
            })}
          </Bloco>

          <Bloco titulo="Metas dos investidores" href="/metas">
            {!okrResumo && <Vazio texto="Nenhum realizado lançado nos últimos 3 meses" />}
            {okrResumo && (
              <div className="space-y-3 p-2">
                <p className="text-xs text-brand-muted">Último mês lançado: <b className="text-gray-200">{MESES_LABEL[okrResumo.mes - 1]}/{okrResumo.ano}</b></p>
                <div>
                  <p className="text-3xl font-bold">{okrResumo.bateram}<span className="text-base text-brand-muted"> de {okrResumo.investidores}</span></p>
                  <p className="text-[10px] text-brand-muted">investidores bateram 70% ou mais das metas</p>
                </div>
                <div>
                  <p className="text-xl font-bold">{Math.round((okrResumo.metasBatidas / okrResumo.metasAval) * 100)}%</p>
                  <p className="text-[10px] text-brand-muted">{okrResumo.metasBatidas} de {okrResumo.metasAval} metas batidas</p>
                </div>
                {(okrResumo.ano !== ano || okrResumo.mes !== mes) && (
                  <p className="text-[10px] text-amber-300">{MESES_LABEL[mes - 1]} ainda sem realizado lançado</p>
                )}
              </div>
            )}
          </Bloco>
        </div>
      </section>

      {/* ============ 5. TENDÊNCIA ============ */}
      <section>
        <Titulo icone="📈" texto="Tendência · últimos 6 meses" sub="MRR travado de cada mês (ou o de hoje, no mês corrente) · Placar = média das semanas do mês" />
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="px-4 py-3">Mês</th>
                <th className="px-4 py-3 w-1/2">MRR</th>
                <th className="px-4 py-3">Churn Planejado</th>
                <th className="px-4 py-3">Placar médio</th>
              </tr>
            </thead>
            <tbody>
              {tendencia.map((t) => (
                <tr key={t.label} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 font-medium">{t.label}</td>
                  <td className="px-4 py-3">
                    {t.mrr == null ? <span className="text-[10px] text-brand-muted">sem MRR travado</span> : (
                      <div className="flex items-center gap-2">
                        <div className="h-2 flex-1 rounded bg-white/5">
                          <div className="h-2 rounded bg-brand" style={{ width: `${(t.mrr / maxMrr) * 100}%` }} />
                        </div>
                        <span className="w-24 text-right text-xs">{formatBRL(t.mrr)}</span>
                      </div>
                    )}
                  </td>
                  <td className={`px-4 py-3 ${t.churnPct != null && t.churnPct > 5 ? "text-red-300" : "text-emerald-300"}`}>{pctFmt(t.churnPct, 2)}</td>
                  <td className="px-4 py-3">{t.placar ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

/* ============================== PEÇAS ============================== */

function Titulo({ icone, texto, sub }: { icone: string; texto: string; sub?: string }) {
  return (
    <div className="mb-3">
      <p className="text-sm font-semibold">{icone} {texto}</p>
      {sub && <p className="text-xs text-brand-muted">{sub}</p>}
    </div>
  );
}

function Kpi({ label, valor, cor, sub, href }: { label: string; valor: string; cor?: string; sub?: string; href?: string }) {
  const corpo = (
    <div className="card h-full p-3">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${cor ?? "text-white"}`}>{valor}</p>
      {sub && <p className="mt-1 text-[10px] text-brand-muted">{sub}</p>}
    </div>
  );
  return href ? <a href={href} className="block transition hover:brightness-125">{corpo}</a> : corpo;
}

function Bloco({ titulo, href, children }: { titulo: string; href?: string; children: React.ReactNode }) {
  return (
    <div className="card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold">{titulo}</p>
        {href && <a href={href} className="shrink-0 text-xs text-brand-muted hover:text-white">abrir →</a>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Linha({ titulo, sub, direita, direitaSub, alerta }: {
  titulo: string; sub?: string; direita?: string; direitaSub?: string; alerta?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-md p-2 hover:bg-white/5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{titulo}</p>
        {sub && <p className="truncate text-[10px] text-brand-muted">{sub}</p>}
      </div>
      <div className="shrink-0 text-right">
        {direita && <p className="text-xs">{direita}</p>}
        {direitaSub && <p className={`text-[10px] ${alerta ? "text-red-300" : "text-brand-muted"}`}>{direitaSub}</p>}
      </div>
    </div>
  );
}

function Barra({ label, pct }: { label: string; pct: number | null }) {
  const v = pct == null ? null : Math.round(pct * 100);
  const cor = v == null ? "bg-white/10" : v >= 80 ? "bg-emerald-400" : v >= 50 ? "bg-amber-400" : "bg-red-400";
  return (
    <div className="min-w-0 flex-1">
      <div className="flex justify-between text-[10px] text-brand-muted"><span className="truncate">{label}</span><span>{v == null ? "—" : `${v}%`}</span></div>
      <div className="mt-0.5 h-1.5 rounded bg-white/5"><div className={`h-1.5 rounded ${cor}`} style={{ width: `${v ?? 0}%` }} /></div>
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="p-2 text-sm text-brand-muted">{texto}</p>;
}
