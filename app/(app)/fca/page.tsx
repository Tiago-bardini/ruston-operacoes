"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  FcaView, FcaAvaliacao, Squad, ClienteView, BandeiraFca, StatusFca,
} from "@/lib/types";
import {
  MESES_LABEL, CRITERIOS_FCA, calcularNotaFinalFca, bandeiraDaNota,
  BANDEIRA_FCA_COLOR, BANDEIRA_FCA_LABEL, STATUS_FCA_COLOR, STATUS_FCA_LABEL,
} from "@/lib/types";

const ANO_ATUAL = new Date().getFullYear();
const MES_ATUAL = new Date().getMonth() + 1;
const ANOS = [ANO_ATUAL - 1, ANO_ATUAL, ANO_ATUAL + 1];

export default function FcaPage() {
  const supabase = createClient();
  const [ano, setAno] = useState(ANO_ATUAL);
  const [mes, setMes] = useState(MES_ATUAL);
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [avaliacoes, setAvaliacoes] = useState<FcaView[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSquad, setFilterSquad] = useState<string>("");
  const [filterBandeira, setFilterBandeira] = useState<BandeiraFca | "">("");
  const [filterStatus, setFilterStatus] = useState<StatusFca | "">("");
  const [modalCliente, setModalCliente] = useState<ClienteView | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: sq }, { data: fs }] = await Promise.all([
      supabase.from("ruston_clientes_view").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_fca_view").select("*").eq("ano", ano).eq("mes", mes),
    ]);
    setClientes((cs as ClienteView[]) ?? []);
    setSquads((sq as Squad[]) ?? []);
    setAvaliacoes((fs as FcaView[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);

  const getAvaliacao = (clienteId: string) =>
    avaliacoes.find((a) => a.cliente_id === clienteId);

  const filtered = useMemo(() => {
    return clientes.filter((c) => {
      if (filterSquad && c.squad_id !== filterSquad) return false;
      const av = getAvaliacao(c.id);
      const bandeira: BandeiraFca = av?.bandeira ?? "sem_dado";
      if (filterBandeira && bandeira !== filterBandeira) return false;
      const status: StatusFca | "sem" = av?.status ?? "sem" as any;
      if (filterStatus && status !== filterStatus) return false;
      return true;
    });
  // eslint-disable-next-line
  }, [clientes, avaliacoes, filterSquad, filterBandeira, filterStatus]);

  // Estatísticas
  const stats = useMemo(() => {
    const verde = filtered.filter((c) => getAvaliacao(c.id)?.bandeira === "verde").length;
    const amarelo = filtered.filter((c) => getAvaliacao(c.id)?.bandeira === "amarelo").length;
    const vermelho = filtered.filter((c) => getAvaliacao(c.id)?.bandeira === "vermelho").length;
    const semDado = filtered.length - verde - amarelo - vermelho;
    const validados = filtered.filter((c) => getAvaliacao(c.id)?.status === "validado").length;
    return { verde, amarelo, vermelho, semDado, validados, total: filtered.length };
  // eslint-disable-next-line
  }, [filtered, avaliacoes]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">FCA — Fato · Causa · Ação</h1>
          <p className="text-sm text-brand-muted">
            Avaliação mensal por cliente · fórmula (R×7 + OT×5 + P×5 + Q×4 + Rel×4 + ROI×8) / 33
          </p>
        </div>
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="input max-w-[140px]" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
          {MESES_LABEL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
          {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <select className="input max-w-[160px]" value={filterSquad} onChange={(e) => setFilterSquad(e.target.value)}>
          <option value="">Todos squads</option>
          {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        <select className="input max-w-[140px]" value={filterBandeira} onChange={(e) => setFilterBandeira(e.target.value as BandeiraFca | "")}>
          <option value="">Todas bandeiras</option>
          <option value="verde">🟢 Verde</option>
          <option value="amarelo">🟡 Amarelo</option>
          <option value="vermelho">🔴 Vermelho</option>
          <option value="sem_dado">⚪ Sem dado</option>
        </select>
        <select className="input max-w-[180px]" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as StatusFca | "")}>
          <option value="">Todos status</option>
          <option value="rascunho">Rascunho</option>
          <option value="aguardando_validacao">Aguardando validação</option>
          <option value="validado">Validado</option>
        </select>
      </div>

      {/* Stats cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard label="Total" valor={stats.total} cor="text-white" />
        <StatCard label="Verde" valor={stats.verde} cor="text-emerald-300" />
        <StatCard label="Amarelo" valor={stats.amarelo} cor="text-amber-300" />
        <StatCard label="Vermelho" valor={stats.vermelho} cor="text-red-300" />
        <StatCard label="Validados" valor={stats.validados} cor="text-emerald-300" sublabel={`de ${stats.total}`} />
      </div>

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && filtered.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-brand-muted">Nenhum cliente com esses filtros.</p>
        </div>
      )}

      {/* Grid de cards */}
      {!loading && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => {
            const av = getAvaliacao(c.id);
            return (
              <FcaCard
                key={c.id}
                cliente={c}
                avaliacao={av}
                onAbrir={() => setModalCliente(c)}
              />
            );
          })}
        </div>
      )}

      {/* Modal de avaliação */}
      {modalCliente && (
        <FcaModal
          cliente={modalCliente}
          avaliacao={getAvaliacao(modalCliente.id)}
          ano={ano}
          mes={mes}
          onFechar={() => setModalCliente(null)}
          onSalvo={() => { setModalCliente(null); load(); }}
        />
      )}
    </div>
  );
}

