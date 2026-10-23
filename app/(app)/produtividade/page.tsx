"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Task = {
  id: number;
  pessoa_id: string | null;
  pessoa_nome: string | null;
  pessoa_cargo: string | null;
  current_due_date: string | null;
  resolved_date: string | null;
  situation: number;
  esta_atrasada: boolean;
  foi_prorrogada: boolean;
  workspace: string | null;
  cliente_nome: string | null;
};

type Pessoa = { id: string; nome: string; cargo: string | null; squad_id: string | null };
type Squad = { id: string; nome: string };

type WaMsg = {
  conversa_id: string;
  autor_numero: string | null;
  de_mim: boolean;
  enviada_em: string;
};

type Periodo = "7d" | "30d" | "90d" | "mes" | "mes_passado";
const PERIODO_LABEL: Record<Periodo, string> = {
  "7d": "Ultimos 7 dias",
  "30d": "Ultimos 30 dias",
  "90d": "Ultimos 90 dias",
  mes: "Mes atual",
  mes_passado: "Mes passado",
};

function getDataInicio(p: Periodo): string {
  const now = new Date();
  if (p === "7d") return new Date(now.getTime() - 7 * 86400000).toISOString();
  if (p === "30d") return new Date(now.getTime() - 30 * 86400000).toISOString();
  if (p === "90d") return new Date(now.getTime() - 90 * 86400000).toISOString();
  if (p === "mes") return new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  // mes_passado
  return new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString();
}

function getDataFim(p: Periodo): string | null {
  if (p !== "mes_passado") return null;
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59).toISOString();
}

// situation: 10=aberta, 20=em andamento, 30=concluida, 40=cancelada
function statusLabel(s: number): string {
  if (s === 10) return "Aberta";
  if (s === 20) return "Em andamento";
  if (s === 30) return "Concluida";
  if (s === 40) return "Cancelada";
  return "Outro";
}

type PessoaStats = {
  pessoa_id: string;
  nome: string;
  cargo: string | null;
  squad_nome: string | null;
  total: number;
  concluidas: number;
  em_andamento: number;
  abertas: number;
  atrasadas: number;
  prorrogadas: number;
  taxa_cumprimento: number;
  tempo_medio_resposta_min: number | null;
};

