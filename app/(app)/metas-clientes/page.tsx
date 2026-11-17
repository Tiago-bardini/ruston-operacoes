"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClienteView, Squad } from "@/lib/types";
import { MESES_LABEL, formatBRL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import {
  SITUACAO_META, diaMes, hojeIsoBr, mesFechadoEm, prazoDaSemana, resumoMeta, rotuloSemana, semanaCobrada, semanaLancada,
  semanaPadrao, semanasDoMes, type MetaMensal, type MetaSemanal, type SituacaoMeta,
} from "@/lib/metasClientes";

// Meta de leads e de faturamento de cada cliente no mês, lançamento semanal
// (sábado a sexta, fechada dentro do mês; prazo na segunda) e o resultado do mês (soma das semanas).
type CampoMes = "meta_leads" | "meta_faturamento" | "resultado_leads" | "resultado_faturamento";
type CampoSemana = "leads" | "faturamento";

const COR_SITUACAO: Record<SituacaoMeta, string> = {
  sem_meta: "border-red-500/40 text-red-300",
  meta_incompleta: "border-amber-500/40 text-amber-300",
  semana_pendente: "border-red-500/40 text-red-300",
  em_andamento: "border-white/10 text-brand-muted",
  sem_resultado: "border-red-500/40 text-red-300",
  completo: "border-emerald-500/40 text-emerald-300",
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

const fmtN = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 0 });
const fmtPct = (p: number | null) => (p == null ? "—" : `${p.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`);

