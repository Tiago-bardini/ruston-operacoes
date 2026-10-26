"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClienteView, ChurnSolicitacao, ChurnMrrBase, StatusChurn, Forecast } from "@/lib/types";
import {
  formatBRL, formatDate, MESES_LABEL, MOTIVOS_CHURN,
  STATUS_CHURN_LABEL, STATUS_CHURN_COLOR,
} from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { ChurnList, ModalSubirChurn, efetivarChurn } from "@/components/churn/ChurnEfetivado";

const STATUS_LIST: StatusChurn[] = ["solicitado", "em_retencao", "revertido", "confirmado"];

/** Mês já terminou? (o MRR só trava depois do último dia) */
function mesFechado(ano: number, mes: number): boolean {
  const h = new Date();
  return ano * 12 + mes < h.getFullYear() * 12 + h.getMonth() + 1;
}

function somarChurn(lista: ChurnSolicitacao[]) {
  const naoRevertidas = lista.filter((s) => s.status !== "revertido");
  return {
    qtd: lista.length,
    mrrChurn: naoRevertidas.reduce((s, x) => s + Number(x.mrr || 0), 0),
    mrrConfirmado: lista.filter((s) => s.status === "confirmado").reduce((s, x) => s + Number(x.mrr || 0), 0),
    mrrRevertido: lista.filter((s) => s.status === "revertido").reduce((s, x) => s + Number(x.mrr || 0), 0),
  };
}