export default function ProdutividadePage() {
  const supabase = createClient();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [waMsgs, setWaMsgs] = useState<WaMsg[]>([]);
  const [loading, setLoading] = useState(true);
  const [periodo, setPeriodo] = useState<Periodo>("30d");
  const [filtroSquad, setFiltroSquad] = useState<string>("todos");
  const [filtroCargo, setFiltroCargo] = useState<string>("todos");
  const [ordenar, setOrdenar] = useState<"taxa" | "concluidas" | "atrasadas" | "resposta">("taxa");

  useEffect(() => {
    async function load() {
      setLoading(true);
      const inicio = getDataInicio(periodo);
      const fim = getDataFim(periodo);

      let taskQuery = supabase
        // Só investidores ativos (quem saiu ou não tem vínculo fica de fora)
        .from("ruston_ekyte_tasks_dashboard")
        .select("id, pessoa_id, pessoa_nome, pessoa_cargo, current_due_date, resolved_date, situation, esta_atrasada, foi_prorrogada, workspace, cliente_nome")
        .eq("pessoa_ativa", true)
        .not("executor_email", "ilike", "%@gmail.com") // e-mail pessoal não conta
        .gte("creation_date", inicio);
      if (fim) taskQuery = taskQuery.lte("creation_date", fim);

      const [{ data: t }, { data: p }, { data: s }, { data: wa }] = await Promise.all([
        taskQuery,
        supabase.from("ruston_pessoas").select("id, nome, cargo, squad_id").eq("ativo", true),
        supabase.from("ruston_squads").select("id, nome").eq("ativo", true),
        supabase.from("ruston_whatsapp_mensagens")
          .select("conversa_id, autor_numero, de_mim, enviada_em")
          .gte("enviada_em", inicio)
          .order("enviada_em", { ascending: true })
          .limit(10000),
      ]);

      setTasks((t ?? []) as Task[]);
      setPessoas((p ?? []) as Pessoa[]);
      setSquads((s ?? []) as Squad[]);
      setWaMsgs((wa ?? []) as WaMsg[]);
      setLoading(false);
    }
    load();
  }, [periodo]);

  const stats = useMemo<PessoaStats[]>(() => {
    const squadMap = Object.fromEntries(squads.map((s) => [s.id, s.nome]));
    const pessoaMap = Object.fromEntries(pessoas.map((p) => [p.id, p]));

    // Calcular tempo medio de resposta por conversa
    // Agrupa msgs por conversa, ordena por tempo, mede gap entre msg cliente e resposta ruston
    const temposPorPessoa: Record<string, number[]> = {};
    const msgsPorConversa: Record<string, WaMsg[]> = {};
    for (const m of waMsgs) {
      if (!msgsPorConversa[m.conversa_id]) msgsPorConversa[m.conversa_id] = [];
      msgsPorConversa[m.conversa_id].push(m);
    }
    for (const msgs of Object.values(msgsPorConversa)) {
      for (let i = 0; i < msgs.length; i++) {
        if (!msgs[i].de_mim) {
          // msg do cliente — busca proxima resposta ruston
          for (let j = i + 1; j < msgs.length; j++) {
            if (msgs[j].de_mim) {
              const diff = (new Date(msgs[j].enviada_em).getTime() - new Date(msgs[i].enviada_em).getTime()) / 60000;
              if (diff > 0 && diff < 1440) {
                // Vincula ao autor da resposta se possivel
                const autorNum = msgs[j].autor_numero;
                if (autorNum) {
                  const pessoa = pessoas.find((p) => (p as any).whatsapp && String((p as any).whatsapp).includes(autorNum.slice(-10)));
                  if (pessoa) {
                    if (!temposPorPessoa[pessoa.id]) temposPorPessoa[pessoa.id] = [];
                    temposPorPessoa[pessoa.id].push(diff);
                  }
                }
              }
              break;
            }
          }
        }
      }
    }

    const map: Record<string, PessoaStats> = {};
    for (const task of tasks) {
      if (!task.pessoa_id) continue;
      if (!map[task.pessoa_id]) {
        const p = pessoaMap[task.pessoa_id];
        map[task.pessoa_id] = {
          pessoa_id: task.pessoa_id,
          nome: p?.nome ?? task.pessoa_nome ?? "?",
          cargo: p?.cargo ?? task.pessoa_cargo,
          squad_nome: p?.squad_id ? squadMap[p.squad_id] ?? null : null,
          total: 0, concluidas: 0, em_andamento: 0, abertas: 0,
          atrasadas: 0, prorrogadas: 0, taxa_cumprimento: 0,
          tempo_medio_resposta_min: null,
        };
      }
      const s = map[task.pessoa_id];
      s.total++;
      if (task.situation === 30) s.concluidas++;
      else if (task.situation === 20) s.em_andamento++;
      else if (task.situation === 10) s.abertas++;
      if (task.esta_atrasada) s.atrasadas++;
      if (task.foi_prorrogada) s.prorrogadas++;
    }

    return Object.values(map).map((s) => {
      const finalizadas = s.concluidas + s.atrasadas;
      s.taxa_cumprimento = finalizadas > 0 ? Math.round((s.concluidas / (s.concluidas + s.atrasadas)) * 100) : 0;
      const tempos = temposPorPessoa[s.pessoa_id];
      s.tempo_medio_resposta_min = tempos && tempos.length > 0
        ? Math.round(tempos.reduce((a, b) => a + b, 0) / tempos.length)
        : null;
      return s;
    }).filter((s) => {
      if (filtroSquad !== "todos" && s.squad_nome !== filtroSquad) return false;
      if (filtroCargo !== "todos" && s.cargo !== filtroCargo) return false;
      return true;
    }).sort((a, b) => {
      if (ordenar === "taxa") return b.taxa_cumprimento - a.taxa_cumprimento;
      if (ordenar === "concluidas") return b.concluidas - a.concluidas;
      if (ordenar === "atrasadas") return b.atrasadas - a.atrasadas;
      if (ordenar === "resposta") return (a.tempo_medio_resposta_min ?? 9999) - (b.tempo_medio_resposta_min ?? 9999);
      return 0;
    });
  }, [tasks, pessoas, squads, waMsgs, filtroSquad, filtroCargo, ordenar]);

  const totais = useMemo(() => {
    const t = { total: 0, concluidas: 0, atrasadas: 0, em_andamento: 0, abertas: 0 };
    for (const s of stats) {
      t.total += s.total;
      t.concluidas += s.concluidas;
      t.atrasadas += s.atrasadas;
      t.em_andamento += s.em_andamento;
      t.abertas += s.abertas;
    }
    return t;
  }, [stats]);

  const cargosUnicos = useMemo(() => Array.from(new Set(stats.map((s) => s.cargo).filter(Boolean))), [stats]);
  const squadsUnicos = useMemo(() => Array.from(new Set(stats.map((s) => s.squad_nome).filter(Boolean))), [stats]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-zinc-400 text-lg">Carregando produtividade...</div>
      </div>
    );
  }

  return (
    <div className="p-6 max-w-[1600px] mx-auto space-y-6">
      <h1 className="text-2xl font-bold text-white">Produtividade do Time</h1>

      {/* Cards resumo */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card label="Total Tarefas" value={totais.total} color="text-white" />
        <Card label="Concluidas" value={totais.concluidas} color="text-emerald-400" />
        <Card label="Em Andamento" value={totais.em_andamento} color="text-blue-400" />
        <Card label="Abertas" value={totais.abertas} color="text-yellow-400" />
        <Card label="Atrasadas" value={totais.atrasadas} color="text-red-400" />
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap gap-3 items-center">
        <select
          className="bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value as Periodo)}
        >
          {Object.entries(PERIODO_LABEL).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <select
          className="bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
          value={filtroSquad}
          onChange={(e) => setFiltroSquad(e.target.value)}
        >
          <option value="todos">Todos os Squads</option>
          {squadsUnicos.map((s) => (
            <option key={s} value={s!}>{s}</option>
          ))}
        </select>

        <select
          className="bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
          value={filtroCargo}
          onChange={(e) => setFiltroCargo(e.target.value)}
        >
          <option value="todos">Todos os Cargos</option>
          {cargosUnicos.map((c) => (
            <option key={c} value={c!}>{c}</option>
          ))}
        </select>

        <select
          className="bg-zinc-800 text-zinc-200 rounded px-3 py-2 text-sm border border-zinc-700"
          value={ordenar}
          onChange={(e) => setOrdenar(e.target.value as any)}
        >
          <option value="taxa">Ordenar: Taxa de Cumprimento</option>
          <option value="concluidas">Ordenar: Mais Concluidas</option>
          <option value="atrasadas">Ordenar: Mais Atrasadas</option>
          <option value="resposta">Ordenar: Tempo de Resposta</option>
        </select>

        <span className="text-zinc-500 text-sm ml-auto">{stats.length} pessoas</span>
      </div>

      {/* Tabela */}
      <div className="overflow-x-auto rounded-lg border border-zinc-800">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-zinc-800/60 text-zinc-400 text-left">
              <th className="px-4 py-3 font-medium">#</th>
              <th className="px-4 py-3 font-medium">Pessoa</th>
              <th className="px-4 py-3 font-medium">Cargo</th>
              <th className="px-4 py-3 font-medium">Squad</th>
              <th className="px-4 py-3 font-medium text-center">Total</th>
              <th className="px-4 py-3 font-medium text-center">Concluidas</th>
              <th className="px-4 py-3 font-medium text-center">Andamento</th>
              <th className="px-4 py-3 font-medium text-center">Atrasadas</th>
              <th className="px-4 py-3 font-medium text-center">Prorrogadas</th>
              <th className="px-4 py-3 font-medium text-center">Taxa Prazo</th>
              <th className="px-4 py-3 font-medium text-center">Resp. WhatsApp</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((s, i) => (
              <tr key={s.pessoa_id} className="border-t border-zinc-800 hover:bg-zinc-800/30 transition-colors">
                <td className="px-4 py-3 text-zinc-500">{i + 1}</td>
                <td className="px-4 py-3 text-white font-medium">{s.nome}</td>
                <td className="px-4 py-3 text-zinc-400 capitalize">{(s.cargo ?? "-").replace(/_/g, " ")}</td>
                <td className="px-4 py-3 text-zinc-400">{s.squad_nome ?? "-"}</td>
                <td className="px-4 py-3 text-center text-zinc-300">{s.total}</td>
                <td className="px-4 py-3 text-center text-emerald-400 font-medium">{s.concluidas}</td>
                <td className="px-4 py-3 text-center text-blue-400">{s.em_andamento}</td>
                <td className="px-4 py-3 text-center text-red-400 font-medium">{s.atrasadas}</td>
                <td className="px-4 py-3 text-center text-yellow-400">{s.prorrogadas}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`font-bold ${s.taxa_cumprimento >= 80 ? "text-emerald-400" : s.taxa_cumprimento >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                    {s.taxa_cumprimento}%
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {s.tempo_medio_resposta_min !== null ? (
                    <span className={`font-medium ${s.tempo_medio_resposta_min <= 30 ? "text-emerald-400" : s.tempo_medio_resposta_min <= 60 ? "text-yellow-400" : "text-red-400"}`}>
                      {s.tempo_medio_resposta_min} min
                    </span>
                  ) : (
                    <span className="text-zinc-600">-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Ranking por Squad */}
      <h2 className="text-lg font-semibold text-white mt-8">Ranking por Squad</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {squads.map((sq) => {
          const membros = stats.filter((s) => s.squad_nome === sq.nome);
          const totalTarefas = membros.reduce((a, b) => a + b.total, 0);
          const totalConcluidas = membros.reduce((a, b) => a + b.concluidas, 0);
          const totalAtrasadas = membros.reduce((a, b) => a + b.atrasadas, 0);
          const taxa = totalConcluidas + totalAtrasadas > 0
            ? Math.round((totalConcluidas / (totalConcluidas + totalAtrasadas)) * 100)
            : 0;
          return (
            <div key={sq.id} className="bg-zinc-900 border border-zinc-800 rounded-lg p-4 space-y-2">
              <h3 className="text-white font-bold text-base">{sq.nome}</h3>
              <div className="text-zinc-400 text-sm">{membros.length} pessoas</div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Tarefas:</span>
                <span className="text-zinc-200 font-medium">{totalTarefas}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Concluidas:</span>
                <span className="text-emerald-400 font-medium">{totalConcluidas}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Atrasadas:</span>
                <span className="text-red-400 font-medium">{totalAtrasadas}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-zinc-400">Taxa prazo:</span>
                <span className={`font-bold ${taxa >= 80 ? "text-emerald-400" : taxa >= 50 ? "text-yellow-400" : "text-red-400"}`}>
                  {taxa}%
                </span>
              </div>
              {/* Barra visual */}
              <div className="w-full h-2 bg-zinc-800 rounded-full overflow-hidden mt-1">
                <div
                  className={`h-full rounded-full ${taxa >= 80 ? "bg-emerald-500" : taxa >= 50 ? "bg-yellow-500" : "bg-red-500"}`}
                  style={{ width: `${taxa}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Card({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-lg p-4">
      <div className="text-zinc-400 text-xs uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{value.toLocaleString("pt-BR")}</div>
    </div>
  );
}