/* ============================== STAT CARD ============================== */

function StatCard({ label, valor, cor, sublabel }: {
  label: string; valor: number; cor: string; sublabel?: string;
}) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${cor}`}>{valor}</p>
      {sublabel && <p className="text-[10px] text-brand-muted">{sublabel}</p>}
    </div>
  );
}

/* ============================== FCA CARD ============================== */

function FcaCard({ cliente, avaliacao, onAbrir }: {
  cliente: ClienteView;
  avaliacao?: FcaView;
  onAbrir: () => void;
}) {
  const bandeira: BandeiraFca = avaliacao?.bandeira ?? "sem_dado";
  const nota = avaliacao?.nota_final;
  const status: StatusFca | null = avaliacao?.status ?? null;

  return (
    <button onClick={onAbrir}
      className="card text-left hover:border-brand transition group">
      <div className="mb-3 flex items-start justify-between">
        <div>
          <p className="font-medium">{cliente.nome}</p>
          <p className="text-[10px] text-brand-muted">
            {cliente.squad_nome ?? "sem squad"} · GP: {cliente.account_nome ?? "—"}
          </p>
        </div>
        <span className={`badge ${BANDEIRA_FCA_COLOR[bandeira]}`}>
          {BANDEIRA_FCA_LABEL[bandeira]}
        </span>
      </div>

      <div className="flex items-end justify-between">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">Nota final</p>
          <p className={`text-3xl font-bold ${
            bandeira === "verde"    ? "text-emerald-300" :
            bandeira === "amarelo"  ? "text-amber-300" :
            bandeira === "vermelho" ? "text-red-300" :
            "text-brand-muted"
          }`}>
            {nota != null ? nota.toFixed(2) : "—"}
          </p>
        </div>
        {status && (
          <span className={`badge ${STATUS_FCA_COLOR[status]}`}>
            {STATUS_FCA_LABEL[status]}
          </span>
        )}
      </div>

      <p className="mt-3 text-[10px] text-brand hover:text-red-300 opacity-70 group-hover:opacity-100">
        {avaliacao ? "editar avaliação →" : "+ avaliar cliente"}
      </p>
    </button>
  );
}

/* ============================== MODAL DE AVALIAÇÃO ============================== */

const emptyAvaliacao = {
  nota_resultado: "",
  nota_operacao_trafego: "",
  nota_prazo: "",
  nota_qualidade: "",
  nota_relacionamento: "",
  nota_roi: "",
  fato: "",
  causa: "",
  acao: "",
  status: "rascunho" as StatusFca,
  observacoes: "",
};

function FcaModal({ cliente, avaliacao, ano, mes, onFechar, onSalvo }: {
  cliente: ClienteView;
  avaliacao?: FcaView;
  ano: number;
  mes: number;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState(emptyAvaliacao);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (avaliacao) {
      setForm({
        nota_resultado: avaliacao.nota_resultado != null ? String(avaliacao.nota_resultado) : "",
        nota_operacao_trafego: avaliacao.nota_operacao_trafego != null ? String(avaliacao.nota_operacao_trafego) : "",
        nota_prazo: avaliacao.nota_prazo != null ? String(avaliacao.nota_prazo) : "",
        nota_qualidade: avaliacao.nota_qualidade != null ? String(avaliacao.nota_qualidade) : "",
        nota_relacionamento: avaliacao.nota_relacionamento != null ? String(avaliacao.nota_relacionamento) : "",
        nota_roi: avaliacao.nota_roi != null ? String(avaliacao.nota_roi) : "",
        fato: avaliacao.fato ?? "",
        causa: avaliacao.causa ?? "",
        acao: avaliacao.acao ?? "",
        status: avaliacao.status,
        observacoes: avaliacao.observacoes ?? "",
      });
    } else {
      setForm(emptyAvaliacao);
    }
  }, [avaliacao]);

  // Calcula nota final em tempo real
  const notaCalculada = useMemo(() => {
    const notas = {
      nota_resultado: form.nota_resultado === "" ? null : Number(form.nota_resultado),
      nota_operacao_trafego: form.nota_operacao_trafego === "" ? null : Number(form.nota_operacao_trafego),
      nota_prazo: form.nota_prazo === "" ? null : Number(form.nota_prazo),
      nota_qualidade: form.nota_qualidade === "" ? null : Number(form.nota_qualidade),
      nota_relacionamento: form.nota_relacionamento === "" ? null : Number(form.nota_relacionamento),
      nota_roi: form.nota_roi === "" ? null : Number(form.nota_roi),
    };
    return calcularNotaFinalFca(notas);
  }, [form]);

  const bandeira = bandeiraDaNota(notaCalculada);

  async function salvar(novoStatus?: StatusFca) {
    setSaving(true);
    const payload: Partial<FcaAvaliacao> = {
      cliente_id: cliente.id,
      ano, mes,
      nota_resultado:        form.nota_resultado        === "" ? null : Number(form.nota_resultado),
      nota_operacao_trafego: form.nota_operacao_trafego === "" ? null : Number(form.nota_operacao_trafego),
      nota_prazo:            form.nota_prazo            === "" ? null : Number(form.nota_prazo),
      nota_qualidade:        form.nota_qualidade        === "" ? null : Number(form.nota_qualidade),
      nota_relacionamento:   form.nota_relacionamento   === "" ? null : Number(form.nota_relacionamento),
      nota_roi:              form.nota_roi              === "" ? null : Number(form.nota_roi),
      fato:  form.fato  || null,
      causa: form.causa || null,
      acao:  form.acao  || null,
      status: novoStatus ?? form.status,
      observacoes: form.observacoes || null,
    };
    if (novoStatus === "validado") {
      payload.validado_at = new Date().toISOString();
    }
    if (avaliacao) {
      await supabase.from("ruston_fca").update(payload).eq("id", avaliacao.id);
    } else {
      await supabase.from("ruston_fca").insert(payload);
    }
    setSaving(false);
    onSalvo();
  }

  async function remover() {
    if (!avaliacao) return;
    if (!confirm("Remover essa avaliação?")) return;
    await supabase.from("ruston_fca").delete().eq("id", avaliacao.id);
    onSalvo();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={onFechar}>
      <div className="w-full max-w-3xl rounded-xl bg-brand-panel p-6 shadow-lg my-8"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold">{cliente.nome}</h3>
            <p className="text-xs text-brand-muted">
              FCA · {MESES_LABEL[mes - 1]}/{ano} · {cliente.squad_nome ?? "sem squad"}
            </p>
          </div>
          <button onClick={onFechar} className="text-brand-muted hover:text-gray-200 text-xl">×</button>
        </div>

        {/* Nota final em destaque */}
        <div className={`mb-6 rounded-xl border p-4 ${BANDEIRA_FCA_COLOR[bandeira]}`}>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide opacity-70">Nota final calculada</p>
              <p className="text-4xl font-bold">
                {notaCalculada != null ? notaCalculada.toFixed(2) : "—"}
              </p>
            </div>
            <span className="badge">{BANDEIRA_FCA_LABEL[bandeira]}</span>
          </div>
        </div>

        {/* 6 critérios */}
        <div className="mb-4">
          <p className="mb-3 text-sm font-semibold">Notas por critério (0 a 10)</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {CRITERIOS_FCA.map((c) => (
              <div key={c.chave}>
                <label className="label">
                  {c.label} <span className="text-[9px] text-brand-muted">peso {c.peso}</span>
                </label>
                <input
                  type="number" min="0" max="10" step="0.1"
                  className="input"
                  value={(form as any)[c.chave]}
                  onChange={(e) => setForm({ ...form, [c.chave]: e.target.value })}
                  placeholder="0-10"
                />
              </div>
            ))}
          </div>
        </div>

        {/* Fato / Causa / Ação */}
        <div className="mb-4 space-y-3">
          <div>
            <label className="label">Fato — o que aconteceu no mês</label>
            <textarea className="input" rows={2} value={form.fato}
              onChange={(e) => setForm({ ...form, fato: e.target.value })}
              placeholder="Ex: cliente demorou pra aprovar campanha, resultado ficou 20% abaixo da meta" />
          </div>
          <div>
            <label className="label">Causa — por que aconteceu</label>
            <textarea className="input" rows={2} value={form.causa}
              onChange={(e) => setForm({ ...form, causa: e.target.value })}
              placeholder="Ex: falta de reunião estratégica, cliente sem clareza do objetivo" />
          </div>
          <div>
            <label className="label">Ação — o que vamos fazer</label>
            <textarea className="input" rows={2} value={form.acao}
              onChange={(e) => setForm({ ...form, acao: e.target.value })}
              placeholder="Ex: agendar mensal fixa, criar deck de recap semanal" />
          </div>
        </div>

        <div className="mb-4">
          <label className="label">Observações (opcional)</label>
          <input className="input" value={form.observacoes}
            onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
        </div>

        {/* Botões de ação */}
        <div className="flex flex-wrap items-center gap-2">
          <button className="btn" disabled={saving} onClick={() => salvar("rascunho")}>
            {saving ? "..." : "Salvar rascunho"}
          </button>
          <button className="btn-ghost" disabled={saving} onClick={() => salvar("aguardando_validacao")}>
            Enviar para validação
          </button>
          <button className="btn-ghost bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
            disabled={saving} onClick={() => salvar("validado")}>
            ✓ Validar (coordenador)
          </button>
          <div className="ml-auto flex items-center gap-2">
            {avaliacao && (
              <button className="text-xs text-red-300 hover:text-red-400" onClick={remover}>
                Excluir
              </button>
            )}
            <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          </div>
        </div>
      </div>
    </div>
  );
}
