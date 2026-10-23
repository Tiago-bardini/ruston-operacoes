"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatBRL } from "@/lib/types";
import { avaliarRiscoChurn, carregarDadosRadar, type AvaliacaoRisco, type DadosClienteRadar } from "@/lib/radarChurn";
import { inicioJanelaEkyte } from "@/lib/ekyteJanela";

type ClienteBase = {
  id: string; nome: string; etapa: string; mrr: number | null;
  coordenador_nome: string | null; squad_nome: string | null; ativo: boolean;
};
type AlertaRow = { id: string; tipo: string; cliente_id: string; detalhes: string; criado_em: string };
type TaskAgg = { pessoa_nome: string; pessoa_cargo: string | null; total: number; atrasadas: number };

export default function PainelGerente() {
  const supabase = createClient();
  const [clientes, setClientes] = useState<ClienteBase[]>([]);
  // Mesmo cálculo do Radar de Churn (Saúde da Carteira)
  const [riscos, setRiscos] = useState<(DadosClienteRadar & { av: AvaliacaoRisco })[]>([]);
  const [alertas, setAlertas] = useState<AlertaRow[]>([]);
  const [taskAgg, setTaskAgg] = useState<TaskAgg[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const hoje = new Date().toISOString().slice(0, 10);
      const [{ data: c }, dadosRadar, { data: a }, { data: t }] = await Promise.all([
        supabase.from("ruston_clientes_view").select("id, nome, etapa, mrr, coordenador_nome, squad_nome, ativo").eq("ativo", true),
        carregarDadosRadar(supabase),
        supabase.from("ruston_whatsapp_alertas").select("id, tipo, cliente_id, detalhes, criado_em").gte("criado_em", hoje + "T00:00:00").order("criado_em", { ascending: false }).limit(20),
        supabase.from("ruston_ekyte_tasks_dashboard").select("pessoa_nome, pessoa_cargo, situation, esta_atrasada").eq("pessoa_ativa", true).gte("creation_date", inicioJanelaEkyte()).not("pessoa_id", "is", null),
      ]);
      setClientes((c ?? []) as ClienteBase[]);
      setRiscos(dadosRadar.map((d) => ({ ...d, av: avaliarRiscoChurn(d) })));
      setAlertas((a ?? []) as AlertaRow[]);

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

  const clientesRisco = useMemo(() => riscos
    .filter((r) => r.av.nivel === "critico" || r.av.nivel === "atencao")
    .sort((a, b) => (a.av.nivel === b.av.nivel ? 0 : a.av.nivel === "critico" ? -1 : 1) || b.av.risco - a.av.risco)
    .slice(0, 10), [riscos]);

  const coordPendencias = useMemo(() => {
    return taskAgg.filter((t) => t.atrasadas > 0).sort((a, b) => b.atrasadas - a.atrasadas).slice(0, 10);
  }, [taskAgg]);

  const mrrInfo = useMemo(() => {
    const total = clientes.reduce((a, c) => a + (c.mrr ?? 0), 0);
    // Crítico + atenção, igual ao topo do Radar de Churn
    const emRisco = riscos.filter((r) => r.av.nivel === "critico" || r.av.nivel === "atencao")
      .reduce((a, r) => a + (Number(r.cliente.mrr) || 0), 0);
    return { total, emRisco };
  }, [clientes, riscos]);

  if (loading) {
    return <p className="text-brand-muted">Carregando...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card label="MRR Total" value={formatBRL(mrrInfo.total)} color="text-white" />
        <Card label="MRR em Risco" value={formatBRL(mrrInfo.emRisco)} color={mrrInfo.emRisco > 0 ? "text-red-400" : "text-emerald-400"} sub={mrrInfo.total > 0 ? `${Math.round((mrrInfo.emRisco / mrrInfo.total) * 100)}% do total` : ""} />
        <Card label="Clientes Ativos" value={String(clientes.filter((c) => c.etapa !== "cancelado" && c.etapa !== "suspenso").length)} color="text-blue-400" />
        <Card label="Alertas Hoje" value={String(alertas.length)} color={alertas.length > 0 ? "text-yellow-400" : "text-emerald-400"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Clientes em Risco</h2>
            <a href="/health-score" className="text-xs text-zinc-400 hover:text-white">Radar de Churn →</a>
          </div>
          <div className="space-y-2">
            {clientesRisco.map(({ cliente: c, av }) => (
              <div key={c.id} className="flex items-center gap-3 p-2 rounded-md hover:bg-zinc-800/50">
                <div className={`w-9 h-9 shrink-0 rounded-full flex items-center justify-center text-xs font-bold border ${
                  av.nivel === "critico" ? "text-red-400 border-red-500/40" : "text-yellow-400 border-yellow-500/40"
                }`}>{av.risco}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-white text-sm font-medium truncate">{c.nome}</div>
                  <div className="text-zinc-500 text-xs truncate">{av.sinais[0]?.texto ?? "—"}</div>
                </div>
                <div className="text-right text-xs">
                  <div className="text-zinc-300">{c.mrr ? formatBRL(c.mrr) : "-"}</div>
                  <div className={av.nivel === "critico" ? "text-red-400" : "text-yellow-400"}>{av.nivel === "critico" ? "Crítico" : "Atenção"}</div>
                </div>
              </div>
            ))}
            {clientesRisco.length === 0 && <div className="text-zinc-500 text-sm">Nenhum cliente em risco</div>}
          </div>
        </div>

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

      {alertas.length > 0 && (
        <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
          <h2 className="text-lg font-semibold text-white mb-3">Alertas de Hoje</h2>
          <div className="space-y-2">
            {alertas.map((a) => (
              <div key={a.id} className="flex items-center gap-3 p-2 rounded-md bg-zinc-800/30 text-sm">
                <span className="text-lg">{a.tipo === "sla_30min" ? "⏰" : a.tipo === "grupo_mudo" ? "🔕" : "🚫"}</span>
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