export default function MetasClientesPage() {
  const supabase = createClient();
  const hoje = hojeIsoBr();
  const hojeAno = Number(hoje.slice(0, 4)), hojeMes = Number(hoje.slice(5, 7));
  const { isGerente, squadId: perfilSquadId } = useUsuarioPerfil();
  const [ano, setAno] = useState(hojeAno);
  const [mes, setMes] = useState(hojeMes);
  const [semana, setSemana] = useState(() => semanaPadrao(hojeAno, hojeMes, hoje));
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [metas, setMetas] = useState<MetaMensal[]>([]);
  const [semanais, setSemanais] = useState<MetaSemanal[]>([]);
  const [loading, setLoading] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);
  const [filtroSquad, setFiltroSquad] = useState("");
  const [filtroGP, setFiltroGP] = useState("");
  const [filtroSit, setFiltroSit] = useState<SituacaoMeta | "pendentes" | "">("");

  const sextas = useMemo(() => semanasDoMes(ano, mes), [ano, mes]);
  const mesFechado = mesFechadoEm(ano, mes, hoje);
  useEffect(() => { setSemana(semanaPadrao(ano, mes, hoje)); /* eslint-disable-next-line */ }, [ano, mes]);

  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: sq }, { data: mt, error }, { data: sm, error: e2 }] = await Promise.all([
      supabase.from("ruston_clientes_view").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_cliente_metas_mensal").select("*").eq("ano", ano).eq("mes", mes),
      supabase.from("ruston_cliente_metas_semanal").select("*").eq("ano", ano).eq("mes", mes),
    ]);
    setClientes(((cs as ClienteView[]) ?? []).filter((c) => !c.churn_realizado));
    setSquads((sq as Squad[]) ?? []);
    setMetas((mt as MetaMensal[]) ?? []);
    setSemanais((sm as MetaSemanal[]) ?? []);
    setErro(error ? `Não carregou as metas: ${error.message}` : e2 ? `Não carregou as semanas: ${e2.message}` : null);
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);

  const metaPorCliente = useMemo(() => new Map(metas.map((m) => [m.cliente_id, m])), [metas]);
  const semanasPorCliente = useMemo(() => {
    const m = new Map<string, MetaSemanal[]>();
    semanais.forEach((s) => m.set(s.cliente_id, [...(m.get(s.cliente_id) ?? []), s]));
    return m;
  }, [semanais]);
  const resumoDe = (id: string) => resumoMeta(metaPorCliente.get(id), semanasPorCliente.get(id) ?? [], ano, mes, hoje);

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
    .map((c) => ({
      c,
      m: metaPorCliente.get(c.id),
      r: resumoDe(c.id),
      sem: (semanasPorCliente.get(c.id) ?? []).find((s) => s.data_referencia === semana),
    }))
    .filter((x) => !filtroSit || (filtroSit === "pendentes" ? x.r.pendente : x.r.situacao === filtroSit)),
  // eslint-disable-next-line
  [base, filtroSquad, filtroGP, filtroSit, metaPorCliente, semanasPorCliente, semana, ano, mes]);

  // Placar da cobrança: pendências por GP
  const porGP = useMemo(() => {
    const m = new Map<string, { nome: string; total: number; pend: number; semanas: number }>();
    base.filter((c) => !filtroSquad || c.squad_id === filtroSquad).forEach((c) => {
      const k = c.account_id ?? "sem";
      const it = m.get(k) ?? { nome: c.account_nome ?? "Sem GP", total: 0, pend: 0, semanas: 0 };
      const r = resumoDe(c.id);
      it.total++;
      if (r.pendente) it.pend++;
      it.semanas += r.naoLancadas.length;
      m.set(k, it);
    });
    return Array.from(m.entries()).map(([id, v]) => ({ id, ...v })).sort((a, b) => b.pend - a.pend || a.nome.localeCompare(b.nome));
  // eslint-disable-next-line
  }, [base, filtroSquad, metaPorCliente, semanasPorCliente, ano, mes]);

  const totais = useMemo(() => {
    const soma = (f: (x: (typeof linhas)[number]) => number | null) => linhas.reduce((t, x) => t + Number(f(x) ?? 0), 0);
    const r = linhas.map((x) => x.r);
    return {
      metaLeads: soma((x) => x.r.metaLeads), realLeads: soma((x) => x.r.realLeads),
      metaFat: soma((x) => x.r.metaFat), realFat: soma((x) => x.r.realFat),
      comMeta: r.filter((x) => x.situacao !== "sem_meta" && x.situacao !== "meta_incompleta").length,
      pend: r.filter((x) => x.pendente).length,
      semanaLancadas: linhas.filter((x) => semanaLancada(x.sem)).length,
      fracao: r[0]?.fracao ?? 0,
    };
  }, [linhas]);

  async function salvarMes(c: ClienteView, campo: CampoMes, texto: string) {
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
    setMetas((lista) => [...lista.filter((m) => m.cliente_id !== c.id), data as MetaMensal]);
  }

  async function salvarSemana(c: ClienteView, campo: CampoSemana, texto: string) {
    if (!semana) return;
    const atual = (semanasPorCliente.get(c.id) ?? []).find((s) => s.data_referencia === semana);
    const valor = lerNumero(texto);
    if (texto.trim() && (valor == null || valor < 0)) { setErro("Valor inválido."); return; }
    const v = valor == null ? null : campo === "leads" ? Math.round(valor) : valor;
    if ((atual?.[campo] ?? null) === v) return;
    setSalvando(`${c.id}:${campo}`);
    setErro(null);
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error } = await supabase.from("ruston_cliente_metas_semanal")
      .upsert({
        cliente_id: c.id, data_referencia: semana, ano, mes, [campo]: v,
        atualizado_por: user?.email ?? null, updated_at: new Date().toISOString(),
      }, { onConflict: "cliente_id,data_referencia" })
      .select().single();
    setSalvando(null);
    if (error || !data) { setErro(`Não salvou (${c.nome}): ${error?.message ?? "erro"}`); return; }
    setSemanais((lista) => [...lista.filter((s) => !(s.cliente_id === c.id && s.data_referencia === semana)), data as MetaSemanal]);
  }

  const anos = [hojeAno - 1, hojeAno, hojeAno + 1];
  const semanaJaCobrada = semana ? semanaCobrada(semana, hoje) : false;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Metas dos Clientes</h1>
          <p className="text-sm text-brand-muted">
            Meta do mês · lançamento toda semana (sábado a sexta, fechada dentro do mês, até a segunda seguinte) · resultado do mês = soma das semanas
          </p>
        </div>
      </div>

      {/* Indicadores */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clientes com meta" valor={`${totais.comMeta} / ${linhas.length}`}
          sub={totais.pend > 0 ? `${totais.pend} pendente${totais.pend > 1 ? "s" : ""}` : "nenhuma pendência"}
          cor={totais.pend > 0 ? "text-amber-300" : "text-emerald-300"} />
        <Stat label="Leads no mês / meta" valor={`${fmtN(totais.realLeads)} / ${fmtN(totais.metaLeads)}`}
          sub={`atingimento ${fmtPct(pctAting(totais.metaLeads, totais.realLeads))}${!mesFechado ? ` · esperado até agora ${fmtPct(totais.fracao * 100)}` : ""}`} />
        <Stat label="Faturamento no mês" valor={formatBRL(totais.realFat)}
          sub={`meta ${formatBRL(totais.metaFat)} · ${fmtPct(pctAting(totais.metaFat, totais.realFat))}${!mesFechado ? ` · esperado ${fmtPct(totais.fracao * 100)}` : ""}`} />
        <Stat label={semana ? `Semana ${rotuloSemana(semana)}` : "Semana"} valor={`${totais.semanaLancadas} / ${linhas.length} lançadas`}
          sub={semana ? `prazo: segunda ${diaMes(prazoDaSemana(semana))}${semanaJaCobrada ? " · já cobrada" : ""}` : ""}
          cor={semanaJaCobrada && totais.semanaLancadas < linhas.length ? "text-red-300" : undefined} />
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
              {g.semanas > 0 && <p className="text-[10px] text-brand-muted">{g.semanas} semana{g.semanas > 1 ? "s" : ""} sem lançar</p>}
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
          {(Object.keys(SITUACAO_META) as SituacaoMeta[]).map((s) => <option key={s} value={s}>{SITUACAO_META[s]}</option>)}
        </select>
        <select className="input max-w-[150px]" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
          {MESES_LABEL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
          {anos.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input max-w-[240px]" value={semana} onChange={(e) => setSemana(e.target.value)}>
          {sextas.map((s, i) => (
            <option key={s} value={s}>Semana {i + 1} · {rotuloSemana(s)}{s > hoje ? " (futura)" : ""}</option>
          ))}
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
                <th className="bg-white/[0.03] px-3 py-3">Leads na semana</th>
                <th className="px-3 py-3">Leads no mês</th>
                <th className="px-3 py-3">Meta faturamento</th>
                <th className="bg-white/[0.03] px-3 py-3">Faturamento na semana</th>
                <th className="px-3 py-3">Faturamento no mês</th>
                <th className="px-3 py-3">Situação</th>
              </tr>
            </thead>
            <tbody>
              {linhas.length === 0 && (
                <tr><td colSpan={8} className="px-3 py-10 text-center text-brand-muted">Nenhum cliente nesse filtro.</td></tr>
              )}
              {linhas.map(({ c, m, r, sem }) => {
                const quem = sem ?? m;
                return (
                  <tr key={c.id} className="border-b border-white/5 align-top last:border-0">
                    <td className="px-3 py-2">
                      <p className="font-medium">{c.nome}</p>
                      <p className="text-[10px] text-brand-muted">
                        {[c.squad_nome, c.account_nome ? `GP: ${c.account_nome}` : "sem GP"].filter(Boolean).join(" · ")}
                      </p>
                    </td>
                    <td className="px-3 py-2"><CampoNum key={`${c.id}ml${m?.meta_leads}`} valor={m?.meta_leads} onSalvar={(t) => salvarMes(c, "meta_leads", t)} /></td>
                    <td className="bg-white/[0.03] px-3 py-2">
                      <CampoNum key={`${c.id}${semana}sl${sem?.leads}`} valor={sem?.leads} onSalvar={(t) => salvarSemana(c, "leads", t)} />
                    </td>
                    <td className="px-3 py-2">
                      <Acumulado r={r} tipo="leads" fmt={fmtN}
                        campo={<CampoNum key={`${c.id}rl${m?.resultado_leads}`} valor={m?.resultado_leads}
                          placeholder={r.somaLeads != null ? fmtN(r.somaLeads) : "0"} onSalvar={(t) => salvarMes(c, "resultado_leads", t)} />} />
                    </td>
                    <td className="px-3 py-2"><CampoNum key={`${c.id}mf${m?.meta_faturamento}`} valor={m?.meta_faturamento} dinheiro onSalvar={(t) => salvarMes(c, "meta_faturamento", t)} /></td>
                    <td className="bg-white/[0.03] px-3 py-2">
                      <CampoNum key={`${c.id}${semana}sf${sem?.faturamento}`} valor={sem?.faturamento} dinheiro onSalvar={(t) => salvarSemana(c, "faturamento", t)} />
                    </td>
                    <td className="px-3 py-2">
                      <Acumulado r={r} tipo="fat" fmt={(n) => formatBRL(n)}
                        campo={<CampoNum key={`${c.id}rf${m?.resultado_faturamento}`} valor={m?.resultado_faturamento} dinheiro
                          placeholder={r.somaFat != null ? formatBRL(r.somaFat) : "R$ 0,00"} onSalvar={(t) => salvarMes(c, "resultado_faturamento", t)} />} />
                    </td>
                    <td className="px-3 py-2">
                      <span className={`badge ${COR_SITUACAO[r.situacao]}`}>{SITUACAO_META[r.situacao]}</span>
                      {r.naoLancadas.length > 0 && (
                        <p className="mt-1 text-[10px] text-red-300">Sem lançar: {r.naoLancadas.map(diaMes).join(", ")}</p>
                      )}
                      {quem?.atualizado_por && (
                        <p className="mt-1 text-[10px] text-brand-muted">
                          {quem.atualizado_por.split("@")[0]} · {new Date(quem.updated_at).toLocaleDateString("pt-BR")}
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
      <p className="mt-3 text-[11px] text-brand-muted">
        O resultado do mês é a soma das semanas (aparece em cinza no campo do mês). Se o número fechado do cliente for diferente, digite o total no campo do mês para corrigir.
        As semanas ficam dentro do mês: a primeira começa no dia 01 e a última termina no fim do mês. Com o mês aberto, a cor mostra o ritmo: o realizado comparado ao esperado pelos dias das semanas que já passaram do prazo.
      </p>
    </div>
  );
}

type Resumo = ReturnType<typeof resumoMeta>;

/** Realizado do mês (campo de correção) + atingimento e ritmo */
function Acumulado({ r, tipo, campo, fmt }: { r: Resumo; tipo: "leads" | "fat"; campo: React.ReactNode; fmt: (n: number) => string }) {
  const ating = tipo === "leads" ? r.atingLeads : r.atingFat;
  const ritmo = tipo === "leads" ? r.ritmoLeads : r.ritmoFat;
  const corrigido = tipo === "leads" ? r.corrigidoLeads : r.corrigidoFat;
  const soma = tipo === "leads" ? r.somaLeads : r.somaFat;
  return (
    <div>
      {campo}
      <p className={`mt-1 text-[11px] font-semibold ${corPct(r.fechado ? ating : ritmo ?? ating)}`}>
        {fmtPct(ating)} da meta{!r.fechado && ritmo != null ? ` · ritmo ${fmtPct(ritmo)}` : ""}
      </p>
      {corrigido && <p className="text-[10px] text-brand-muted">total corrigido · semanas: {soma != null ? fmt(soma) : "—"}</p>}
    </div>
  );
}

/** Campo editável: salva ao sair do campo ou apertar Enter */
function CampoNum({ valor, dinheiro, placeholder, onSalvar }: { valor: number | null | undefined; dinheiro?: boolean; placeholder?: string; onSalvar: (t: string) => void }) {
  const inicial = valor == null ? "" : dinheiro
    ? Number(valor).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(valor);
  const [txt, setTxt] = useState(inicial);
  return (
    <input
      className={`input py-1 text-sm ${dinheiro ? "w-32" : "w-20"}`}
      inputMode="decimal"
      placeholder={placeholder ?? (dinheiro ? "R$ 0,00" : "0")}
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
