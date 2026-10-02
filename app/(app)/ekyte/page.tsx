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
  disparado_por_email: string | null;
};

type Task = {
  id: number;
  title: string | null;
  executor: string | null;
  executor_email: string | null;
  workspace: string | null;
  project: string | null;
  phase: string | null;
  current_due_date: string | null;
  original_due_date: string | null;
  resolved_date: string | null;
  actual_time: number | null;
  estimated_time: number | null;
  esta_atrasada: boolean;
  foi_prorrogada: boolean;
  cliente_nome: string | null;
  pessoa_nome: string | null;
};

export default function EkytePage() {
  const supabase = createClient();
  const [logs, setLogs] = useState<SyncLog[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sincronizando, setSincronizando] = useState(false);
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [tab, setTab] = useState<"resumo" | "horas" | "atrasadas" | "prorrogadas" | "cobertura">("resumo");

  async function carregar() {
    const [{ data: ls }, { data: ts }] = await Promise.all([
      supabase.from("ruston_ekyte_sync_log").select("*").order("started_at", { ascending: false }).limit(10),
      supabase.from("ruston_ekyte_tasks_view").select("*").limit(5000),
    ]);
    setLogs(ls ?? []);
    setTasks(ts ?? []);
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
      setMensagem(`✓ ${j.tasks_upserted} tasks atualizadas em ${j.pages} páginas. Match: ${j.match?.pessoas} pessoas, ${j.match?.clientes} clientes.`);
      await carregar();
    } catch (e: any) {
      setMensagem(`✗ ${e.message}`);
    } finally {
      setSincronizando(false);
    }
  }

  // ---------- AGREGAÇÕES ----------
  const stats = useMemo(() => {
    const total = tasks.length;
    const concluidas = tasks.filter((t) => t.resolved_date).length;
    const atrasadas = tasks.filter((t) => t.esta_atrasada).length;
    const prorrogadas = tasks.filter((t) => t.foi_prorrogada).length;
    const semMatchCliente = tasks.filter((t) => !t.cliente_nome).length;
    const semMatchPessoa = tasks.filter((t) => !t.pessoa_nome).length;
    return { total, concluidas, atrasadas, prorrogadas, semMatchCliente, semMatchPessoa };
  }, [tasks]);

  // Apontamento de horas por pessoa (últimos 7 dias)
  const horasPorPessoa = useMemo(() => {
    const seteDiasAtras = new Date(Date.now() - 7 * 86400000);
    const map = new Map<string, { nome: string; minutos: number; tasks: number }>();
    tasks.forEach((t) => {
      if (!t.executor_email) return;
      const key = t.executor_email;
      if (!map.has(key)) map.set(key, { nome: t.executor ?? key, minutos: 0, tasks: 0 });
      const atual = map.get(key)!;
      // Considera só tasks com atividade recente (resolved ou atrasadas)
      if (t.resolved_date && new Date(t.resolved_date) >= seteDiasAtras) {
        atual.minutos += t.actual_time ?? 0;
        atual.tasks += 1;
      }
    });
    return Array.from(map.values()).sort((a, b) => a.minutos - b.minutos);
  }, [tasks]);

  // Tasks atrasadas por pessoa
  const atrasadasPorPessoa = useMemo(() => {
    const map = new Map<string, { nome: string; qtd: number; tasks: Task[] }>();
    tasks.filter((t) => t.esta_atrasada).forEach((t) => {
      const key = t.executor_email ?? "sem_responsavel";
      if (!map.has(key)) map.set(key, { nome: t.executor ?? "Sem responsável", qtd: 0, tasks: [] });
      map.get(key)!.qtd += 1;
      map.get(key)!.tasks.push(t);
    });
    return Array.from(map.values()).sort((a, b) => b.qtd - a.qtd);
  }, [tasks]);

  const prorrogadas = useMemo(
    () => tasks.filter((t) => t.foi_prorrogada).sort((a, b) =>
      (b.current_due_date ?? "").localeCompare(a.current_due_date ?? "")),
    [tasks]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">📊 Ekyte</h1>
          <p className="text-sm text-brand-muted">
            Sincroniza as tasks do Ekyte e cruza com contrato, apontamento de horas e prazos.
          </p>
        </div>
        <button
          className="btn bg-brand hover:bg-emerald-600"
          onClick={sincronizar}
          disabled={sincronizando}
        >{sincronizando ? "⏳ Sincronizando..." : "🔄 Sincronizar agora"}</button>
      </div>

      {mensagem && (
        <div className="card p-3 text-sm">{mensagem}</div>
      )}

      {/* STATS CARDS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-6">
        <Card label="Tasks sincronizadas" value={stats.total} />
        <Card label="Concluídas" value={stats.concluidas} tone="good" />
        <Card label="Atrasadas" value={stats.atrasadas} tone="bad" />
        <Card label="Prorrogadas s/ entrega" value={stats.prorrogadas} tone="warn" />
        <Card label="Sem cliente linkado" value={stats.semMatchCliente} tone="muted" />
        <Card label="Sem pessoa linkada" value={stats.semMatchPessoa} tone="muted" />
      </div>

      {/* TABS */}
      <div className="flex gap-2 border-b border-white/10 pb-2 text-sm">
        <TabBtn ativo={tab === "resumo"} onClick={() => setTab("resumo")}>Resumo</TabBtn>
        <TabBtn ativo={tab === "horas"} onClick={() => setTab("horas")}>Apontamento (7d)</TabBtn>
        <TabBtn ativo={tab === "atrasadas"} onClick={() => setTab("atrasadas")}>Atrasadas</TabBtn>
        <TabBtn ativo={tab === "prorrogadas"} onClick={() => setTab("prorrogadas")}>Prorrogadas</TabBtn>
        <TabBtn ativo={tab === "cobertura"} onClick={() => setTab("cobertura")}>Cobertura contrato</TabBtn>
      </div>

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
              {logs.length === 0 && (
                <tr><td colSpan={5} className="px-2 py-6 text-center text-brand-muted">
                  Nenhuma sincronização ainda. Clica em "Sincronizar agora".
                </td></tr>
              )}
              {logs.map((l) => (
                <tr key={l.id} className="border-b border-white/5 last:border-0">
                  <td className="px-2 py-2">{new Date(l.started_at).toLocaleString("pt-BR")}</td>
                  <td className="px-2 py-2">
                    <span className={`badge ${
                      l.status === "success" ? "bg-emerald-500/15 text-emerald-300" :
                      l.status === "error" ? "bg-red-500/15 text-red-300" :
                      "bg-amber-500/15 text-amber-300"
                    }`}>{l.status}</span>
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

      {tab === "horas" && (
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">Horas apontadas nos últimos 7 dias</h3>
          <p className="mb-3 text-xs text-brand-muted">
            Ordenado dos que apontaram menos. Quem está no topo da lista com 0h provavelmente não tá apontando.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
                <th className="px-2 py-2">Pessoa</th>
                <th className="px-2 py-2">Horas apontadas</th>
                <th className="px-2 py-2">Tasks concluídas</th>
              </tr>
            </thead>
            <tbody>
              {horasPorPessoa.map((h) => (
                <tr key={h.nome} className="border-b border-white/5 last:border-0">
                  <td className="px-2 py-2 font-medium">{h.nome}</td>
                  <td className={`px-2 py-2 ${h.minutos === 0 ? "text-red-300 font-semibold" : ""}`}>
                    {(h.minutos / 60).toFixed(1)}h
                  </td>
                  <td className="px-2 py-2">{h.tasks}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "atrasadas" && (
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">Tasks atrasadas por pessoa</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
                <th className="px-2 py-2">Pessoa</th>
                <th className="px-2 py-2">Qtd</th>
                <th className="px-2 py-2">Tasks</th>
              </tr>
            </thead>
            <tbody>
              {atrasadasPorPessoa.map((p) => (
                <tr key={p.nome} className="border-b border-white/5 last:border-0 align-top">
                  <td className="px-2 py-2 font-medium">{p.nome}</td>
                  <td className="px-2 py-2 text-red-300 font-semibold">{p.qtd}</td>
                  <td className="px-2 py-2 text-xs">
                    {p.tasks.slice(0, 5).map((t) => (
                      <div key={t.id} className="truncate">
                        • {t.title} <span className="text-brand-muted">({formatDate(t.current_due_date)})</span>
                      </div>
                    ))}
                    {p.tasks.length > 5 && <div className="text-brand-muted">+{p.tasks.length - 5} outras</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "prorrogadas" && (
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">Tasks com data prorrogada sem entrega</h3>
          <p className="mb-3 text-xs text-brand-muted">
            Investidor mudou a data mas ainda não entregou. Prazo original × atual.
          </p>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
                <th className="px-2 py-2">Task</th>
                <th className="px-2 py-2">Executor</th>
                <th className="px-2 py-2">Cliente</th>
                <th className="px-2 py-2">Prazo orig.</th>
                <th className="px-2 py-2">Prazo atual</th>
              </tr>
            </thead>
            <tbody>
              {prorrogadas.slice(0, 200).map((t) => (
                <tr key={t.id} className="border-b border-white/5 last:border-0">
                  <td className="px-2 py-2 max-w-xs truncate">{t.title}</td>
                  <td className="px-2 py-2 text-brand-muted">{t.executor ?? "—"}</td>
                  <td className="px-2 py-2 text-brand-muted">{t.cliente_nome ?? t.workspace ?? "—"}</td>
                  <td className="px-2 py-2 text-amber-300">{formatDate(t.original_due_date)}</td>
                  <td className="px-2 py-2 text-red-300">{formatDate(t.current_due_date)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === "cobertura" && (
        <div className="card p-4">
          <h3 className="mb-3 font-semibold">Cobertura do contrato</h3>
          <p className="text-sm text-brand-muted">
            Em breve: cruzamento Catálogo de Entregas × tasks criadas no mês. (Aguardando mapeamento tipo task → item do catálogo.)
          </p>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" | "warn" | "muted" }) {
  const color =
    tone === "good" ? "text-emerald-300" :
    tone === "bad" ? "text-red-300" :
    tone === "warn" ? "text-amber-300" :
    tone === "muted" ? "text-brand-muted" : "text-white";
  return (
    <div className="card p-3">
      <p className="text-xs text-brand-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function TabBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: any }) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-3 py-1 text-sm transition ${
        ativo ? "bg-brand/20 text-brand" : "text-brand-muted hover:bg-white/5 hover:text-white"
      }`}
    >{children}</button>
  );
}
