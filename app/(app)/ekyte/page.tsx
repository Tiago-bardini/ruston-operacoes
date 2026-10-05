"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/types";

type SyncLog = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  pages_processed: number;
  tasks_upserted: number;
  erro: string | null;
};

type Task = {
  id: number;
  title: string | null;
  executor: string | null;
  executor_email: string | null;
  executor_id: string | null;
  workspace: string | null;
  project: string | null;
  phase: string | null;
  current_due_date: string | null;
  original_due_date: string | null;
  resolved_date: string | null;
  creation_date: string | null;
  actual_time: number | null;
  estimated_time: number | null;
  esta_atrasada: boolean;
  foi_prorrogada: boolean;
  cliente_nome: string | null;
  pessoa_nome: string | null;
  pessoa_id: string | null;
  cliente_id: string | null;
  pessoa_ativa: boolean | null;
};

type Pessoa = { id: string; nome: string; cargo: string | null; squad_id: string | null; ativo: boolean };
type Squad = { id: string; nome: string };

type Periodo = "aberto" | "semana" | "mes" | "7d" | "30d" | "90d" | "mes_passado" | "custom";

const PERIODO_LABEL: Record<Periodo, string> = {
  aberto: "Tudo em aberto (recomendado)",
  semana: "Semana atual",
  mes: "Mês atual",
  "7d": "Últimos 7 dias",
  "30d": "Últimos 30 dias",
  "90d": "Últimos 90 dias",
  mes_passado: "Mês passado",
  custom: "📅 Período customizado",
};

function limitesPeriodo(p: Periodo, customIni?: string, customFim?: string): { ini: Date; fim: Date } {
  const now = new Date();
  const fim = new Date(now); fim.setHours(23, 59, 59, 999);
  const ini = new Date(now);
  if (p === "custom") {
    const dIni = customIni ? new Date(customIni + "T00:00:00") : new Date(2000, 0, 1);
    const dFim = customFim ? new Date(customFim + "T23:59:59") : new Date();
    return { ini: dIni, fim: dFim };
  }
  if (p === "aberto") {
    ini.setFullYear(2000); // efetivamente "sem limite"
  } else if (p === "semana") {
    const dia = now.getDay();
    const diffPraSegunda = (dia + 6) % 7;
    ini.setDate(now.getDate() - diffPraSegunda);
    ini.setHours(0, 0, 0, 0);
  } else if (p === "mes") {
    ini.setDate(1); ini.setHours(0, 0, 0, 0);
  } else if (p === "7d") {
    ini.setDate(now.getDate() - 7); ini.setHours(0, 0, 0, 0);
  } else if (p === "30d") {
    ini.setDate(now.getDate() - 30); ini.setHours(0, 0, 0, 0);
  } else if (p === "90d") {
    ini.setDate(now.getDate() - 90); ini.setHours(0, 0, 0, 0);
  } else if (p === "mes_passado") {
    ini.setMonth(now.getMonth() - 1); ini.setDate(1); ini.setHours(0, 0, 0, 0);
    fim.setDate(0); fim.setHours(23, 59, 59, 999);
  }
  return { ini, fim };
}

