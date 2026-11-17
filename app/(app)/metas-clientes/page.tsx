"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClienteView, Squad } from "@/lib/types";
import { MESES_LABEL, formatBRL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

// Meta de leads e de faturamento de cada cliente, mês a mês, e o resultado obtido no fim do mês.
type MetaCliente = {
  id: string;
  cliente_id: string;
  ano: number;
  mes: number;
  meta_leads: number | null;
  meta_faturamento: number | null;
  resultado_leads: number | null;
  resultado_faturamento: number | null;
  observacoes: string | null;
  atualizado_por: string | null;
  updated_at: string;
};
type Campo = "meta_leads" | "meta_faturamento" | "resultado_leads" | "resultado_faturamento";
type Situacao = "sem_meta" | "meta_incompleta" | "aguardando_resultado" | "sem_resultado" | "completo";

const SITUACAO: Record<Situacao, { label: string; cor: string }> = {
  sem_meta: { label: "Sem meta", cor: "border-red-500/40 text-red-300" },
  meta_incompleta: { label: "Meta incompleta", cor: "border-amber-500/40 text-amber-300" },
  aguardando_resultado: { label: "Aguardando fim do mês", cor: "border-white/10 text-brand-muted" },
  sem_resultado: { label: "Falta resultado", cor: "border-red-500/40 text-red-300" },
  completo: { label: "Completo", cor: "border-emerald-500/40 text-emerald-300" },
};

/** "1.234,56" / "1234.56" / "1234,5" → número (vazio = null) */
function lerNumero(txt: string): number | null {
  const t = txt.replace(/[^\d,.-]/g, "");
  if (!t) return null;
  const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
  return Number.isFinite(n) ? n : null;
}

const pctAting = (meta: number | null, real: number | null) =>
  meta && meta > 0 && real != null ? (real / meta) * 100 : null;

const corPct = (p: number | null) =>
  p == null ? "text-brand-muted" : p >= 100 ? "text-emerald-300" : p >= 80 ? "text-amber-300" : "text-red-300";

export default function MetasClientesPage() {
  const supabase = createClient();
  const hoje = new Date();
  const { isGerente, squadId: perfilSquadId } = useUsuarioPerfil();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [metas, setMetas] = useState<MetaCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [filtroSquad, setFiltroSquad] = useState("");
  const [filtroGP, setFiltroGP] = useState("");
  const [filtroSit, setFiltroSit] = useState<Situacao | "pendentes" | "">("");

  // Mês já terminou? Só aí o resultado passa a ser cobrado
  const mesFechado = ano * 12 + mes < hoje.getFullYear() * 12 + hoje.getMonth() + 1;

  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: sq }, { data: mt, error }] = await Promise.all([
      supabase.from("ruston_clientes_view").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_cliente_metas_mensal").select("*").eq("ano", ano).eq("mes", mes),
    ]);
    setClientes(((cs as ClienteView[]) ?? []).filter((c) => !c.churn_realizado));
    setSquads((sq as Squad[]) ?? []);
    setMetas((mt as MetaCliente[]) ?? []);
    setErro(error ? `Não carregou as metas: ${error.message}` : null);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);

  const metaPorCliente = useMemo(() => new Map(metas.map((m) => [m.cliente_id, m])), [metas]);

  function situacao(m: MetaCliente | undefined): Situacao {
    const temLeads = m?.meta_leads != null;
    const temFat = m?.meta_faturamento != null;
    if (!temLeads && !temFat) return "sem_meta";
    if (!temLeads || !temFat) return "meta_incompleta";
    if (!mesFechado) return "aguardando_resultado";
    if (m?.resultado_leads == null || m?.resultado_faturamento == null) return "sem_resultado";
    return "completo";
  }
  const pendente = (s: Situacao) => s === "sem_meta" || s === "meta_incompleta" || s === "sem_resultado";

  // Coordenador/Investidor/GP: só o próprio squad (mesma regra da Carteira)
  const base = useMemo(() => clientes.filter((c) => isGerente || !perfilSquadId || c.squad_id === perfilSquadId),
    [clientes, isGerente, perfilSquadId]);

  const gps = useMemo(() => {
    const m = new Map<string, string>();
    base.forEach((c) => { if (c.account_id) m.set(c.account_id, c.account_nome ?? "—"); });
    return Array.from(m.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [base]);

  const linhas = useMemo(() => base
    .filter((c) => !filtroSquad || c.squad_id === filtroSquad)
    .filter((c) => !filtroGP || (filtroGP === "sem" ? !c.account_id : c.account_id === filtroGP))
    .map((c) => ({ c, m: metaPorCliente.get(c.id), s: situacao(metaPorCliente.get(c.id)) }))
    .filter((x) => !filtroSit || (filtroSit === "pendentes" ? pendente(x.s) : x.s === filtroSit)),
  // eslint-disable-next-line
  [base, filtroSquad, filtroGP, filtroSit, metaPorCliente, mesFechado]);

  // Placar da cobrança: pendências por GP
  const porGP = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; pend: number }>();
    base.filter((c) => !filtroSquad || c.squad_id === filtroSquad).forEach((c) => {
      const k = c.account_id ?? "sem";
      const it = m.get(k) ?? { nome: c.account_nome ?? "Sem GP", total: 0, pend: 0 };
      it.total++;
      if (pendente(situacao(metaPorCliente.get(c.id)))) it.pend++;
      m.set(k, it);
    });
    return Array.from(m.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.pend - a.pend || a.nome.localeCompare(b.nome));
  // eslint-disable-next-line
  }, [base, filtroSquad, metaPorCliente, mesFechado]);

  const totais = useMemo(() => {
    const doFiltro = linhas;
    const soma = (f: (m: MetaCliente) => number | null) =>
      doFiltro.reduce((t, x) => t + (x.m ? Number(f(x.m) ?? 0) : 0), 0);
    return {
      metaLeads: soma((m) => m.meta_leads), realLeads: soma((m) => m.resultado_leads),
      metaFat: soma((m) => m.meta_faturamento), realFat: soma((m) => m.resultado_faturamento),
      comMeta: doFiltro.filter((x) => x.s !== "sem_meta" && x.s !== "meta_incompleta").length,
      pend: doFiltro.filter((x) => pendente(x.s)).length,
    };
  // eslint-disable-next-line
  }, [linhas]);

  async function salvar(c: ClienteView, campo: Campo, texto: string) {
    const atual = metaPorCliente.get(c.id);
    const valor = lerNumero(texto);
    if (texto.trim() && valor == null) { setErro("Valor inválido."); return; }
    const v = valor == null ? null : campo.endsWith("leads") ? Math.round(valor) : valor;
    if ((atual?.[campo] ?? null) === v) return;
    setSalvando(`${c.id}:${campo}`);
    setErro(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("ruston_cliente_metas_mensal")
      .upsert({
        cliente_id: c.id, ano, mes, [campo]: v,
        atualizado_por: user?.email ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: "cliente_id,ano,mes" })
      .select().single();
    setSalvando(null);
    if (error || !data) { setErro(`Não salvou (${c.nome}): ${error?.message ?? "erro"}`); return; }
    setMetas((lista) => [...lista.filter((m) => m.cliente_id !== c.id), data as MetaCliente]);
  }

  const anos = [hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1];
  const fmtN = (n: number) => n.toLocaleString("pt-BR");
  const fmtPct = (p: number | null) => (p == null ? "—" : `${p.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`);

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Metas dos Clientes</h1>
          <p className="text-sm text-brand-muted">
            No início do mês: meta de leads e de faturamento de cada cliente · No fim do mês: o resultado obtido
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input max-w-[150px]" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES_LABEL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>
      </div>

      {/* Indicadores */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clientes com meta" valor={`${totais.comMeta} / ${linhas.length}`}
          sub={totais.pend > 0 ? `${totais.pend} pendente${totais.pend > 1 ? "s" : ""}` : "nenhuma pendência"}
          cor={totais.pend > 0 ? "text-amber-300" : "text-emerald-300"} />
        <Stat label="Leads · resultado / meta" valor={`${fmtN(totais.realLeads)} / ${fmtN(totais.metaLeads)}`}
          sub={`atingimento ${fmtPct(pctAting(totais.metaLeads, totais.realLeads))}`} />
        <Stat label="Faturamento · resultado" valor={formatBRL(totais.realFat)}
          sub={`meta ${formatBRL(totais.metaFat)} · ${fmtPct(pctAting(totais.metaFat, totais.realFat))}`} />
        <Stat label="Situação do mês" valor={mesFechado ? "Mês fechado" : "Mês em andamento"}
          sub={mesFechado ? "cobrando meta e resultado" : "cobrando a meta; resultado no fim do mês"} />
      </div>

      {/* Cobrança por GP */}
      <div className="mb-6">
        <p className="mb-2 text-sm font-semibold">Pendências por GP</p>
        <div className="flex flex-wrap gap-2">
          {porGP.map((g) => (
            <button key={g.id}
              onClick={() => { setFiltroGP(filtroGP === g.id ? "" : g.id); setFiltroSit(g.pend ? "pendentes" : ""); }}
              className={`card px-3 py-2 text-left text-xs transition hover:border-white/30 ${filtroGP === g.id ? "border-white/40" : ""}`}>
              <p className="font-medium">{g.nome}</p>
              <p className={g.pend ? "text-red-300" : "text-emerald-300"}>
                {g.pend ? `${g.pend} de ${g.total} pendente${g.pend > 1 ? "s" : ""}` : `✓ ${g.total} em dia`}
              </p>
            </button>
          ))}
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {isGerente && (
          <select className="input max-w-[180px]" value={filtroSquad} onChange={(e) => setFiltroSquad(e.target.value)}>
            <option value="">Todos os squads</option>
            {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        )}
        <select className="input max-w-[220px]" value={filtroGP} onChange={(e) => setFiltroGP(e.target.value)}>
          <option value="">Todos os GPs</option>
          {gps.map(([id, nome]) => <option key={id} value={id}>{nome}</option>)}
          <option value="sem">Sem GP</option>
        </select>
        <select className="input max-w-[220px]" value={filtroSit} onChange={(e) => setFiltroSit(e.target.value as typeof filtroSit)}>
          <option value="">Todas as situações</option>
          <option value="pendentes">Só pendentes</option>
          {(Object.keys(SITUACAO) as Situacao[]).map((s) => <option key={s} value={s}>{SITUACAO[s].label}</option>)}
        </select>
        {salvando && <span className="text-xs text-brand-muted">Salvando...</span>}
      </div>

      {erro && <p className="mb-3 text-sm text-red-300">{erro}</p>}
      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="px-3 py-3">Cliente</th>
                <th className="px-3 py-3">Meta leads</th>
                <th className="px-3 py-3">Resultado leads</th>
                <th className="px-3 py-3">%</th>
                <th className="px-3 py-3">Meta faturamento</th>
                <th className="px-3 py-3">Resultado faturamento</th>
                <th className="px-3 py-3">%</th>
                <th className="px-3 py-3">Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-brand-muted">Nenhum cliente nesse filtro.</td></tr>
              )}
              {linhas.map(({ c, m, s }) => {
                const pL = pctAting(m?.meta_leads ?? null, m?.resultado_leads ?? null);
                const pF = pctAting(m?.meta_faturamento ?? null, m?.resultado_faturamento ?? null);
                return (
                  <tr key={c.id} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2">
                      <p className="font-medium">{c.nome}</p>
                      <p className="text-[10px] text-brand-muted">
                        {[c.squad_nome, c.account_nome ? `GP: ${c.account_nome}` : "sem GP"].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="px-3 py-2"><CampoNum key={`${c.id}ml${m?.meta_leads}`} valor={m?.meta_leads} onSalvar={(t) => salvar(c, "meta_leads", t)} /></td>
                    <td className="px-3 py-2"><CampoNum key={`${c.id}rl${m?.resultado_leads}`} valor={m?.resultado_leads} onSalvar={(t) => salvar(c, "resultado_leads", t)} /></td>
                    <td className={`px-3 py-2 font-semibold ${corPct(pL)}`}>{fmtPct(pL)}</td>
                    <td className="px-3 py-2"><CampoNum key={`${c.id}mf${m?.meta_faturamento}`} valor={m?.meta_faturamento} dinheiro onSalvar={(t) => salvar(c, "meta_faturamento", t)} /></td>
                    <td className="px-3 py-2"><CampoNum key={`${c.id}rf${m?.resultado_faturamento}`} valor={m?.resultado_faturamento} dinheiro onSalvar={(t) => salvar(c, "resultado_faturamento", t)} /></td>
                    <td className={`px-3 py-2 font-semibold ${corPct(pF)}`}>{fmtPct(pF)}</td>
                    <td className="px-3 py-2">
                      <span className={`badge ${SITUACAO[s].cor}`}>{SITUACAO[s].label}</span>
                      {m?.atualizado_por && (
                        <p className="mt-1 text-[10px] text-brand-muted">
                          {m.atualizado_por.split("@")[0]} · {new Date(m.updated_at).toLocaleDateString("pt-BR")}
                        </p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Campo editável: salva ao sair do campo ou apertar Enter */
function CampoNum({ valor, dinheiro, onSalvar }: { valor: number | null | undefined; dinheiro?: boolean; onSalvar: (t: string) => void }) {
  const inicial = valor == null ? "" : dinheiro
    ? Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(valor);
  const [txt, setTxt] = useState(inicial);
  return (
    <input
      className={`input py-1 text-sm ${dinheiro ? "w-32" : "w-20"}`}
      inputMode="decimal"
      placeholder={dinheiro ? "R$ 0,00" : "0"}
      value={txt}
      onChange={(e) => setTxt(e.target.value)}
      onBlur={() => { if (txt !== inicial) onSalvar(txt); }}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
    />
  );
}

function Stat({ label, valor, cor, sub }: { label: string; valor: string; cor?: string; sub?: string }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${cor ?? ""}`}>{valor}</p>
      {sub && <p className="text-[10px] text-brand-muted">{sub}</p>}
    </div>
  );
}
