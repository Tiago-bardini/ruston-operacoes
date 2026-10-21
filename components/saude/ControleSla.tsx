"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type ClienteBase = {
  id: string; nome: string; coordenador_nome: string | null; squad_nome: string | null;
  cadencia_reuniao_dias: number | null; tipo_cadencia: string | null;
};
type RadarRow = { cliente_id: string; dias_sem_contato: number | null; qtd_mensagens: number | null };
type FcaRow = { cliente_id: string; data_referencia: string; nota_final: number | null };
type TaskRow = { cliente_id: string; esta_atrasada: boolean; situation: number };
type AlertaRow = { id: string; tipo: string; cliente_id: string | null; criado_em: string };

type SlaCliente = {
  id: string; nome: string; coord: string | null; squad: string | null;
  wa_dias_sem_contato: number | null;
  wa_status: "ok" | "atencao" | "critico";
  tarefas_total: number; tarefas_atrasadas: number; tarefas_taxa: number;
  tarefas_status: "ok" | "atencao" | "critico";
  fca_dias_desde_ultimo: number | null;
  fca_status: "ok" | "atencao" | "critico";
  cadencia_dias: number | null;
  alertas_hoje: number;
};

function diasDesde(iso: string | null): number | null {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

export default function ControleSla() {
  const supabase = createClient();
  const [clientes, setClientes] = useState<ClienteBase[]>([]);
  const [radar, setRadar] = useState<RadarRow[]>([]);
  const [fcas, setFcas] = useState<FcaRow[]>([]);
  const [tasks, setTasks] = useState<TaskRow[]>([]);
  const [alertas, setAlertas] = useState<AlertaRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<"todos" | "critico" | "atencao" | "ok">("todos");
  const [filtroSquad, setFiltroSquad] = useState("todos");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const hoje = new Date().toISOString().slice(0, 10);
      const [{ data: c }, { data: r }, { data: f }, { data: t }, { data: a }] = await Promise.all([
        supabase.from("ruston_clientes_view").select("id, nome, coordenador_nome, squad_nome, cadencia_reuniao_dias, tipo_cadencia").eq("ativo", true).not("etapa", "in", "(cancelado,suspenso)"),
        supabase.from("ruston_whatsapp_radar_view").select("cliente_id, dias_sem_contato, qtd_mensagens"),
        supabase.from("ruston_fca_view").select("cliente_id, data_referencia, nota_final").order("data_referencia", { ascending: false }),
        supabase.from("ruston_ekyte_tasks_view").select("cliente_id, esta_atrasada, situation").not("cliente_id", "is", null),
        supabase.from("ruston_whatsapp_alertas").select("id, tipo, cliente_id, criado_em").gte("criado_em", hoje + "T00:00:00"),
      ]);
      setClientes((c ?? []) as ClienteBase[]);
      setRadar((r ?? []) as RadarRow[]);
      setFcas((f ?? []) as FcaRow[]);
      setTasks((t ?? []) as TaskRow[]);
      setAlertas((a ?? []) as AlertaRow[]);
      setLoading(false);
    }
    load();
  }, []);

  const slaData = useMemo<SlaCliente[]>(() => {
    const radarMap = Object.fromEntries(radar.map((r) => [r.cliente_id, r]));
    const fcaMap: Record<string, FcaRow> = {};
    for (const f of fcas) { if (!fcaMap[f.cliente_id]) fcaMap[f.cliente_id] = f; }
    const taskMap: Record<string, { total: number; atrasadas: number; concluidas: number }> = {};
    for (const t of tasks) {
      if (!t.cliente_id) continue;
      if (!taskMap[t.cliente_id]) taskMap[t.cliente_id] = { total: 0, atrasadas: 0, concluidas: 0 };
      taskMap[t.cliente_id].total++;
      if (t.esta_atrasada) taskMap[t.cliente_id].atrasadas++;
      if (t.situation === 30) taskMap[t.cliente_id].concluidas++;
    }
    const alertaMap: Record<string, number> = {};
    for (const a of alertas) { if (a.cliente_id) alertaMap[a.cliente_id] = (alertaMap[a.cliente_id] ?? 0) + 1; }

    return clientes.map((c) => {
      const wa = radarMap[c.id];
      const fca = fcaMap[c.id];
      const tk = taskMap[c.id] ?? { total: 0, atrasadas: 0, concluidas: 0 };
      const taxa = (tk.concluidas + tk.atrasadas) > 0 ? Math.round((tk.concluidas / (tk.concluidas + tk.atrasadas)) * 100) : 100;
      const fcaDias = diasDesde(fca?.data_referencia ?? null);

      const wa_status: "ok" | "atencao" | "critico" =
        (wa?.dias_sem_contato ?? 0) > 7 ? "critico" : (wa?.dias_sem_contato ?? 0) > 3 ? "atencao" : "ok";
      const tarefas_status: "ok" | "atencao" | "critico" =
        tk.atrasadas > 5 || taxa < 50 ? "critico" : tk.atrasadas > 2 || taxa < 70 ? "atencao" : "ok";
      const fca_status: "ok" | "atencao" | "critico" =
        fcaDias == null || fcaDias > 14 ? "critico" : fcaDias > 7 ? "atencao" : "ok";

      return {
        id: c.id, nome: c.nome, coord: c.coordenador_nome, squad: c.squad_nome,
        wa_dias_sem_contato: wa?.dias_sem_contato ?? null,
        wa_status,
        tarefas_total: tk.total, tarefas_atrasadas: tk.atrasadas, tarefas_taxa: taxa,
        tarefas_status,
        fca_dias_desde_ultimo: fcaDias,
        fca_status,
        cadencia_dias: c.cadencia_reuniao_dias,
        alertas_hoje: alertaMap[c.id] ?? 0,
      };
    })
    .filter((d) => {
      if (filtroSquad !== "todos" && d.squad !== filtroSquad) return false;
      if (filtroStatus !== "todos") {
        const pior = [d.wa_status, d.tarefas_status, d.fca_status].includes("critico") ? "critico"
          : [d.wa_status, d.tarefas_status, d.fca_status].includes("atencao") ? "atencao" : "ok";
        if (filtroStatus !== pior) return false;
      }
      return true;
    })
    .sort((a, b) => {
      const score = (s: SlaCliente) => (s.wa_status === "critico" ? 3 : s.wa_status === "atencao" ? 2 : 0)
        + (s.tarefas_status === "critico" ? 3 : s.tarefas_status === "atencao" ? 2 : 0)
        + (s.fca_status === "critico" ? 3 : s.fca_status === "atencao" ? 2 : 0);
      return score(b) - score(a);
    });
  }, [clientes, radar, fcas, tasks, alertas, filtroStatus, filtroSquad]);

  const resumo = useMemo(() => {
    let critico = 0, atencao = 0, ok = 0;
    for (const d of slaData) {
      const pior = [d.wa_status, d.tarefas_status, d.fca_status].includes("critico") ? "critico"
        : [d.wa_status, d.tarefas_status, d.fca_status].includes("atencao") ? "atencao" : "ok";
      if (pior === "critico") critico++;
      else if (pior === "atencao") atencao++;
      else ok++;
    }
    return { critico, atencao, ok };
  }, [slaData]);

  const squadsUnicos = useMemo(() => Array.from(new Set(clientes.map((c) => c.squad_nome).filter(Boolean))), [clientes]);

  const statusIcon = (s: "ok" | "atencao" | "critico") =>
    s === "ok" ? "🟢" : s === "atencao" ? "🟡" : "🔴";
  const statusColor = (s: "ok" | "atencao" | "critico") =>
    s === "ok" ? "text-emerald-400" : s === "atencao" ? "text-yellow-400" : "text-red-400";

  if (loading) return <p className="text-brand-muted">Carregando...</p>;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-3 gap-4">
        <button onClick={() => setFiltroStatus(filtroStatus === "ok" ? "todos" : "ok")} className={`rounded-lg border p-4 text-left ${filtroStatus === "ok" ? "border-emerald-500/40 bg-zinc-800" : "border-zinc-800 bg-zinc-900"}`}>
          <div className="text-zinc-400 text-xs uppercase">Em dia</div>
          <div className="text-2xl font-bold text-emerald-400 mt-1">{resumo.ok}</div>
        </button>
        <button onClick={() => setFiltroStatus(filtroStatus === "atencao" ? "todos" : "atencao")} className={`rounded-lg border p-4 text-left ${filtroStatus === "atencao" ? "border-yellow-500/40 bg-zinc-800" : "border-zinc-800 bg-zinc-900"}`}>
          <div className="text-zinc-400 text-xs uppercase">Atencao</div>
          <div className="text-2xl font-bold text-yellow-400 mt-1">{resumo.atencao}</div>
        </button>
        <button onClick={() => setFiltroStatus(filtroStatus === "critico" ? "todos" : "critico")} className={`rounded-lg border p-4 text-left ${filtroStatus === "critico" ? "border-red-500/40 bg-zinc-800" : "border-zinc-800 bg-zinc-900"}`}>
          <div className="text-zinc-400 text-xs uppercase">Critico</div>
          <div className="text-2xl font-bold text-red-400 mt-1">{resumo.critico}</div>
        </button>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <select className="bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700" value={filtroSquad} onChange={(e) => setFiltroSquad(e.target.value)}>
          <option value="todos">Todos os Squads</option>
          {squadsUnicos.map((s) => <option key={s} value={s!}>{s}</option>)}
        </select>
        {filtroStatus !== "todos" && <button className="text-xs text-zinc-400 hover:text-white" onClick={() => setFiltroStatus("todos")}>Limpar filtro</button>}
        <span className="text-zinc-500 text-sm ml-auto">{slaData.length} clientes</span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/60 text-zinc-400 text-left">
              <th className="px-4 py-3 font-medium">Cliente</th>
              <th className="px-4 py-3 font-medium">Coordenador</th>
              <th className="px-4 py-3 font-medium">Squad</th>
              <th className="px-4 py-3 font-medium text-center">WhatsApp</th>
              <th className="px-4 py-3 font-medium text-center">Tarefas</th>
              <th className="px-4 py-3 font-medium text-center">FCA</th>
              <th className="px-4 py-3 font-medium text-center">Alertas</th>
            </tr>
          </thead>
          <tbody>
            {slaData.map((d) => (
              <tr key={d.id} className="border-t border-zinc-800 hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3 text-white font-medium">{d.nome}</td>
                <td className="px-4 py-3 text-zinc-400">{d.coord ?? "-"}</td>
                <td className="px-4 py-3 text-zinc-400">{d.squad ?? "-"}</td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <span>{statusIcon(d.wa_status)}</span>
                    <span className={`text-xs ${statusColor(d.wa_status)}`}>
                      {d.wa_dias_sem_contato != null ? `${d.wa_dias_sem_contato}d` : "sem dados"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <span>{statusIcon(d.tarefas_status)}</span>
                    <span className={`text-xs ${statusColor(d.tarefas_status)}`}>
                      {d.tarefas_atrasadas > 0 ? `${d.tarefas_atrasadas} atrasadas` : `${d.tarefas_taxa}%`}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  <div className="flex flex-col items-center gap-0.5">
                    <span>{statusIcon(d.fca_status)}</span>
                    <span className={`text-xs ${statusColor(d.fca_status)}`}>
                      {d.fca_dias_desde_ultimo != null ? `${d.fca_dias_desde_ultimo}d atras` : "nunca"}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-center">
                  {d.alertas_hoje > 0 ? (
                    <span className="text-yellow-400 font-bold">{d.alertas_hoje}</span>
                  ) : <span className="text-zinc-600">0</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap gap-6 text-xs text-zinc-500">
        <div>🟢 WhatsApp: contato &le;3d | Tarefas: &le;2 atrasadas e &ge;70% | FCA: &le;7d</div>
        <div>🟡 WhatsApp: 3-7d | Tarefas: 3-5 atrasadas ou 50-70% | FCA: 7-14d</div>
        <div>🔴 WhatsApp: &gt;7d | Tarefas: &gt;5 atrasadas ou &lt;50% | FCA: &gt;14d ou nunca</div>
      </div>
    </div>
  );
}