export default function EkytePage() {
  const supabase = createClient();
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [tab, setTab] = useState<"resumo" | "ranking" | "squad" | "pessoa" | "vinculos">("resumo");
  const [semMatch, setSemMatch] = useState<{executor_id: string|null; executor: string; executor_email: string|null; qtd_tasks: number}[]>([]);
  const [periodo, setPeriodo] = useState<Periodo>("aberto");
  const hojeStr = new Date().toISOString().slice(0, 10);
  const trintaDiasAtras = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [customIni, setCustomIni] = useState<string>(trintaDiasAtras);
  const [customFim, setCustomFim] = useState<string>(hojeStr);
  const [filtroSquad, setFiltroSquad] = useState<string>("");
  const [pessoaSel, setPessoaSel] = useState<string>("");

  async function carregar() {
    const [{ data: ls }, { data: ts }, { data: ps }, { data: sq }, { data: sm }] = await Promise.all([
      supabase.from("ruston_ekyte_sync_log").select("*").order("started_at", { ascending: false }).limit(10),
      // View LEVE (sem payload_raw) e FILTRA só pessoas ativas no Ruston
      // (ignora tasks de quem já saiu da empresa)
      supabase.from("ruston_ekyte_tasks_dashboard")
        .select("*")
        .eq("pessoa_ativa", true)
        .limit(50000),
      supabase.from("ruston_pessoas").select("id,nome,cargo,squad_id,ativo").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("id,nome").eq("ativo", true).order("nome"),
      supabase.rpc("fn_ekyte_pessoas_sem_match"),
    ]);
    setLogs(ls ?? []);
    setTasks(ts ?? []);
    setPessoas(ps ?? []);
    setSquads(sq ?? []);
    setSemMatch((sm as any) ?? []);
  }

  async function rematch() {
    setMensagem("Re-vinculando...");
    const { data, error } = await supabase.rpc("fn_ekyte_match_pessoas");
    if (error) { setMensagem(`✗ ${error.message}`); return; }
    const r = Array.isArray(data) ? data[0] : data;
    setMensagem(`✓ Re-match: ${r?.matched_total ?? 0} tasks vinculadas (email ${r?.por_email ?? 0}, nome ${r?.por_nome_exato ?? 0}, primeiro nome ${r?.por_primeiro_nome ?? 0}, manual ${r?.por_mapping ?? 0})`);
    await carregar();
  }

  async function vincularManual(ekyte_executor_id: string | null, ekyte_email: string | null, ekyte_nome: string, pessoa_id: string) {
    const { error } = await supabase.from("ruston_ekyte_mapping_pessoa").upsert({
      ekyte_executor_id, ekyte_email, ekyte_nome, pessoa_id,
    }, { onConflict: "ekyte_executor_id" });
    if (error) { alert(`Erro: ${error.message}`); return; }
    await rematch();
  }

  useEffect(() => { carregar(); }, []);

  async function sincronizar() {
    setSincronizando(true);
    setMensagem("Sincronizando com Ekyte...");
    try {
      const res = await fetch("/api/ekyte-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Erro");
      setMensagem(`✓ ${j.tasks_upserted} tasks sincronizadas em ${j.pages} páginas. Match: ${j.match?.pessoas} pessoas, ${j.match?.clientes} clientes.`);
      await carregar();
    } catch (e: any) {
      setMensagem(`✗ ${e.message}`);
    } finally {
      setSincronizando(false);
    }
  }

  const { ini, fim } = useMemo(() => limitesPeriodo(periodo, customIni, customFim), [periodo, customIni, customFim]);

  // Tasks "do período" = qualquer uma com atividade no período:
  //  - criada no período
  //  - OU com prazo (current_due_date) no período
  //  - OU concluída (resolved_date) no período
  //  - OU em aberto hoje (resolved_date null) para o período "aberto"
  const tasksPeriodo = useMemo(() => {
    if (periodo === "aberto") {
      // Tudo que não foi concluído OU foi concluído recentemente (30d)
      const limite30 = new Date(Date.now() - 30 * 86400000);
      return tasks.filter((t) => !t.resolved_date || new Date(t.resolved_date) >= limite30);
    }
    return tasks.filter((t) => {
      const dCria = t.creation_date ? new Date(t.creation_date) : null;
      const dPrazo = t.current_due_date ? new Date(t.current_due_date) : null;
      const dConcl = t.resolved_date ? new Date(t.resolved_date) : null;
      const dentro = (d: Date | null) => d && d >= ini && d <= fim;
      return dentro(dCria) || dentro(dPrazo) || dentro(dConcl);
    });
  }, [tasks, ini, fim, periodo]);

  // Mapa pessoa → squad
  const pessoaSquadMap = useMemo(() => {
    const m = new Map<string, string>();
    pessoas.forEach((p) => { if (p.squad_id) m.set(p.id, p.squad_id); });
    return m;
  }, [pessoas]);
  const squadMap = useMemo(() => {
    const m = new Map<string, string>();
    squads.forEach((s) => m.set(s.id, s.nome));
    return m;
  }, [squads]);

  // Agregação por pessoa
  type Linha = {
    pessoa_id: string | null;
    nome: string;
    email: string;
    squad_nome: string;
    minutos_apontados: number;
    tasks_concluidas: number;
    tasks_atrasadas: number;
    tasks_prorrogadas: number;
    tasks_total: number;
  };

  const porPessoa = useMemo<Linha[]>(() => {
    const map = new Map<string, Linha>();
    tasksPeriodo.forEach((t) => {
      if (!t.executor_email && !t.executor_id) return;
      const key = t.executor_email ?? t.executor_id ?? "sem_resp";
      if (!map.has(key)) {
        const squadId = t.pessoa_id ? pessoaSquadMap.get(t.pessoa_id) : null;
        map.set(key, {
          pessoa_id: t.pessoa_id ?? null,
          nome: t.pessoa_nome ?? t.executor ?? key,
          email: t.executor_email ?? "",
          squad_nome: squadId ? squadMap.get(squadId) ?? "" : "—",
          minutos_apontados: 0,
          tasks_concluidas: 0,
          tasks_atrasadas: 0,
          tasks_prorrogadas: 0,
          tasks_total: 0,
        });
      }
      const l = map.get(key)!;
      l.tasks_total += 1;
      // Horas apontadas = soma de actual_time de QUALQUER task do período
      // (não só concluídas — pessoa pode apontar horas em task ainda em andamento)
      l.minutos_apontados += t.actual_time ?? 0;
      if (t.resolved_date) l.tasks_concluidas += 1;
      if (t.esta_atrasada) l.tasks_atrasadas += 1;
      if (t.foi_prorrogada) l.tasks_prorrogadas += 1;
    });
    let lista = Array.from(map.values());
    if (filtroSquad) lista = lista.filter((l) => {
      const squadNomeFiltro = squadMap.get(filtroSquad) ?? "";
      return l.squad_nome === squadNomeFiltro;
    });
    return lista.sort((a, b) => b.minutos_apontados - a.minutos_apontados);
  }, [tasksPeriodo, filtroSquad, pessoaSquadMap, squadMap]);

  // Agregação por squad
  type LinhaSquad = { squad_id: string; nome: string; pessoas: number; horas: number; atrasadas: number; prorrogadas: number; concluidas: number };
  const porSquad = useMemo<LinhaSquad[]>(() => {
    const map = new Map<string, LinhaSquad>();
    porPessoa.forEach((p) => {
      // Acha squad_id via nome (reverso)
      const sqEntry = Array.from(squadMap.entries()).find(([, nm]) => nm === p.squad_nome);
      const squadId = sqEntry?.[0] ?? "sem_squad";
      const squadNome = sqEntry?.[1] ?? "Sem squad";
      if (!map.has(squadId)) {
        map.set(squadId, { squad_id: squadId, nome: squadNome, pessoas: 0, horas: 0, atrasadas: 0, prorrogadas: 0, concluidas: 0 });
      }
      const l = map.get(squadId)!;
      l.pessoas += 1;
      l.horas += p.minutos_apontados / 60;
      l.atrasadas += p.tasks_atrasadas;
      l.prorrogadas += p.tasks_prorrogadas;
      l.concluidas += p.tasks_concluidas;
    });
    return Array.from(map.values()).sort((a, b) => b.horas - a.horas);
  }, [porPessoa, squadMap]);

  // Pessoa individual selecionada
  const tasksDaPessoa = useMemo(() => {
    if (!pessoaSel) return [];
    const pessoa = pessoas.find((p) => p.id === pessoaSel);
    if (!pessoa) return [];
    return tasksPeriodo.filter((t) => t.pessoa_id === pessoaSel);
  }, [tasksPeriodo, pessoaSel, pessoas]);

  // Stats globais
  const stats = useMemo(() => {
    return {
      total: tasksPeriodo.length,
      concluidas: tasksPeriodo.filter((t) => t.resolved_date).length,
      atrasadas: tasksPeriodo.filter((t) => t.esta_atrasada).length,
      prorrogadas: tasksPeriodo.filter((t) => t.foi_prorrogada).length,
      semApontar: porPessoa.filter((p) => p.minutos_apontados === 0).length,
    };
  }, [tasksPeriodo, porPessoa]);

  // Semáforo: horas apontadas (ex: <10h ruim, 10-30h ok, >30h bom)
  function semaforoHoras(min: number): string {
    const h = min / 60;
    if (h === 0) return "bg-red-500/20 text-red-300 border-red-500/40";
    if (h < 10) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
  }
  function semaforoAtrasadas(n: number): string {
    if (n === 0) return "bg-emerald-500/20 text-emerald-300 border-emerald-500/40";
    if (n <= 3) return "bg-amber-500/20 text-amber-300 border-amber-500/40";
    return "bg-red-500/20 text-red-300 border-red-500/40";
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">📊 Ekyte</h1>
          <p className="text-sm text-brand-muted">Sincroniza tasks e cruza com contrato, apontamento e prazos.</p>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <select className="input" value={periodo} onChange={(e) => setPeriodo(e.target.value as Periodo)}>
            {Object.entries(PERIODO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          {periodo === "custom" && (
            <div className="flex gap-2 items-center">
              <span className="text-xs text-brand-muted">de</span>
              <input type="date" className="input" value={customIni}
                onChange={(e) => setCustomIni(e.target.value)} />
              <span className="text-xs text-brand-muted">até</span>
              <input type="date" className="input" value={customFim}
                onChange={(e) => setCustomFim(e.target.value)} />
            </div>
          )}
          <select className="input" value={filtroSquad} onChange={(e) => setFiltroSquad(e.target.value)}>
            <option value="">Todos os squads</option>
            {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <button className="btn bg-brand hover:bg-emerald-600" onClick={sincronizar} disabled={sincronizando}>
            {sincronizando ? "⏳ Sincronizando..." : "🔄 Sincronizar"}
          </button>
        </div>
      </div>

      {mensagem && <div className="card p-3 text-sm">{mensagem}</div>}

      {/* STATS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card label="Tasks no período" value={stats.total} />
        <Card label="Concluídas" value={stats.concluidas} tone="good" />
        <Card label="Atrasadas" value={stats.atrasadas} tone="bad" />
        <Card label="Prorrogadas s/ entrega" value={stats.prorrogadas} tone="warn" />
        <Card label="Pessoas sem apontar" value={stats.semApontar} tone="bad" />
      </div>

      {/* TABS */}
      <div className="flex gap-2 border-b border-white/10 pb-2 text-sm overflow-x-auto">
        <TabBtn ativo={tab === "resumo"} onClick={() => setTab("resumo")}>📋 Resumo</TabBtn>
        <TabBtn ativo={tab === "ranking"} onClick={() => setTab("ranking")}>👥 Ranking por Pessoa</TabBtn>
        <TabBtn ativo={tab === "squad"} onClick={() => setTab("squad")}>🏢 Por Squad</TabBtn>
        <TabBtn ativo={tab === "pessoa"} onClick={() => setTab("pessoa")}>🔍 Investidor (1:1)</TabBtn>
        <TabBtn ativo={tab === "vinculos"} onClick={() => setTab("vinculos")}>🔗 Vínculos ({semMatch.length})</TabBtn>
      </div>

      {/* RESUMO */}
      {tab === "resumo" && (
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">Últimas sincronizações</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
                <th className="px-2 py-2">Quando</th>
                <th className="px-2 py-2">Status</th>
                <th className="px-2 py-2">Páginas</th>
                <th className="px-2 py-2">Tasks</th>
                <th className="px-2 py-2">Erro</th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 && <tr><td colSpan={5} className="px-2 py-6 text-center text-brand-muted">Nenhuma sincronização ainda.</td></tr>}
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-white/5 last:border-0">
                  <td className="px-2 py-2">{new Date(l.started_at).toLocaleString("pt-BR")}</td>
                  <td className="px-2 py-2">
                    <span className={`badge ${l.status === "success" ? "bg-emerald-500/15 text-emerald-300" : l.status === "error" ? "bg-red-500/15 text-red-300" : "bg-amber-500/15 text-amber-300"}`}>{l.status}</span>
                  </td>
                  <td className="px-2 py-2">{l.pages_processed}</td>
                  <td className="px-2 py-2">{l.tasks_upserted}</td>
                  <td className="px-2 py-2 text-xs text-red-300">{l.erro ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* RANKING POR PESSOA */}
      {tab === "ranking" && (
        <div className="card p-4 overflow-x-auto">
          <h3 className="mb-3 font-semibold">Ranking por pessoa — {PERIODO_LABEL[periodo]}</h3>
          <p className="mb-3 text-xs text-brand-muted">
            Ordenado por horas apontadas (menores primeiro = quem precisa de cobrança). Clica no nome pra ver detalhes.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
                <th className="px-2 py-2">Pessoa</th>
                <th className="px-2 py-2">Squad</th>
                <th className="px-2 py-2 text-center">Horas apontadas</th>
                <th className="px-2 py-2 text-center">Concluídas</th>
                <th className="px-2 py-2 text-center">Atrasadas</th>
                <th className="px-2 py-2 text-center">Prorrogadas</th>
                <th className="px-2 py-2 text-center">Total tasks</th>
              </tr>
            </thead>
            <tbody>
              {[...porPessoa].sort((a, b) => a.minutos_apontados - b.minutos_apontados).map((l) => (
                <tr key={l.email || l.nome} className="border-b border-white/5 last:border-0">
                  <td className="px-2 py-2">
                    {l.pessoa_id ? (
                      <button
                        onClick={() => { setPessoaSel(l.pessoa_id!); setTab("pessoa"); }}
                        className="font-medium hover:text-brand underline underline-offset-2"
                      >{l.nome}</button>
                    ) : (
                      <span className="font-medium text-amber-300" title="Pessoa não vinculada ao cadastro Ruston">{l.nome} ⚠</span>
                    )}
                    <div className="text-[10px] text-brand-muted">{l.email}</div>
                  </td>
                  <td className="px-2 py-2 text-xs text-brand-muted">{l.squad_nome}</td>
                  <td className="px-2 py-2 text-center">
                    <span className={`inline-block rounded px-2 py-0.5 border ${semaforoHoras(l.minutos_apontados)}`}>
                      {(l.minutos_apontados / 60).toFixed(1)}h
                    </span>
                  </td>
                  <td className="px-2 py-2 text-center text-emerald-300">{l.tasks_concluidas}</td>
                  <td className="px-2 py-2 text-center">
                    <span className={`inline-block rounded px-2 py-0.5 border ${semaforoAtrasadas(l.tasks_atrasadas)}`}>{l.tasks_atrasadas}</span>
                  </td>
                  <td className="px-2 py-2 text-center text-amber-300">{l.tasks_prorrogadas}</td>
                  <td className="px-2 py-2 text-center text-brand-muted">{l.tasks_total}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {porPessoa.length === 0 && <p className="py-8 text-center text-brand-muted text-sm">Nenhum dado pro período/squad selecionado.</p>}
        </div>
      )}

      {/* POR SQUAD */}
      {tab === "squad" && (
        <div className="grid gap-3 md:grid-cols-2">
          {porSquad.map((s) => (
            <div key={s.squad_id} className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">{s.nome}</h3>
                <span className="badge bg-white/5 text-brand-muted">{s.pessoas} {s.pessoas === 1 ? "pessoa" : "pessoas"}</span>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <StatMini label="Horas apontadas" value={`${s.horas.toFixed(1)}h`} tone="good" />
                <StatMini label="Concluídas" value={s.concluidas} tone="good" />
                <StatMini label="Atrasadas" value={s.atrasadas} tone={s.atrasadas > 0 ? "bad" : "good"} />
                <StatMini label="Prorrogadas" value={s.prorrogadas} tone={s.prorrogadas > 0 ? "warn" : "good"} />
              </div>
            </div>
          ))}
          {porSquad.length === 0 && <div className="card p-8 text-center text-brand-muted">Nenhum dado.</div>}
        </div>
      )}

      {/* INVESTIDOR 1:1 */}
      {tab === "pessoa" && (
        <div className="space-y-3">
          <div className="card p-4">
            <label className="label">Escolhe a pessoa</label>
            <select className="input" value={pessoaSel} onChange={(e) => setPessoaSel(e.target.value)}>
              <option value="">— selecionar —</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome} {p.cargo ? `(${p.cargo})` : ""}</option>)}
            </select>
          </div>

          {pessoaSel && (
            <>
              {(() => {
                const total = tasksDaPessoa.length;
                const concluidas = tasksDaPessoa.filter((t) => t.resolved_date).length;
                const atrasadas = tasksDaPessoa.filter((t) => t.esta_atrasada).length;
                const prorrogadas = tasksDaPessoa.filter((t) => t.foi_prorrogada).length;
                // Horas apontadas = soma de actual_time de QUALQUER task da pessoa no período
                const minutos = tasksDaPessoa.reduce((acc, t) => acc + (t.actual_time ?? 0), 0);
                return (
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
                    <Card label="Tasks no período" value={total} />
                    <Card label="Concluídas" value={concluidas} tone="good" />
                    <Card label="Horas apontadas" value={`${(minutos / 60).toFixed(1)}h`} tone={minutos > 0 ? "good" : "bad"} />
                    <Card label="Atrasadas" value={atrasadas} tone={atrasadas > 0 ? "bad" : "good"} />
                    <Card label="Prorrogadas" value={prorrogadas} tone={prorrogadas > 0 ? "warn" : "good"} />
                  </div>
                );
              })()}

              <div className="card p-4 overflow-x-auto">
                <h3 className="mb-3 font-semibold">Tasks desta pessoa</h3>
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
                      <th className="px-2 py-2">Task</th>
                      <th className="px-2 py-2">Cliente</th>
                      <th className="px-2 py-2">Fase</th>
                      <th className="px-2 py-2">Prazo</th>
                      <th className="px-2 py-2">Status</th>
                      <th className="px-2 py-2 text-right">Tempo (real/est)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tasksDaPessoa.sort((a, b) => (b.current_due_date ?? "").localeCompare(a.current_due_date ?? "")).map((t) => (
                      <tr key={t.id} className="border-b border-white/5 last:border-0">
                        <td className="px-2 py-2 max-w-md">
                          <a href={`https://app.ekyte.com/#/tasks/list/${t.id}/edit`} target="_blank" rel="noopener" className="hover:text-brand">
                            {t.title}
                          </a>
                        </td>
                        <td className="px-2 py-2 text-xs text-brand-muted">{t.cliente_nome ?? t.workspace ?? "—"}</td>
                        <td className="px-2 py-2 text-xs text-brand-muted">{t.phase ?? "—"}</td>
                        <td className="px-2 py-2 text-xs">
                          <span className={t.esta_atrasada ? "text-red-300" : "text-brand-muted"}>
                            {t.current_due_date ? formatDate(t.current_due_date) : "—"}
                          </span>
                          {t.foi_prorrogada && t.original_due_date && (
                            <div className="text-[10px] text-amber-300">prorrogada (orig: {formatDate(t.original_due_date)})</div>
                          )}
                        </td>
                        <td className="px-2 py-2 text-xs">
                          {t.resolved_date ? <span className="text-emerald-300">✓ concluída</span> :
                           t.esta_atrasada ? <span className="text-red-300">atrasada</span> :
                           <span className="text-brand-muted">em andamento</span>}
                        </td>
                        <td className="px-2 py-2 text-right text-xs text-brand-muted">
                          {((t.actual_time ?? 0) / 60).toFixed(1)}h / {((t.estimated_time ?? 0) / 60).toFixed(1)}h
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {tasksDaPessoa.length === 0 && <p className="py-8 text-center text-brand-muted text-sm">Nenhuma task da pessoa no período.</p>}
              </div>
            </>
          )}
        </div>
      )}
      {/* VÍNCULOS */}
      {tab === "vinculos" && (
        <div className="card p-4 overflow-x-auto">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Pessoas do Ekyte sem vínculo com cadastro</h3>
              <p className="text-xs text-brand-muted">
                Pra cada linha, escolhe quem é no cadastro Ruston. O vínculo é salvo e aplica em todas as tasks dessa pessoa.
              </p>
            </div>
            <button className="btn-ghost text-xs" onClick={rematch}>🔄 Re-match automático</button>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
                <th className="px-2 py-2">Nome no Ekyte</th>
                <th className="px-2 py-2">Email no Ekyte</th>
                <th className="px-2 py-2 text-center">Qtd tasks</th>
                <th className="px-2 py-2">Vincular com (cadastro Ruston)</th>
              </tr>
            </thead>
            <tbody>
              {semMatch.length === 0 && <tr><td colSpan={4} className="px-2 py-8 text-center text-emerald-300">🎉 Todas as pessoas estão vinculadas!</td></tr>}
              {semMatch.map((s) => (
                <tr key={s.executor_id || s.executor_email || s.executor} className="border-b border-white/5 last:border-0">
                  <td className="px-2 py-2 font-medium">{s.executor}</td>
                  <td className="px-2 py-2 text-xs text-brand-muted">{s.executor_email ?? "—"}</td>
                  <td className="px-2 py-2 text-center">{s.qtd_tasks}</td>
                  <td className="px-2 py-2">
                    <select
                      className="input text-xs"
                      onChange={(e) => {
                        if (e.target.value) vincularManual(s.executor_id, s.executor_email, s.executor, e.target.value);
                      }}
                      defaultValue=""
                    >
                      <option value="">— escolher —</option>
                      {pessoas.map((p) => (
                        <option key={p.id} value={p.id}>{p.nome} {p.cargo ? `(${p.cargo})` : ""}</option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" | "warn" | "muted" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300" : tone === "muted" ? "text-brand-muted" : "text-white";
  return (
    <div className="card p-3">
      <p className="text-xs text-brand-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function StatMini({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <div className="rounded-md border border-white/5 bg-white/5 p-2">
      <p className="text-[10px] text-brand-muted">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  );
}

function TabBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: any }) {
  return (
    <button onClick={onClick} className={`rounded-md px-3 py-1 text-sm transition whitespace-nowrap ${ativo ? "bg-brand/20 text-brand" : "text-brand-muted hover:bg-white/5 hover:text-white"}`}>{children}</button>
  );
}
