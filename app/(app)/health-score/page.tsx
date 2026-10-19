"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ClienteBase = {
  id: string;
  nome: string;
  etapa: string;
  mrr: number | null;
  coordenador_id: string | null;
  coordenador_nome: string | null;
  squad_nome: string | null;
  ativo: boolean;
};

type FcaRow = {
  cliente_id: string;
  nota_final: number | null;
  bandeira: string | null;
  data_referencia: string;
};

type RadarRow = {
  cliente_id: string;
  temperatura: string | null;
  sentimento: string | null;
  risco_churn: string | null;
  oportunidade_upsell: string | null;
  dias_sem_contato: number | null;
  qtd_mensagens: number | null;
};

type TaskStats = {
  cliente_id: string;
  total: number;
  concluidas: number;
  atrasadas: number;
};

type HealthData = {
  id: string;
  nome: string;
  etapa: string;
  mrr: number | null;
  coordenador: string | null;
  squad: string | null;
  // Componentes
  fca_nota: number | null;
  fca_bandeira: string | null;
  wa_temperatura: string | null;
  wa_sentimento: string | null;
  wa_risco_churn: string | null;
  wa_upsell: string | null;
  wa_dias_sem_contato: number | null;
  wa_msgs: number | null;
  tarefas_taxa: number | null;
  // Score final
  score: number;
  nivel: "critico" | "alerta" | "estavel" | "saudavel";
};

