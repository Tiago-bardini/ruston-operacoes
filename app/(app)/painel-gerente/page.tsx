"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatBRL } from "@/lib/types";

type ClienteBase = {
  id: string; nome: string; etapa: string; mrr: number | null;
  coordenador_nome: string | null; squad_nome: string | null; ativo: boolean;
};
type FcaRow = { cliente_id: string; nota_final: number | null; bandeira: string | null; data_referencia: string };
type RadarRow = {
  cliente_id: string; temperatura: string | null; sentimento: string | null;
  risco_churn: string | null; dias_sem_contato: number | null; resumo_curto: string | null;
};
type AlertaRow = { id: string; tipo: string; cliente_id: string; detalhes: string; criado_em: string };
type TaskAgg = { pessoa_nome: string; pessoa_cargo: string | null; total: number; atrasadas: number };

function healthScore(fca: number | null, churn: string | null, sent: string | null, dias: number | null): number {
  let s = fca ?? 5;
  if (sent === "positivo") s += 0.5; else if (sent === "negativo") s -= 0.5;
  if (churn === "baixo") s += 0.5; else if (churn === "alto") s -= 1.0; else if (churn === "medio") s -= 0.3;
  if (dias != null) { if (dias > 14) s -= 0.5; else if (dias <= 2) s += 0.3; }
  return Math.max(0, Math.min(10, Math.round(s * 10) / 10));
}

