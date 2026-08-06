"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  ReuniaoStatus, ReuniaoCliente, Pessoa, Squad, ClienteView, TipoReuniao,
} from "@/lib/types";
import {
  formatDate, TIPO_REUNIAO_LABEL, TIPO_CADENCIA_LABEL,
  statusCadencia, STATUS_CADENCIA_COLOR, STATUS_CADENCIA_LABEL,
} from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

export default function ReunioesPage() {
  const supabase = createClient();
  const [statusList, setStatusList] = useState<ReuniaoStatus[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterSquad, setFilterSquad] = useState("");
  const [filterStatus, setFilterStatus] = useState<"" | "ok" | "proximo" | "atrasado" | "critico">("");
  const [modalCliente, setModalCliente] = useState<ReuniaoStatus | null>(null);
  const { isGerente, squadId: perfilSquadId } = useUsuarioPerfil();

  async function load() {
    setLoading(true);
    const [{ data: ss }, { data: ps }, { data: sq }] = await Promise.all([
      supabase.from("ruston_reunioes_status").select("*"),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
    ]);
    setStatusList((ss as ReuniaoStatus[]) ?? []);
    setPessoas((ps as Pessoa[]) ?? []);
    setSquads((sq as Squad[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    return statusList.filter((s) => {
      // Coordenador/Investidor só vê clientes do próprio squad
      if (!isGerente && perfilSquadId && s.cliente_squad_id !== perfilSquadId) return false;
      if (filterSquad && s.cliente_squad_id !== filterSquad) return false;
      if (filterStatus && statusCadencia(s) !== filterStatus) return false;
      return true;
    }).sort((a, b) => b.dias_sem_reuniao - a.dias_sem_reuniao);
  }, [statusList, filterSquad, filterStatus, isGerente, perfilSquadId]);

  const contagem = useMemo(() => {
    const c = { ok: 0, proximo: 0, atrasado: 0, critico: 0 };
    statusList.forEach((s) => c[statusCadencia(s)]++);
    return c;
  }, [statusList]);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Reuniões com Cliente</h1>
        <p className="text-sm text-brand-muted">
          Cadência de contato · foco em manter frequência e evitar churn silencioso
        </p>
      </div>

      {/* Cards de status */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatBadge label="Em dia" valor={contagem.ok} cor="text-emerald-300" onClick={() => setFilterStatus("ok")} />
        <StatBadge label="Se aproximando" valor={contagem.proximo} cor="text-sky-300" onClick={() => setFilterStatus("proximo")} />
        <StatBadge label="Atrasado" valor={contagem.atrasado} cor="text-amber-300" onClick={() => setFilterStatus("atrasado")} />
        <StatBadge label="Crítico" valor={contagem.critico} cor="text-red-300" onClick={() => setFilterStatus("critico")} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="input max-w-[180px]" value={filterSquad} onChange={(e) => setFilterSquad(e.target.value)}>
          <option value="">Todos squads</option>
          {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        <select className="input max-w-[160px]" value={filterStatus} onChange={(e) => setFilterStatus(e.target.value as any)}>
          <option value="">Todos status</option>
          <option value="critico">🔴 Crítico</option>
          <option value="atrasado">🟡 Atrasado</option>
          <option value="proximo">🔵 Se aproximando</option>
          <option value="ok">🟢 Em dia</option>
        </select>
        {(filterSquad || filterStatus) && (
          <button className="text-xs text-brand-muted hover:text-white"
            onClick={() => { setFilterSquad(""); setFilterStatus(""); }}>× limpar filtros</button>
        )}
      </div>

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && filtered.length === 0 && (
        <div className="card text-center py-12">
          <p className="text-brand-muted">Nenhum cliente nos filtros.</p>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="card overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3">Cadência</th>
                <th className="px-4 py-3">Última reunião</th>
                <th className="px-4 py-3">Dias sem</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Total</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((s) => {
                const status = statusCadencia(s);
                return (
                  <tr key={s.cliente_id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3 font-medium">{s.cliente_nome}</td>
                    <td className="px-4 py-3 text-brand-muted">
                      {TIPO_CADENCIA_LABEL[s.tipo_cadencia] ?? "—"}
                      <span className="ml-1 text-[10px]">({s.cadencia_dias}d)</span>
                    </td>
                    <td className="px-4 py-3 text-brand-muted">
                      {s.ultima_reuniao ? formatDate(s.ultima_reuniao) : <span className="text-red-300">nunca</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`font-semibold ${
                        status === "critico" ? "text-red-300" :
                        status === "atrasado" ? "text-amber-300" :
                        status === "proximo" ? "text-sky-300" :
                        "text-emerald-300"
                      }`}>
                        {s.dias_sem_reuniao >= 999 ? "—" : `${s.dias_sem_reuniao}d`}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`badge ${STATUS_CADENCIA_COLOR[status]}`}>
                        {STATUS_CADENCIA_LABEL[status]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-brand-muted">{s.total_reunioes}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        className="text-xs text-brand hover:text-red-400"
                        onClick={() => setModalCliente(s)}
                      >abrir</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {modalCliente && (
        <ModalReunioes
          statusCliente={modalCliente}
          pessoas={pessoas}
          onFechar={() => setModalCliente(null)}
          onAtualizado={() => { load(); }}
        />
      )}
    </div>
  );
}

function StatBadge({ label, valor, cor, onClick }: {
  label: string; valor: number; cor: string; onClick?: () => void;
}) {
  return (
    <button onClick={onClick} className="card p-3 text-left hover:border-brand transition">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${cor}`}>{valor}</p>
    </button>
  );
}

/* ============================== MODAL DE REUNIÕES ============================== */

function ModalReunioes({ statusCliente, pessoas, onFechar, onAtualizado }: {
  statusCliente: ReuniaoStatus;
  pessoas: Pessoa[];
  onFechar: () => void;
  onAtualizado: () => void;
}) {
  const supabase = createClient();
  const [reunioes, setReunioes] = useState<ReuniaoCliente[]>([]);
  const [loading, setLoading] = useState(true);
  const [novaReuniao, setNovaReuniao] = useState(false);
  const [editandoCadencia, setEditandoCadencia] = useState(false);
  const [novaCadencia, setNovaCadencia] = useState(statusCliente.cadencia_dias);
  const [novoTipoCadencia, setNovoTipoCadencia] = useState(statusCliente.tipo_cadencia);

  async function loadReunioes() {
    setLoading(true);
    const { data } = await supabase.from("ruston_reunioes_cliente")
      .select("*")
      .eq("cliente_id", statusCliente.cliente_id)
      .order("data_reuniao", { ascending: false });
    setReunioes((data as ReuniaoCliente[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { loadReunioes(); /* eslint-disable-next-line */ }, []);

  async function salvarCadencia() {
    await supabase.from("ruston_clientes").update({
      cadencia_reuniao_dias: novaCadencia,
      tipo_cadencia: novoTipoCadencia,
    }).eq("id", statusCliente.cliente_id);
    setEditandoCadencia(false);
    onAtualizado();
  }

  async function removerReuniao(id: string) {
    if (!confirm("Remover essa reunião?")) return;
    await supabase.from("ruston_reunioes_cliente").delete().eq("id", id);
    loadReunioes();
    onAtualizado();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto"
      onClick={onFechar}>
      <div className="w-full max-w-3xl rounded-xl bg-brand-panel p-6 shadow-lg my-8"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold">{statusCliente.cliente_nome}</h3>
            <p className="text-xs text-brand-muted">Histórico de reuniões</p>
          </div>
          <button onClick={onFechar} className="text-brand-muted hover:text-gray-200 text-xl">×</button>
        </div>

        {/* Cadência */}
        <div className="mb-4 rounded-lg bg-white/5 p-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-brand-muted">Cadência</p>
              {!editandoCadencia ? (
                <p className="mt-1 text-sm">
                  {TIPO_CADENCIA_LABEL[statusCliente.tipo_cadencia]} · {statusCliente.cadencia_dias} dias
                </p>
              ) : (
                <div className="mt-2 flex items-center gap-2">
                  <select className="input py-1 text-xs max-w-[120px]" value={novoTipoCadencia}
                    onChange={(e) => {
                      const t = e.target.value as any;
                      setNovoTipoCadencia(t);
                      if (t === "semanal") setNovaCadencia(7);
                      if (t === "quinzenal") setNovaCadencia(15);
                      if (t === "mensal") setNovaCadencia(30);
                    }}>
                    <option value="semanal">Semanal</option>
                    <option value="quinzenal">Quinzenal</option>
                    <option value="mensal">Mensal</option>
                    <option value="custom">Custom</option>
                  </select>
                  <input type="number" min="1" className="input py-1 text-xs max-w-[80px]"
                    value={novaCadencia} onChange={(e) => setNovaCadencia(Number(e.target.value))} />
                  <span className="text-xs text-brand-muted">dias</span>
                </div>
              )}
            </div>
            {!editandoCadencia ? (
              <button className="text-xs text-brand hover:text-red-400"
                onClick={() => setEditandoCadencia(true)}>editar</button>
            ) : (
              <div className="flex gap-1">
                <button className="text-xs text-emerald-300 hover:text-emerald-400" onClick={salvarCadencia}>salvar</button>
                <button className="text-xs text-brand-muted hover:text-white"
                  onClick={() => setEditandoCadencia(false)}>cancelar</button>
              </div>
            )}
          </div>
        </div>

        {/* Botão nova reunião */}
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-semibold">Histórico · {reunioes.length} reuniões</p>
          <button className="btn text-xs" onClick={() => setNovaReuniao(!novaReuniao)}>
            {novaReuniao ? "Fechar" : "+ Nova reunião"}
          </button>
        </div>

        {novaReuniao && (
          <FormReuniao
            clienteId={statusCliente.cliente_id}
            pessoas={pessoas}
            onSalvo={() => { setNovaReuniao(false); loadReunioes(); onAtualizado(); }}
            onCancelar={() => setNovaReuniao(false)}
          />
        )}

        {/* Lista de reuniões */}
        {loading && <p className="text-brand-muted text-sm">Carregando...</p>}
        {!loading && reunioes.length === 0 && !novaReuniao && (
          <div className="rounded-lg bg-white/5 p-6 text-center">
            <p className="text-sm text-brand-muted">
              Nenhuma reunião registrada ainda. Clica em "+ Nova reunião" pra começar o histórico.
            </p>
          </div>
        )}
        {!loading && reunioes.length > 0 && (
          <div className="space-y-2">
            {reunioes.map((r) => (
              <div key={r.id} className="rounded-lg border border-white/5 bg-white/5 p-3">
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <p className="text-sm font-semibold">
                      {formatDate(r.data_reuniao)}
                      <span className="ml-2 text-[10px] text-brand-muted">{TIPO_REUNIAO_LABEL[r.tipo_reuniao]}</span>
                      {r.hora && <span className="ml-2 text-[10px] text-brand-muted">{r.hora}</span>}
                    </p>
                    {r.presentes && <p className="text-[10px] text-brand-muted">Presentes: {r.presentes}</p>}
                  </div>
                  <button className="text-[10px] text-red-300 hover:text-red-400"
                    onClick={() => removerReuniao(r.id)}>excluir</button>
                </div>
                {r.resumo && (
                  <div className="mt-2">
                    <p className="text-[10px] uppercase tracking-wide text-brand-muted">Resumo</p>
                    <p className="text-xs whitespace-pre-wrap">{r.resumo}</p>
                  </div>
                )}
                {r.decisoes && (
                  <div className="mt-2">
                    <p className="text-[10px] uppercase tracking-wide text-brand-muted">Decisões</p>
                    <p className="text-xs whitespace-pre-wrap">{r.decisoes}</p>
                  </div>
                )}
                {r.proximos_passos && (
                  <div className="mt-2">
                    <p className="text-[10px] uppercase tracking-wide text-brand-muted">Próximos passos</p>
                    <p className="text-xs whitespace-pre-wrap">{r.proximos_passos}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ============================== FORM NOVA REUNIÃO ============================== */

function FormReuniao({ clienteId, pessoas, onSalvo, onCancelar }: {
  clienteId: string;
  pessoas: Pessoa[];
  onSalvo: () => void;
  onCancelar: () => void;
}) {
  const supabase = createClient();
  const hoje = new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    data_reuniao: hoje,
    hora: "",
    tipo_reuniao: "periodica" as TipoReuniao,
    responsavel_id: "",
    presentes: "",
    resumo: "",
    decisoes: "",
    proximos_passos: "",
  });
  const [saving, setSaving] = useState(false);

  async function salvar() {
    setSaving(true);
    await supabase.from("ruston_reunioes_cliente").insert({
      cliente_id: clienteId,
      data_reuniao: form.data_reuniao,
      hora: form.hora || null,
      tipo_reuniao: form.tipo_reuniao,
      responsavel_id: form.responsavel_id || null,
      presentes: form.presentes || null,
      resumo: form.resumo || null,
      decisoes: form.decisoes || null,
      proximos_passos: form.proximos_passos || null,
      realizada: true,
    });
    setSaving(false);
    onSalvo();
  }

  return (
    <div className="mb-4 rounded-lg border border-brand/40 bg-brand/5 p-3 space-y-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <label className="label">Data *</label>
          <input type="date" className="input" value={form.data_reuniao}
            onChange={(e) => setForm({ ...form, data_reuniao: e.target.value })} />
        </div>
        <div>
          <label className="label">Hora</label>
          <input type="time" className="input" value={form.hora}
            onChange={(e) => setForm({ ...form, hora: e.target.value })} />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="input" value={form.tipo_reuniao}
            onChange={(e) => setForm({ ...form, tipo_reuniao: e.target.value as TipoReuniao })}>
            <option value="kickoff">Kickoff</option>
            <option value="periodica">Periódica</option>
            <option value="urgente">Urgente</option>
            <option value="upsell">Upsell</option>
            <option value="renovacao">Renovação</option>
            <option value="outra">Outra</option>
          </select>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="label">Responsável Ruston</label>
          <select className="input" value={form.responsavel_id}
            onChange={(e) => setForm({ ...form, responsavel_id: e.target.value })}>
            <option value="">—</option>
            {pessoas.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Presentes na reunião</label>
          <input className="input" value={form.presentes}
            onChange={(e) => setForm({ ...form, presentes: e.target.value })}
            placeholder="Ex: GP + GT + João (cliente)" />
        </div>
      </div>
      <div>
        <label className="label">Resumo</label>
        <textarea className="input" rows={2} value={form.resumo}
          onChange={(e) => setForm({ ...form, resumo: e.target.value })}
          placeholder="O que foi discutido" />
      </div>
      <div>
        <label className="label">Decisões</label>
        <textarea className="input" rows={2} value={form.decisoes}
          onChange={(e) => setForm({ ...form, decisoes: e.target.value })}
          placeholder="O que ficou decidido" />
      </div>
      <div>
        <label className="label">Próximos passos</label>
        <textarea className="input" rows={2} value={form.proximos_passos}
          onChange={(e) => setForm({ ...form, proximos_passos: e.target.value })}
          placeholder="Ações + responsáveis" />
      </div>
      <div className="flex gap-2">
        <button className="btn" onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar reunião"}</button>
        <button className="btn-ghost" onClick={onCancelar}>Cancelar</button>
      </div>
    </div>
  );
}
