"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EeFinalizada, Squad } from "@/lib/types";
import { formatBRL, formatDate } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { reativarEE } from "@/components/clientes/EeFinalizada";

/** Histórico de clientes que terminaram a Estruturação Estratégica e não fecharam a assessoria.
 *  A baixa é dada na Carteira (🧭 E.E Finalizada). Não conta como churn. */
export default function EeFinalizadasPage() {
  const supabase = createClient();
  const { isGerente, isCoordenador, squadId: perfilSquadId } = useUsuarioPerfil();
  const [registros, setRegistros] = useState<EeFinalizada[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filterSquad, setFilterSquad] = useState("");
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const [{ data, error }, { data: sq }] = await Promise.all([
      supabase.from("ruston_ee_finalizadas").select("*").order("data_finalizacao", { ascending: false }),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
    ]);
    setErro(error ? error.message : null);
    setRegistros((data ?? []) as EeFinalizada[]);
    setSquads((sq ?? []) as Squad[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  async function reativar(r: EeFinalizada) {
    if (!r.cliente_id) return;
    if (!confirm(`${r.cliente_nome} fechou a assessoria? O cliente volta para a carteira do GP.`)) return;
    const error = await reativarEE(supabase, r.id, r.cliente_id);
    if (!error) load();
  }

  const anos = useMemo(() => {
    const set = new Set(registros.map((r) => r.data_finalizacao.slice(0, 4)));
    set.add(String(new Date().getFullYear()));
    return Array.from(set).sort().reverse();
  }, [registros]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return registros.filter((r) => {
      // Coordenador/Investidor: só vê o próprio squad
      if (!isGerente && perfilSquadId && r.squad_id !== perfilSquadId) return false;
      if (filterSquad && r.squad_id !== filterSquad) return false;
      if (ano && !r.data_finalizacao.startsWith(ano)) return false;
      if (!q) return true;
      return r.cliente_nome.toLowerCase().includes(q) || (r.gp_nome ?? "").toLowerCase().includes(q);
    });
  }, [registros, search, filterSquad, ano, isGerente, perfilSquadId]);

  const finalizadas = filtered.filter((r) => !r.reativado_em);
  const reativadas = filtered.filter((r) => r.reativado_em);
  const mrrNaoConvertido = finalizadas.reduce((s, r) => s + (Number(r.mrr) || 0), 0);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🧭 E.E Finalizada</h1>
          <p className="text-sm text-brand-muted">
            Clientes que terminaram a Estruturação Estratégica e não fecharam a assessoria. Não contam como churn.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input max-w-[110px]" value={ano} onChange={(e) => setAno(e.target.value)}>
            <option value="">Todos</option>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          {isGerente && (
            <select className="input max-w-[180px]" value={filterSquad} onChange={(e) => setFilterSquad(e.target.value)}>
              <option value="">Todos os squads</option>
              {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          )}
          <input className="input max-w-xs" placeholder="Buscar cliente ou GP..."
            value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="card">
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">E.E finalizadas sem assessoria</p>
          <p className="mt-1 text-2xl font-bold text-sky-300">{finalizadas.length}</p>
        </div>
        <div className="card">
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">MRR que não virou assessoria</p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{formatBRL(mrrNaoConvertido)}</p>
        </div>
        <div className="card">
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">Fecharam depois (reativados)</p>
          <p className="mt-1 text-2xl font-bold text-emerald-300">{reativadas.length}</p>
        </div>
      </div>

      {erro && (
        <div className="mb-4 card border border-red-500/40 bg-red-500/5 text-sm text-red-300">
          Não foi possível carregar o histórico: {erro}
        </div>
      )}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Finalizada em</th>
              <th className="px-4 py-3">GP</th>
              <th className="px-4 py-3">Squad</th>
              <th className="px-4 py-3">MRR</th>
              <th className="px-4 py-3">Motivo</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-brand-muted">Carregando...</td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-brand-muted">
                Nenhuma E.E finalizada. Para dar baixa, use o botão 🧭 no cliente, na Carteira.
              </td></tr>
            )}
            {!loading && filtered.map((r) => (
              <tr key={r.id} className="border-b border-white/5 last:border-0 align-top">
                <td className="px-4 py-3">
                  <p className="font-medium">{r.cliente_nome}</p>
                  {r.coordenador_nome && <p className="text-[10px] text-brand-muted">Coord. {r.coordenador_nome}</p>}
                </td>
                <td className="px-4 py-3 text-brand-muted">{formatDate(r.data_finalizacao)}</td>
                <td className="px-4 py-3 text-brand-muted">{r.gp_nome ?? "—"}</td>
                <td className="px-4 py-3 text-brand-muted">{r.squad_nome ?? "—"}</td>
                <td className="px-4 py-3 font-medium">{formatBRL(r.mrr)}</td>
                <td className="px-4 py-3 text-xs text-brand-muted max-w-xs">
                  <p>{r.motivo ?? "—"}</p>
                  {r.observacoes && <p className="mt-1 italic">{r.observacoes}</p>}
                </td>
                <td className="px-4 py-3">
                  {r.reativado_em ? (
                    <span className="badge bg-emerald-500/15 text-emerald-300 border-emerald-500/30">
                      ✓ Fechou · {formatDate(r.reativado_em.slice(0, 10))}
                    </span>
                  ) : (
                    <span className="badge bg-sky-500/15 text-sky-300 border-sky-500/30">E.E finalizada</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  {!r.reativado_em && r.cliente_id && (isGerente || isCoordenador) && (
                    <button onClick={() => reativar(r)} className="text-xs text-brand-muted hover:text-emerald-300"
                      title="O cliente fechou a assessoria: volta para a carteira">
                      reativar
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