export default function PainelGerentePage() {
  const supabase = createClient();
  const [clientes, setClientes] = useState<ClienteBase[]>([]);
  const [fcas, setFcas] = useState<FcaRow[]>([]);
  const [radar, setRadar] = useState<RadarRow[]>([]);
  const [alertas, setAlertas] = useState<AlertaRow[]>([]);
  const [taskAgg, setTaskAgg] = useState<TaskAgg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const hoje = new Date().toISOString().slice(0, 10);
      const [{ data: c }, { data: f }, { data: r }, { data: a }, { data: t }] = await Promise.all([
        supabase.from("ruston_clientes_view").select("id, nome, etapa, mrr, coordenador_nome, squad_nome, ativo").eq("ativo", true),
        supabase.from("ruston_fca_view").select("cliente_id, nota_final, bandeira, data_referencia").order("data_referencia", { ascending: false }),
        supabase.from("ruston_whatsapp_radar_view").select("cliente_id, temperatura, sentimento, risco_churn, dias_sem_contato, resumo_curto"),
        supabase.from("ruston_whatsapp_alertas").select("id, tipo, cliente_id, detalhes, criado_em").gte("criado_em", hoje + "T00:00:00").order("criado_em", { ascending: false }).limit(20),
        supabase.from("ruston_ekyte_tasks_view").select("pessoa_nome, pessoa_cargo, situation, esta_atrasada").not("pessoa_id", "is", null),
      ]);
      setClientes((c ?? []) as ClienteBase[]);
      setFcas((f ?? []) as FcaRow[]);
      setRadar((r ?? []) as RadarRow[]);
      setAlertas((a ?? []) as AlertaRow[]);

      // Agregar tarefas por pessoa
      const map: Record<string, TaskAgg> = {};
      for (const tk of (t ?? []) as any[]) {
        const key = tk.pessoa_nome ?? "?";
        if (!map[key]) map[key] = { pessoa_nome: key, pessoa_cargo: tk.pessoa_cargo, total: 0, atrasadas: 0 };
        map[key].total++;
        if (tk.esta_atrasada) map[key].atrasadas++;
      }
      setTaskAgg(Object.values(map));
      setLoading(false);
    }
    load();
  }, []);

  // Top clientes em risco
  const clientesRisco = useMemo(() => {
    const fcaMap: Record<string, FcaRow> = {};
    for (const f of fcas) { if (!fcaMap[f.cliente_id]) fcaMap[f.cliente_id] = f; }
    const radarMap = Object.fromEntries(radar.map((r) => [r.cliente_id, r]));

    return clientes
      .filter((c) => c.etapa !== "cancelado" && c.etapa !== "suspenso")
      .map((c) => {
        const f = fcaMap[c.id]; const w = radarMap[c.id];
        const score = healthScore(f?.nota_final ?? null, w?.risco_churn ?? null, w?.sentimento ?? null, w?.dias_sem_contato ?? null);
        return { ...c, score, risco_churn: w?.risco_churn, sentimento: w?.sentimento, dias_sem_contato: w?.dias_sem_contato, resumo: w?.resumo_curto, fca: f?.nota_final };
      })
      .sort((a, b) => a.score - b.score)
      .slice(0, 10);
  }, [clientes, fcas, radar]);

  // Coordenadores com mais pendencias
  const coordPendencias = useMemo(() => {
    return taskAgg
      .filter((t) => t.atrasadas > 0)
      .sort((a, b) => b.atrasadas - a.atrasadas)
      .slice(0, 10);
  }, [taskAgg]);

  // MRR total e em risco
  const mrrInfo = useMemo(() => {
    const total = clientes.reduce((a, c) => a + (c.mrr ?? 0), 0);
    const emRisco = clientesRisco
      .filter((c) => c.score < 6)
      .reduce((a, c) => a + (c.mrr ?? 0), 0);
    return { total, emRisco };
  }, [clientes, clientesRisco]);

  // Alertas de hoje
  const alertasHoje = alertas.length;

  if (loading) {
    return <div className="flex items-center justify-center h-screen"><div className="text-zinc-400 text-lg">Carregando painel...</div></div>;
  }

  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Painel do Gerente</h1>

      {/* Cards resumo */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="MRR Total" value={formatBRL(mrrInfo.total)} color="text-white" />
        <Card label="MRR em Risco" value={formatBRL(mrrInfo.emRisco)} color={mrrInfo.emRisco > 0 ? "text-red-400" : "text-emerald-400"} sub={mrrInfo.total > 0 ? `${Math.round((mrrInfo.emRisco / mrrInfo.total) * 100)}% do total` : ""} />
        <Card label="Clientes Ativos" value={String(clientes.filter((c) => c.etapa !== "cancelado" && c.etapa !== "suspenso").length)} color="text-blue-400" />
        <Card label="Alertas Hoje" value={String(alertasHoje)} color={alertasHoje > 0 ? "text-yellow-400" : "text-emerald-400"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top clientes em risco */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Clientes em Risco</h2>
          <div className="space-y-2">
            {clientesRisco.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-zinc-800/50">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold border ${
                  c.score >= 8 ? "text-emerald-400 border-emerald-500/40" :
                  c.score >= 6 ? "text-yellow-400 border-yellow-500/40" :
                  "text-red-400 border-red-500/40"
                }`}>
                  {c.score.toFixed(1)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{c.nome}</div>
                  <div className="text-zinc-500 text-xs">{c.coordenador_nome ?? "-"} | {c.squad_nome ?? "-"}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-zinc-300">{c.mrr ? formatBRL(c.mrr) : "-"}</div>
                  {c.risco_churn === "alto" && <span className="text-red-400">Churn alto</span>}
                  {c.dias_sem_contato != null && c.dias_sem_contato > 7 && <span className="text-yellow-400">{c.dias_sem_contato}d sem contato</span>}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Coordenadores com pendencias */}
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Pendencias por Pessoa</h2>
          <div className="space-y-2">
            {coordPendencias.map((p) => (
              <div key={p.pessoa_nome} className="flex items-center gap-3 p-2 rounded-md hover:bg-zinc-800/50">
                <div className="flex-1">
                  <div className="text-white text-sm font-medium">{p.pessoa_nome}</div>
                  <div className="text-zinc-500 text-xs capitalize">{(p.pessoa_cargo ?? "").replace(/_/g, " ")}</div>
                </div>
                <div className="text-right">
                  <div className="text-red-400 font-bold text-lg">{p.atrasadas}</div>
                  <div className="text-zinc-500 text-xs">atrasadas de {p.total}</div>
                </div>
              </div>
            ))}
            {coordPendencias.length === 0 && <div className="text-zinc-500 text-sm">Nenhuma tarefa atrasada!</div>}
          </div>
        </div>
      </div>

      {/* Alertas recentes */}
      {alertas.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Alertas de Hoje</h2>
          <div className="space-y-2">
            {alertas.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-2 rounded-md bg-zinc-800/30 text-sm">
                <span className={`text-lg ${a.tipo === "sla_30min" ? "text-yellow-400" : a.tipo === "grupo_mudo" ? "text-zinc-400" : "text-red-400"}`}>
                  {a.tipo === "sla_30min" ? "⏰" : a.tipo === "grupo_mudo" ? "🔕" : "🚫"}
                </span>
                <span className="text-zinc-300 flex-1">{a.detalhes}</span>
                <span className="text-zinc-500 text-xs">{new Date(a.criado_em).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Card({ label, value, color, sub }: { label: string; value: string; color: string; sub?: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="text-zinc-400 text-xs uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value}</div>
      {sub && <div className="text-zinc-500 text-xs mt-0.5">{sub}</div>}
    </div>
  );
}
