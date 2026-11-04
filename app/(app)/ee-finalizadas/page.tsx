"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { EeFinalizada, Pessoa, Squad } from "@/lib/types";
import { formatBRL, formatDate } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { ModalReativarEE, reativarEE } from "@/components/clientes/EeFinalizada";

type Convertido = {
  id: string; nome: string; mrr: number | null; account_id: string | null; squad_id: string | null;
  data_conversao_assessoria: string;
};

/** Histórico de clientes que terminaram a Estruturação Estratégica e não fecharam a assessoria.
 *  A baixa é dada na Carteira (🧭 E.E Finalizada). Não conta como churn. */
export default function EeFinalizadasPage() {
  const supabase = createClient();
  const { isGerente, isCoordenador, squadId: perfilSquadId } = useUsuarioPerfil();
  const [registros, setRegistros] = useState<EeFinalizada[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [reativando, setReativando] = useState<EeFinalizada | null>(null);
  const [convertidos, setConvertidos] = useState<Convertido[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [filterSquad, setFilterSquad] = useState("");
  const [ano, setAno] = useState(String(new Date().getFullYear()));
  const [search, setSearch] = useState("");

  async function load() {
    setLoading(true);
    const [{ data, error }, { data: sq }, { data: ps }, { data: cv }] = await Promise.all([
      supabase.from("ruston_ee_finalizadas").select("*").order("data_finalizacao", { ascending: false }),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      // Clientes que eram só E.E e viraram assessoria (tag E.E -> E.E + Assessoria)
      supabase.from("ruston_clientes").select("id, nome, mrr, account_id, squad_id, data_conversao_assessoria")
        .not("data_conversao_assessoria", "is", null).order("data_conversao_assessoria", { ascending: false }),
    ]);
    setConvertidos((cv ?? []) as Convertido[]);
    setErro(error ? error.message : null);
    setRegistros((data ?? []) as EeFinalizada[]);
    setSquads((sq ?? []) as Squad[]);
    setPessoas((ps ?? []) as Pessoa[]);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);


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

  const convertidosFiltrados = convertidos.filter((c) => {
    if (!isGerente && perfilSquadId && c.squad_id !== perfilSquadId) return false;
    if (filterSquad && c.squad_id !== filterSquad) return false;
    if (ano && !c.data_conversao_assessoria.startsWith(ano)) return false;
    const q = search.trim().toLowerCase();
    if (!q) return true;
    const gp = pessoas.find((p) => p.id === c.account_id)?.nome ?? "";
    return c.nome.toLowerCase().includes(q) || gp.toLowerCase().includes(q);
  });
  const mrrConvertido = convertidosFiltrados.reduce((s, c) => s + (Number(c.mrr) || 0), 0);
  // Conversão = quem fechou assessoria (na hora ou depois de finalizar) / todas as E.E que terminaram
  const fecharam = convertidosFiltrados.length + reativadas.length;
  const totalEe = fecharam + finalizadas.length;
  const taxaConversao = totalEe > 0 ? fecharam / totalEe : null;

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

      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="card">
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">Conversão E.E → Assessoria</p>
          <p className="mt-1 text-2xl font-bold text-emerald-300">{taxaConversao == null ? "—" : `${Math.round(taxaConversao * 100)}%`}</p>
          <p className="text-[10px] text-brand-muted">{fecharam} de {totalEe} E.E</p>
        </div>
        <div className="card">
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">Viraram assessoria</p>
          <p className="mt-1 text-2xl font-bold text-emerald-300">{convertidosFiltrados.length}</p>
          <p className="text-[10px] text-brand-muted">MRR {formatBRL(mrrConvertido)}</p>
        </div>
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

      {convertidosFiltrados.length > 0 && (
        <div className="mb-4 card overflow-x-auto p-0">
          <p className="px-4 pt-3 text-sm font-semibold text-emerald-300">Viraram assessoria</p>
          <p className="px-4 text-[11px] text-brand-muted">Registrado sozinho quando a tag do cliente muda de &quot;E.E&quot; para &quot;E.E + Assessoria&quot; na Carteira.</p>
          <table className="mt-2 w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="px-4 py-2">Cliente</th>
                <th className="px-4 py-2">Virou assessoria em</th>
                <th className="px-4 py-2">GP</th>
                <th className="px-4 py-2">Squad</th>
                <th className="px-4 py-2">MRR</th>
              </tr>
            </thead>
            <tbody>
              {convertidosFiltrados.map((c) => (
                <tr key={c.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-2 font-medium">{c.nome}</td>
                  <td className="px-4 py-2 text-brand-muted">{formatDate(c.data_conversao_assessoria)}</td>
                  <td className="px-4 py-2 text-brand-muted">{pessoas.find((p) => p.id === c.account_id)?.nome ?? "—"}</td>
                  <td className="px-4 py-2 text-brand-muted">{squads.find((s) => s.id === c.squad_id)?.nome ?? "—"}</td>
                  <td className="px-4 py-2 font-medium">{formatBRL(c.mrr)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
                    <button onClick={() => setReativando(r)} className="text-xs text-brand-muted hover:text-emerald-300"
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

      {reativando && reativando.cliente_id && (
        <ModalReativarEE
          registro={reativando}
          pessoas={pessoas}
          squads={squads}
          onFechar={() => setReativando(null)}
          onConfirmar={async (payload) => {
            const error = await reativarEE(supabase, reativando.id, reativando.cliente_id!, payload);
            if (error) return; // o AvisoErro já mostra a falha
            setReativando(null);
            load();
          }}
        />
      )}
    </div>
  );
}