function calcScore(d: {
  fca_nota: number | null;
  wa_temperatura: string | null;
  wa_sentimento: string | null;
  wa_risco_churn: string | null;
  wa_dias_sem_contato: number | null;
  tarefas_taxa: number | null;
}): number {
  let score = 50; // base

  // FCA (peso 35) — nota de 0-10 vira 0-35
  if (d.fca_nota != null) {
    score = score - 17.5 + (d.fca_nota / 10) * 35;
  }

  // WhatsApp Sentimento (peso 15)
  if (d.wa_sentimento === "positivo") score += 15;
  else if (d.wa_sentimento === "neutro") score += 7;
  else if (d.wa_sentimento === "negativo") score -= 10;

  // WhatsApp Temperatura (peso 10)
  if (d.wa_temperatura === "quente") score += 10;
  else if (d.wa_temperatura === "morna") score += 3;
  else if (d.wa_temperatura === "fria") score -= 5;

  // Risco Churn (peso 20)
  if (d.wa_risco_churn === "baixo") score += 15;
  else if (d.wa_risco_churn === "medio") score -= 5;
  else if (d.wa_risco_churn === "alto") score -= 20;

  // Dias sem contato (peso 10)
  if (d.wa_dias_sem_contato != null) {
    if (d.wa_dias_sem_contato <= 1) score += 10;
    else if (d.wa_dias_sem_contato <= 3) score += 5;
    else if (d.wa_dias_sem_contato <= 7) score -= 0;
    else if (d.wa_dias_sem_contato <= 14) score -= 5;
    else score -= 10;
  }

  // Tarefas (peso 10) — taxa de cumprimento
  if (d.tarefas_taxa != null) {
    score += (d.tarefas_taxa / 100) * 10 - 5;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

function scoreNivel(s: number): "critico" | "alerta" | "estavel" | "saudavel" {
  if (s >= 75) return "saudavel";
  if (s >= 55) return "estavel";
  if (s >= 35) return "alerta";
  return "critico";
}

const NIVEL_CONFIG = {
  saudavel: { label: "Saudavel", color: "text-emerald-400", bg: "bg-emerald-500", border: "border-emerald-500/40" },
  estavel: { label: "Estavel", color: "text-blue-400", bg: "bg-blue-500", border: "border-blue-500/40" },
  alerta: { label: "Alerta", color: "text-yellow-400", bg: "bg-yellow-500", border: "border-yellow-500/40" },
  critico: { label: "Critico", color: "text-red-400", bg: "bg-red-500", border: "border-red-500/40" },
};

export default function HealthScorePage() {
  const supabase = createClient();
  const [clientes, setClientes] = useState<ClienteBase[]>([]);
  const [fcas, setFcas] = useState<FcaRow[]>([]);
  const [radar, setRadar] = useState<RadarRow[]>([]);
  const [taskStats, setTaskStats] = useState<TaskStats[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroSquad, setFiltroSquad] = useState("todos");
  const [filtroNivel, setFiltroNivel] = useState("todos");
  const [ordenar, setOrdenar] = useState<"score" | "score_asc" | "nome" | "mrr">("score");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [{ data: c }, { data: f }, { data: r }, { data: t }] = await Promise.all([
        supabase.from("ruston_clientes_view").select("id, nome, etapa, mrr, coordenador_id, coordenador_nome, squad_nome, ativo").eq("ativo", true),
        supabase.from("ruston_fca_view").select("cliente_id, nota_final, bandeira, data_referencia").order("data_referencia", { ascending: false }),
        supabase.from("ruston_whatsapp_radar_view").select("cliente_id, temperatura, sentimento, risco_churn, oportunidade_upsell, dias_sem_contato, qtd_mensagens"),
        supabase.from("ruston_ekyte_tasks_view").select("cliente_id, situation, esta_atrasada").not("cliente_id", "is", null),
      ]);
      setClientes((c ?? []) as ClienteBase[]);
      setFcas((f ?? []) as FcaRow[]);
      setRadar((r ?? []) as RadarRow[]);

      // Agregar tarefas por cliente
      const statsMap: Record<string, TaskStats> = {};
      for (const task of (t ?? []) as any[]) {
        if (!task.cliente_id) continue;
        if (!statsMap[task.cliente_id]) statsMap[task.cliente_id] = { cliente_id: task.cliente_id, total: 0, concluidas: 0, atrasadas: 0 };
        statsMap[task.cliente_id].total++;
        if (task.situation === 30) statsMap[task.cliente_id].concluidas++;
        if (task.esta_atrasada) statsMap[task.cliente_id].atrasadas++;
      }
      setTaskStats(Object.values(statsMap));
      setLoading(false);
    }
    load();
  }, []);

  const healthData = useMemo<HealthData[]>(() => {
    // Map mais recente de FCA por cliente
    const fcaMap: Record<string, FcaRow> = {};
    for (const f of fcas) {
      if (!fcaMap[f.cliente_id]) fcaMap[f.cliente_id] = f;
    }
    const radarMap = Object.fromEntries(radar.map((r) => [r.cliente_id, r]));
    const taskMap = Object.fromEntries(taskStats.map((t) => [t.cliente_id, t]));

    return clientes
      .filter((c) => c.etapa !== "cancelado" && c.etapa !== "suspenso")
      .map((c) => {
        const fca = fcaMap[c.id];
        const wa = radarMap[c.id];
        const tk = taskMap[c.id];
        const taxa = tk && (tk.concluidas + tk.atrasadas) > 0
          ? Math.round((tk.concluidas / (tk.concluidas + tk.atrasadas)) * 100)
          : null;

        const score = calcScore({
          fca_nota: fca?.nota_final ?? null,
          wa_temperatura: wa?.temperatura ?? null,
          wa_sentimento: wa?.sentimento ?? null,
          wa_risco_churn: wa?.risco_churn ?? null,
          wa_dias_sem_contato: wa?.dias_sem_contato ?? null,
          tarefas_taxa: taxa,
        });

        return {
          id: c.id,
          nome: c.nome,
          etapa: c.etapa,
          mrr: c.mrr,
          coordenador: c.coordenador_nome,
          squad: c.squad_nome,
          fca_nota: fca?.nota_final ?? null,
          fca_bandeira: fca?.bandeira ?? null,
          wa_temperatura: wa?.temperatura ?? null,
          wa_sentimento: wa?.sentimento ?? null,
          wa_risco_churn: wa?.risco_churn ?? null,
          wa_upsell: wa?.oportunidade_upsell ?? null,
          wa_dias_sem_contato: wa?.dias_sem_contato ?? null,
          wa_msgs: wa?.qtd_mensagens ?? null,
          tarefas_taxa: taxa,
          score,
          nivel: scoreNivel(score),
        };
      })
      .filter((d) => {
        if (filtroSquad !== "todos" && d.squad !== filtroSquad) return false;
        if (filtroNivel !== "todos" && d.nivel !== filtroNivel) return false;
        return true;
      })
      .sort((a, b) => {
        if (ordenar === "score") return b.score - a.score;
        if (ordenar === "score_asc") return a.score - b.score;
        if (ordenar === "mrr") return (b.mrr ?? 0) - (a.mrr ?? 0);
        return a.nome.localeCompare(b.nome);
      });
  }, [clientes, fcas, radar, taskStats, filtroSquad, filtroNivel, ordenar]);

  const resumo = useMemo(() => {
    const r = { saudavel: 0, estavel: 0, alerta: 0, critico: 0, media: 0 };
    if (!healthData.length) return r;
    for (const d of healthData) r[d.nivel]++;
    r.media = Math.round(healthData.reduce((a, b) => a + b.score, 0) / healthData.length);
    return r;
  }, [healthData]);

  const squadsUnicos = useMemo(() => Array.from(new Set(clientes.map((c) => c.squad_nome).filter(Boolean))), [clientes]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-zinc-400 text-lg">Calculando Health Score...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Health Score dos Clientes</h1>
        <div className="text-right">
          <div className="text-3xl font-bold text-white">{resumo.media}</div>
          <div className="text-xs text-zinc-400">Media geral</div>
        </div>
      </div>

      {/* Cards resumo por nivel */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {(["saudavel", "estavel", "alerta", "critico"] as const).map((nivel) => {
          const cfg = NIVEL_CONFIG[nivel];
          return (
            <button
              key={nivel}
              onClick={() => setFiltroNivel(filtroNivel === nivel ? "todos" : nivel)}
              className={`rounded-lg border p-4 text-left transition-all ${filtroNivel === nivel ? `${cfg.border} bg-zinc-800` : "border-zinc-800 bg-zinc-900 hover:bg-zinc-800/50"}`}
            >
              <div className="text-zinc-400 text-xs uppercase tracking-wide">{cfg.label}</div>
              <div className={`text-2xl font-bold mt-1 ${cfg.color}`}>{resumo[nivel]}</div>
            </button>
          );
        })}
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <select className="bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700" value={filtroSquad} onChange={(e) => setFiltroSquad(e.target.value)}>
          <option value="todos">Todos os Squads</option>
          {squadsUnicos.map((s) => <option key={s} value={s!}>{s}</option>)}
        </select>
        <select className="bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700" value={ordenar} onChange={(e) => setOrdenar(e.target.value as any)}>
          <option value="score">Maior Score</option>
          <option value="score_asc">Menor Score (risco)</option>
          <option value="mrr">Maior MRR</option>
          <option value="nome">Nome A-Z</option>
        </select>
        {filtroNivel !== "todos" && (
          <button className="text-xs text-zinc-400 hover:text-white" onClick={() => setFiltroNivel("todos")}>Limpar filtro</button>
        )}
        <span className="text-zinc-500 text-sm ml-auto">{healthData.length} clientes</span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/60 text-zinc-400 text-left">
              <th className="px-4 py-3 font-medium">Score</th>
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Squad</th>
              <th className="px-4 py-3 font-medium">Coordenador</th>
              <th className="px-4 py-3 font-medium text-center">MRR</th>
              <th className="px-4 py-3 font-medium text-center">FCA</th>
              <th className="px-4 py-3 font-medium text-center">WhatsApp</th>
              <th className="px-4 py-3 font-medium text-center">Churn</th>
              <th className="px-4 py-3 font-medium text-center">Dias s/ Contato</th>
              <th className="px-4 py-3 font-medium text-center">Tarefas</th>
              <th className="px-4 py-3 font-medium text-center">Upsell</th>
            </tr>
          </thead>
          <tbody>
            {healthData.map((d) => {
              const cfg = NIVEL_CONFIG[d.nivel];
              return (
                <tr key={d.id} className="border-t border-zinc-800 hover:bg-zinc-800/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold ${cfg.color} border ${cfg.border}`}>
                        {d.score}
                      </div>
                      <div className="w-16 h-2 bg-zinc-800 rounded-full overflow-hidden">
                        <div className={`h-full rounded-full ${cfg.bg}`} style={{ width: `${d.score}%` }} />
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-white font-medium">{d.nome}</div>
                    <div className="text-zinc-500 text-xs capitalize">{d.etapa.replace(/_/g, " ")}</div>
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{d.squad ?? "-"}</td>
                  <td className="px-4 py-3 text-zinc-400">{d.coordenador ?? "-"}</td>
                  <td className="px-4 py-3 text-center text-zinc-300">
                    {d.mrr ? `R$ ${d.mrr.toLocaleString("pt-BR", { minimumFractionDigits: 0 })}` : "-"}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {d.fca_nota != null ? (
                      <span className={`font-medium ${d.fca_nota >= 7 ? "text-emerald-400" : d.fca_nota >= 5 ? "text-yellow-400" : "text-red-400"}`}>
                        {d.fca_nota.toFixed(1)}
                      </span>
                    ) : <span className="text-zinc-600">-</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      d.wa_sentimento === "positivo" ? "bg-emerald-500/20 text-emerald-300" :
                      d.wa_sentimento === "negativo" ? "bg-red-500/20 text-red-300" :
                      d.wa_sentimento === "neutro" ? "bg-zinc-500/20 text-zinc-300" : "text-zinc-600"
                    }`}>
                      {d.wa_sentimento ?? "-"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-medium ${
                      d.wa_risco_churn === "baixo" ? "text-emerald-400" :
                      d.wa_risco_churn === "medio" ? "text-yellow-400" :
                      d.wa_risco_churn === "alto" ? "text-red-400" : "text-zinc-600"
                    }`}>
                      {d.wa_risco_churn ?? "-"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {d.wa_dias_sem_contato != null ? (
                      <span className={`font-medium ${d.wa_dias_sem_contato <= 3 ? "text-emerald-400" : d.wa_dias_sem_contato <= 7 ? "text-yellow-400" : "text-red-400"}`}>
                        {d.wa_dias_sem_contato}d
                      </span>
                    ) : <span className="text-zinc-600">-</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {d.tarefas_taxa != null ? (
                      <span className={`font-medium ${d.tarefas_taxa >= 80 ? "text-emerald-400" : d.tarefas_taxa >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                        {d.tarefas_taxa}%
                      </span>
                    ) : <span className="text-zinc-600">-</span>}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs ${
                      d.wa_upsell === "clara" ? "text-emerald-400 font-bold" :
                      d.wa_upsell === "possivel" ? "text-blue-400" : "text-zinc-600"
                    }`}>
                      {d.wa_upsell === "clara" ? "Sim!" : d.wa_upsell === "possivel" ? "Talvez" : "-"}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legenda */}
      <div className="flex flex-wrap gap-4 text-xs text-zinc-500 mt-2">
        <span>Score = FCA (35%) + Sentimento WhatsApp (15%) + Temperatura (10%) + Risco Churn (20%) + Contato (10%) + Tarefas (10%)</span>
      </div>
    </div>
  );
}