export default function ChurnPage() {
  const supabase = createClient();
  const hoje = new Date();
  const [ano, setAno] = useState(hoje.getFullYear());
  const [mes, setMes] = useState(hoje.getMonth() + 1);
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [solicitacoes, setSolicitacoes] = useState<ChurnSolicitacao[]>([]);
  const [bases, setBases] = useState<ChurnMrrBase[]>([]);
  const [historicoSol, setHistoricoSol] = useState<ChurnSolicitacao[]>([]);
  const [forecastMes, setForecastMes] = useState<Forecast | null>(null);
  const [baseManual, setBaseManual] = useState("");
  const [loading, setLoading] = useState(true);
  const [novaSolicitacao, setNovaSolicitacao] = useState(false);
  const [aba, setAba] = useState<"solicitacoes" | "efetivados">("solicitacoes");
  const [confirmando, setConfirmando] = useState<ChurnSolicitacao | null>(null);
  const { isGerente, squadId: perfilSquadId } = useUsuarioPerfil();

  // Permite abrir direto numa subaba: /churn?aba=efetivados
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("aba") === "efetivados") setAba("efetivados");
  }, []);

  // Histórico: últimos 12 meses até o mês corrente
  const mesesHistorico = useMemo(() => {
    const arr: { ano: number; mes: number }[] = [];
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
    for (let i = 0; i < 12; i++) {
      arr.push({ ano: d.getFullYear(), mes: d.getMonth() + 1 });
      d.setMonth(d.getMonth() - 1);
    }
    return arr;
    // eslint-disable-next-line
  }, []);

  async function load() {
    setLoading(true);
    const maisAntigo = mesesHistorico[mesesHistorico.length - 1];
    const inicioHist = `${maisAntigo.ano}-${String(maisAntigo.mes).padStart(2, "0")}-01`;
    const [{ data: cs }, { data: sol }, { data: bs }, { data: hs }, { data: fc }] = await Promise.all([
      supabase.from("ruston_clientes_view").select("*").order("nome"),
      supabase.from("ruston_churn_solicitacoes").select("*")
        .eq("ano", ano).eq("mes", mes).order("data_solicitacao", { ascending: false }),
      supabase.from("ruston_churn_mrr_base").select("*"),
      supabase.from("ruston_churn_solicitacoes").select("*").gte("data_solicitacao", inicioHist),
      supabase.from("ruston_forecast").select("*").eq("ano", ano).eq("mes", mes).maybeSingle(),
    ]);
    setClientes((cs as ClienteView[]) ?? []);
    setSolicitacoes((sol as ChurnSolicitacao[]) ?? []);
    setBases((bs as ChurnMrrBase[]) ?? []);
    setHistoricoSol((hs as ChurnSolicitacao[]) ?? []);
    const f = fc as Forecast | null;
    setForecastMes(f);
    setBaseManual(f?.fechado && f.mrr_total_snapshot ? String(f.mrr_total_snapshot) : "");
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);

  const clientePorId = useMemo(() => {
    const m = new Map<string, ClienteView>();
    clientes.forEach((c) => m.set(c.id, c));
    return m;
  }, [clientes]);

  // MRR atual (mesma regra da trava automática: soma do MRR dos clientes ativos)
  const mrrAtual = useMemo(
    () => clientes.filter((c) => c.ativo).reduce((s, c) => s + (Number(c.mrr) || 0), 0),
    [clientes],
  );

  function baseDoMes(a: number, m: number): { valor: number | null; situacao: "travado" | "parcial" | "sem_trava"; registro?: ChurnMrrBase } {
    const registro = bases.find((b) => b.ano === a && b.mes === m);
    if (registro) return { valor: Number(registro.mrr_base), situacao: "travado", registro };
    if (!mesFechado(a, m)) return { valor: mrrAtual, situacao: "parcial" };
    return { valor: null, situacao: "sem_trava" };
  }

  const base = baseDoMes(ano, mes);
  const ultimoDia = new Date(ano, mes, 0).getDate();

  const resumo = useMemo(() => {
    const r = somarChurn(solicitacoes);
    const pct = (v: number) => (base.valor ? (v / base.valor) * 100 : null);
    return { ...r, pctChurn: pct(r.mrrChurn), pctConfirmado: pct(r.mrrConfirmado) };
  }, [solicitacoes, base.valor]);

  const historico = useMemo(() => mesesHistorico.map(({ ano: a, mes: m }) => {
    const b = baseDoMes(a, m);
    const r = somarChurn(historicoSol.filter((s) => s.ano === a && s.mes === m));
    return {
      ano: a, mes: m, base: b, ...r,
      pctChurn: b.valor ? (r.mrrChurn / b.valor) * 100 : null,
      pctConfirmado: b.valor ? (r.mrrConfirmado / b.valor) * 100 : null,
    };
    // eslint-disable-next-line
  }), [mesesHistorico, historicoSol, bases, mrrAtual]);

  async function travarManual() {
    const v = Number(baseManual);
    if (!v || v <= 0) return;
    if (!confirm(`Travar o MRR de ${MESES_LABEL[mes - 1]}/${ano} em ${formatBRL(v)}? Depois de travado não dá pra alterar pelo painel.`)) return;
    const { error } = await supabase.from("ruston_churn_mrr_base")
      .insert({ ano, mes, mrr_base: v, origem: "manual", travado_em: new Date().toISOString() });
    if (error) return; // o AvisoErro já mostra a falha
    load();
  }

  async function mudarStatus(s: ChurnSolicitacao, status: StatusChurn) {
    // Confirmar = efetivar o churn do cliente (abre o "Subir Churn")
    if (status === "confirmado" && !clientePorId.get(s.cliente_id)?.churn_realizado) {
      setConfirmando(s);
      return;
    }
    await supabase.from("ruston_churn_solicitacoes")
      .update({ status, updated_at: new Date().toISOString() }).eq("id", s.id);
    load();
  }

  async function remover(id: string) {
    if (!confirm("Remover essa solicitação de churn?")) return;
    await supabase.from("ruston_churn_solicitacoes").delete().eq("id", id);
    load();
  }

  const efetivados = useMemo(() => clientes
    .filter((c) => c.churn_realizado)
    // Coordenador/Investidor: só vê clientes do próprio squad
    .filter((c) => isGerente || !perfilSquadId || c.squad_id === perfilSquadId)
    .sort((a, b) => (b.data_churn ?? "").localeCompare(a.data_churn ?? "")),
  [clientes, isGerente, perfilSquadId]);

  async function marcarSubiu(id: string) {
    await supabase.from("ruston_clientes")
      .update({ subiu_no_sistema: true, subiu_no_sistema_em: new Date().toISOString() })
      .eq("id", id);
    load();
  }

  async function reativar(id: string) {
    if (!confirm("Reativar esse cliente? Ele volta pra base ativa.")) return;
    await supabase.from("ruston_clientes")
      // etapa "cancelado" não aparece em nenhuma coluna da Carteira — volta como Em Retenção
      .update({ churn_realizado: false, ativo: true, data_churn: null, subiu_no_sistema: false, etapa: "em_recuperacao" })
      .eq("id", id);
    // Churn desfeito: a solicitação confirmada deixa de contar no % de churn
    await supabase.from("ruston_churn_solicitacoes")
      .update({ status: "revertido", updated_at: new Date().toISOString() })
      .eq("cliente_id", id).eq("status", "confirmado");
    load();
  }

  const clienteConfirmando = confirmando ? clientePorId.get(confirmando.cliente_id) : undefined;

  const anos = [hoje.getFullYear() - 1, hoje.getFullYear(), hoje.getFullYear() + 1];

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Solicitações de Churn</h1>
          <p className="text-sm text-brand-muted">
            Histórico mensal de pedidos de churn · % calculado sobre o MRR do último dia do mês (pontual/one time não entra)
          </p>
        </div>
        {aba === "solicitacoes" && <div className="flex items-center gap-2">
          <select className="input max-w-[150px]" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES_LABEL.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
          </select>
          <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {anos.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </div>}
      </div>

      {/* Subabas */}
      <div className="mb-6 inline-flex rounded-lg border border-white/10 bg-brand-panel/50 p-1">
        {[
          { v: "solicitacoes", label: "Solicitações" },
          { v: "efetivados", label: `Efetivados (${efetivados.length})` },
        ].map((it) => (
          <button
            key={it.v}
            onClick={() => setAba(it.v as typeof aba)}
            className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
              aba === it.v ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>

      {aba === "efetivados" && (
        <ChurnList clientes={efetivados} onMarkarSubiu={marcarSubiu} onReativar={reativar} />
      )}

      {clienteConfirmando && confirmando && (
        <ModalSubirChurn
          cliente={clienteConfirmando}
          dataInicial={confirmando.data_solicitacao}
          motivoInicial={[confirmando.motivo, confirmando.observacoes].filter(Boolean).join(" — ")}
          onFechar={() => setConfirmando(null)}
          onConfirmar={async (payload) => {
            const error = await efetivarChurn(supabase, clienteConfirmando, payload, confirmando.id);
            if (error) return; // o AvisoErro já mostra a falha
            setConfirmando(null);
            load();
          }}
        />
      )}

      {aba === "solicitacoes" && (<>
      {/* Indicadores */}
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Solicitações no mês" valor={String(resumo.qtd)} />
        <Stat label="MRR em churn" valor={formatBRL(resumo.mrrChurn)} cor="text-red-300"
          sub={resumo.mrrRevertido > 0 ? `${formatBRL(resumo.mrrRevertido)} revertido` : undefined} />
        <div className="card p-3">
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">MRR base do mês</p>
          {base.situacao === "travado" && (
            <>
              <p className="mt-1 text-2xl font-bold">🔒 {formatBRL(base.valor)}</p>
              <p className="text-[10px] text-brand-muted">
                Travado {base.registro?.travado_em ? `em ${new Date(base.registro.travado_em).toLocaleDateString("pt-BR")}` : ""}
                {base.registro?.origem === "manual" ? " · manual" : ""}
              </p>
            </>
          )}
          {base.situacao === "parcial" && (
            <>
              <p className="mt-1 text-2xl font-bold text-amber-300">{formatBRL(base.valor)}</p>
              <p className="text-[10px] text-brand-muted">
                Parcial (MRR de hoje) · trava em {String(ultimoDia).padStart(2, "0")}/{String(mes).padStart(2, "0")}
              </p>
            </>
          )}
          {base.situacao === "sem_trava" && (
            <>
              <p className="mt-1 text-xs text-amber-300">Mês fechado sem MRR travado</p>
              <div className="mt-1 flex items-center gap-1">
                <input type="number" step="0.01" className="input py-1 text-xs" value={baseManual}
                  placeholder="MRR do último dia" onChange={(e) => setBaseManual(e.target.value)} />
                <button className="text-xs text-emerald-300 hover:text-emerald-400" onClick={travarManual}>travar</button>
              </div>
              {forecastMes?.fechado && forecastMes.mrr_total_snapshot != null && (
                <p className="mt-1 text-[10px] text-brand-muted">Sugestão: fechamento do Forecast</p>
              )}
            </>
          )}
        </div>
        <Stat label="% Churn do mês" valor={formatPct(resumo.pctChurn)} cor="text-red-300"
          sub={`${base.situacao === "parcial" ? "parcial · " : ""}em retenção + confirmado`} />
        <Stat label="% Churn confirmado" valor={formatPct(resumo.pctConfirmado)} cor="text-red-400"
          sub={formatBRL(resumo.mrrConfirmado)} />
      </div>

      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">
          {MESES_LABEL[mes - 1]} / {ano} · {solicitacoes.length} solicitações
        </p>
        <button className="btn text-xs" onClick={() => setNovaSolicitacao(!novaSolicitacao)}>
          {novaSolicitacao ? "Fechar" : "+ Nova solicitação"}
        </button>
      </div>

      {novaSolicitacao && (
        <FormSolicitacao
          clientes={clientes}
          ano={ano}
          mes={mes}
          onSalvo={() => { setNovaSolicitacao(false); load(); }}
          onCancelar={() => setNovaSolicitacao(false)}
        />
      )}

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && solicitacoes.length === 0 && !novaSolicitacao && (
        <div className="card text-center py-12">
          <p className="text-brand-muted">Nenhuma solicitação de churn em {MESES_LABEL[mes - 1]}/{ano}.</p>
        </div>
      )}

      {!loading && solicitacoes.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">MRR</th>
                <th className="px-4 py-3">% do MRR</th>
                <th className="px-4 py-3">Motivo</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {solicitacoes.map((s) => {
                const c = clientePorId.get(s.cliente_id);
                return (
                  <tr key={s.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium">{c?.nome ?? "—"}</p>
                      {c?.squad_nome && <p className="text-[10px] text-brand-muted">{c.squad_nome}</p>}
                      {c?.churn_realizado && <p className="text-[10px] text-purple-300">✓ churn efetivado</p>}
                      {s.observacoes && <p className="text-[10px] text-brand-muted whitespace-pre-wrap">{s.observacoes}</p>}
                    </td>
                    <td className="px-4 py-3 text-brand-muted">{formatDate(s.data_solicitacao)}</td>
                    <td className="px-4 py-3 font-medium text-red-300">{formatBRL(s.mrr)}</td>
                    <td className="px-4 py-3 text-brand-muted">
                      {formatPct(base.valor ? (Number(s.mrr) / base.valor) * 100 : null)}
                    </td>
                    <td className="px-4 py-3 text-brand-muted">{s.motivo ?? "—"}</td>
                    <td className="px-4 py-3">
                      <select
                        className={`badge cursor-pointer bg-transparent ${STATUS_CHURN_COLOR[s.status]}`}
                        value={s.status}
                        onChange={(e) => mudarStatus(s, e.target.value as StatusChurn)}
                      >
                        {STATUS_LIST.map((st) => (
                          <option key={st} value={st} className="bg-brand-panel text-gray-100">{STATUS_CHURN_LABEL[st]}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button className="text-[10px] text-red-300 hover:text-red-400" onClick={() => remover(s.id)}>excluir</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Histórico mensal */}
      <div className="mt-8 mb-3">
        <p className="text-sm font-semibold">Histórico de churn · últimos 12 meses</p>
        <p className="text-xs text-brand-muted">MRR base de cada mês fica travado no último dia e não muda depois</p>
      </div>
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
              <th className="px-4 py-3">Mês</th>
              <th className="px-4 py-3">MRR base</th>
              <th className="px-4 py-3">Solicitações</th>
              <th className="px-4 py-3">MRR em churn</th>
              <th className="px-4 py-3">% Churn</th>
              <th className="px-4 py-3">% Confirmado</th>
            </tr>
          </thead>
          <tbody>
            {historico.map((h) => {
              const ativo = h.ano === ano && h.mes === mes;
              return (
                <tr key={`${h.ano}-${h.mes}`}
                  className={`cursor-pointer border-b border-white/5 last:border-0 hover:bg-white/5 ${ativo ? "bg-brand/10" : ""}`}
                  onClick={() => { setAno(h.ano); setMes(h.mes); }}>
                  <td className="px-4 py-3 font-medium">{MESES_LABEL[h.mes - 1]}/{h.ano}</td>
                  <td className="px-4 py-3">
                    {h.base.situacao === "travado" && <span>🔒 {formatBRL(h.base.valor)}</span>}
                    {h.base.situacao === "parcial" && <span className="text-amber-300">{formatBRL(h.base.valor)} <span className="text-[10px]">(parcial)</span></span>}
                    {h.base.situacao === "sem_trava" && <span className="text-[10px] text-amber-300">sem trava</span>}
                  </td>
                  <td className="px-4 py-3 text-brand-muted">{h.qtd}</td>
                  <td className="px-4 py-3 text-red-300">{formatBRL(h.mrrChurn)}</td>
                  <td className="px-4 py-3 font-semibold text-red-300">{formatPct(h.pctChurn)}</td>
                  <td className="px-4 py-3 text-red-400">{formatPct(h.pctConfirmado)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      </>)}
    </div>
  );
}

function formatPct(v: number | null): string {
  if (v == null) return "—";
  return `${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
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

/* ============================== FORM NOVA SOLICITAÇÃO ============================== */

function FormSolicitacao({ clientes, ano, mes, onSalvo, onCancelar }: {
  clientes: ClienteView[];
  ano: number;
  mes: number;
  onSalvo: () => void;
  onCancelar: () => void;
}) {
  const supabase = createClient();
  const hoje = new Date();
  // Data padrão: hoje se o mês selecionado for o atual, senão dia 1 do mês selecionado
  const dataPadrao = ano === hoje.getFullYear() && mes === hoje.getMonth() + 1
    ? hoje.toISOString().slice(0, 10)
    : `${ano}-${String(mes).padStart(2, "0")}-01`;
  const [form, setForm] = useState({
    cliente_id: "",
    data_solicitacao: dataPadrao,
    motivo: "",
    status: "solicitado" as StatusChurn,
    observacoes: "",
  });
  const [saving, setSaving] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Só clientes com MRR (recorrentes) entram na lista
  const recorrentes = clientes.filter((c) => c.ativo && Number(c.mrr) > 0);
  const selecionado = clientes.find((c) => c.id === form.cliente_id);

  async function salvar() {
    if (!selecionado) { setErro("Selecione o cliente."); return; }
    setSaving(true);
    setErro(null);
    const d = new Date(form.data_solicitacao + "T00:00:00");
    const { error } = await supabase.from("ruston_churn_solicitacoes").insert({
      cliente_id: selecionado.id,
      data_solicitacao: form.data_solicitacao,
      ano: d.getFullYear(),
      mes: d.getMonth() + 1,
      mrr: Number(selecionado.mrr) || 0,
      motivo: form.motivo || null,
      status: form.status,
      observacoes: form.observacoes || null,
    });
    setSaving(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }

  return (
    <div className="mb-4 rounded-lg border border-brand/40 bg-brand/5 p-3 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="sm:col-span-2">
          <label className="label">Cliente *</label>
          <select className="input" value={form.cliente_id}
            onChange={(e) => setForm({ ...form, cliente_id: e.target.value })}>
            <option value="">Selecione...</option>
            {recorrentes.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Fee mensal (MRR)</label>
          <div className="input bg-black/10 font-semibold text-brand">
            {selecionado ? formatBRL(selecionado.mrr) : "—"}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Data da solicitação *</label>
          <input type="date" className="input" value={form.data_solicitacao}
            onChange={(e) => setForm({ ...form, data_solicitacao: e.target.value })} />
        </div>
        <div>
          <label className="label">Motivo</label>
          <select className="input" value={form.motivo}
            onChange={(e) => setForm({ ...form, motivo: e.target.value })}>
            <option value="">—</option>
            {MOTIVOS_CHURN.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status}
            onChange={(e) => setForm({ ...form, status: e.target.value as StatusChurn })}>
            {STATUS_LIST.filter((st) => st !== "confirmado").map((st) => <option key={st} value={st}>{STATUS_CHURN_LABEL[st]}</option>)}
          </select>
          <p className="mt-1 text-[10px] text-brand-muted">Pra confirmar o churn, mude o status na tabela</p>
        </div>
      </div>
      <div>
        <label className="label">Observações</label>
        <textarea className="input" rows={2} value={form.observacoes}
          onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
          placeholder="Contexto da solicitação, tentativa de retenção..." />
      </div>
      {erro && <p className="text-xs text-red-300">{erro}</p>}
      <div className="flex gap-2">
        <button className="btn" onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar solicitação"}</button>
        <button className="btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
