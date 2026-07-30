"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClienteView, Pessoa, Squad, EtapaCliente, TierCliente, FcaView } from "@/lib/types";
import {
  ETAPA_LABEL, ETAPA_COLOR, TIER_LABEL, formatBRL, formatDate,
  statusVencimento, diasParaVencimento, STATUS_VENCIMENTO_COLOR,
} from "@/lib/types";

const ETAPAS: EtapaCliente[] = ["onboarding", "estruturacao_estrategica", "byline", "em_recuperacao", "suspenso"];
const TIERS: TierCliente[] = ["tiny", "small", "medium", "large"];

type View = "kanban_etapa" | "lista" | "kanban_gp" | "kanban_squad" | "churn";

const emptyForm = {
  nome: "",
  codigo_interno: "",
  etapa: "onboarding" as EtapaCliente,
  mrr: "",
  fee: "",
  tier: "" as TierCliente | "",
  data_assinatura: "",
  prazo_contrato_meses: "",
  data_vencimento_contrato: "",
  contrato_url: "",
  coordenador_id: "",
  account_id: "",
  gestor_trafego_id: "",
  designer_id: "",
  squad_id: "",
  observacoes: "",
};

export default function ClientesPage() {
  const supabase = createClient();
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [fcasRecentes, setFcasRecentes] = useState<Record<string, FcaView>>({});
  const [churnModal, setChurnModal] = useState<ClienteView | null>(null);
  const [view, setView] = useState<View>("kanban_etapa");
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSquad, setFilterSquad] = useState<string>("");

  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: ps }, { data: sq }, { data: fs }] = await Promise.all([
      // Traz TODOS (ativos + churn) — a view filtra em memória
      supabase.from("ruston_clientes_view").select("*").order("nome"),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_fca_view").select("*").order("ano", { ascending: false }).order("mes", { ascending: false }),
    ]);
    setClientes((cs as ClienteView[]) ?? []);
    setPessoas((ps as Pessoa[]) ?? []);
    setSquads((sq as Squad[]) ?? []);
    // Reduz para o FCA mais recente por cliente_id
    const mapaFca: Record<string, FcaView> = {};
    ((fs as FcaView[]) ?? []).forEach((f) => {
      if (!mapaFca[f.cliente_id]) mapaFca[f.cliente_id] = f;
    });
    setFcasRecentes(mapaFca);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const payload = {
      nome: form.nome,
      codigo_interno: form.codigo_interno || null,
      etapa: form.etapa,
      mrr: form.mrr ? Number(form.mrr) : 0,
      fee: form.fee ? Number(form.fee) : null,
      tier: form.tier || null,
      data_assinatura: form.data_assinatura || null,
      prazo_contrato_meses: form.prazo_contrato_meses ? Number(form.prazo_contrato_meses) : null,
      data_vencimento_contrato: form.data_vencimento_contrato || null,
      contrato_url: form.contrato_url || null,
      coordenador_id: form.coordenador_id || null,
      account_id: form.account_id || null,
      gestor_trafego_id: form.gestor_trafego_id || null,
      designer_id: form.designer_id || null,
      squad_id: form.squad_id || null,
      observacoes: form.observacoes || null,
    };
    if (editingId) {
      await supabase.from("ruston_clientes").update(payload).eq("id", editingId);
    } else {
      await supabase.from("ruston_clientes").insert(payload);
    }
    setForm(emptyForm);
    setFormOpen(false);
    setEditingId(null);
    load();
  }

  function edit(c: ClienteView) {
    setForm({
      nome: c.nome,
      codigo_interno: c.codigo_interno ?? "",
      etapa: c.etapa,
      mrr: String(c.mrr ?? ""),
      fee: c.fee != null ? String(c.fee) : "",
      tier: c.tier ?? "",
      data_assinatura: c.data_assinatura ?? "",
      prazo_contrato_meses: c.prazo_contrato_meses != null ? String(c.prazo_contrato_meses) : "",
      data_vencimento_contrato: c.data_vencimento_contrato ?? "",
      contrato_url: c.contrato_url ?? "",
      coordenador_id: c.coordenador_id ?? "",
      account_id: c.account_id ?? "",
      gestor_trafego_id: c.gestor_trafego_id ?? "",
      designer_id: c.designer_id ?? "",
      squad_id: c.squad_id ?? "",
      observacoes: c.observacoes ?? "",
    });
    setEditingId(c.id);
    setFormOpen(true);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function moveEtapa(c: ClienteView, etapa: EtapaCliente) {
    await supabase.from("ruston_clientes").update({ etapa }).eq("id", c.id);
    load();
  }

  async function remove(id: string) {
    if (!confirm("Excluir este cliente?")) return;
    await supabase.from("ruston_clientes").delete().eq("id", id);
    load();
  }

  const cargoDisponivel = (cargo: string) => pessoas.filter((p) => p.cargo === cargo);
  // Dropdown de Coordenador aceita tanto Coordenadores quanto Gerentes
  // (o Gerente da unidade também atua como coordenador de alguns clientes)
  const coordenadoresOuGerentes = pessoas.filter(
    (p) => p.cargo === "coordenador" || p.cargo === "gerente"
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return clientes.filter((c) => {
      // Separa: view churn mostra só churn_realizado, resto mostra só ativos
      if (view === "churn") {
        if (!c.churn_realizado) return false;
      } else {
        if (!c.ativo || c.churn_realizado) return false;
      }
      if (filterSquad && c.squad_id !== filterSquad) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        (c.codigo_interno ?? "").toLowerCase().includes(q) ||
        (c.account_nome ?? "").toLowerCase().includes(q) ||
        (c.squad_nome ?? "").toLowerCase().includes(q)
      );
    });
  }, [clientes, search, filterSquad, view]);

  // Alerta: churns pendentes de subir no sistema (data <= hoje E não subiu)
  const churnsPendentes = useMemo(() => {
    const hoje = new Date().toISOString().slice(0, 10);
    return clientes.filter((c) =>
      c.churn_realizado
      && !c.subiu_no_sistema
      && c.data_subir_churn_sistema != null
      && c.data_subir_churn_sistema <= hoje
    );
  }, [clientes]);

  const totalMRR = filtered.reduce((s, c) => s + (Number(c.mrr) || 0), 0);

  // Contratos com vencimento próximo (30 e 60 dias) — pra alerta no topo
  // Clientes com FCA vermelho (usa FCA mais recente)
  const clientesVermelhos = useMemo(() => {
    return filtered.filter((c) => fcasRecentes[c.id]?.bandeira === "vermelho");
  }, [filtered, fcasRecentes]);

  const vencendo = useMemo(() => {
    const criticos: ClienteView[] = [];
    const atencao: ClienteView[] = [];
    const vencidos: ClienteView[] = [];
    filtered.forEach((c) => {
      const s = statusVencimento(c.data_vencimento_contrato);
      if (s === "vencido") vencidos.push(c);
      else if (s === "critico") criticos.push(c);
      else if (s === "atencao") atencao.push(c);
    });
    return { vencidos, criticos, atencao };
  }, [filtered]);

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Clientes</h1>
          <p className="text-sm text-brand-muted">
            {filtered.length} clientes · MRR {formatBRL(totalMRR)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input max-w-[180px]" value={filterSquad}
            onChange={(e) => setFilterSquad(e.target.value)}>
            <option value="">Todos os squads</option>
            {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
          <input
            className="input max-w-xs"
            placeholder="Buscar..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <button className="btn" onClick={() => { setEditingId(null); setForm(emptyForm); setFormOpen(!formOpen); }}>
            {formOpen ? "Fechar" : "+ Novo cliente"}
          </button>
        </div>
      </div>

      {/* Alerta de contratos vencendo */}
      {clientesVermelhos.length > 0 && (
        <div className="mb-4 card border border-red-500/40 bg-red-500/5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-red-300">FCA Vermelho — Atenção crítica</p>
              <p className="mt-1 text-lg font-bold text-red-300">
                {clientesVermelhos.length} cliente{clientesVermelhos.length > 1 ? "s" : ""} com FCA abaixo de 6
              </p>
              <p className="mt-1 text-[10px] text-brand-muted">
                {clientesVermelhos.map((c) => c.nome).join(" · ")}
              </p>
            </div>
            <a href="/fca" className="btn text-xs">Ver FCA</a>
          </div>
        </div>
      )}

      {churnsPendentes.length > 0 && (
        <div className="mb-4 card border border-purple-500/40 bg-purple-500/5">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] uppercase tracking-wide text-purple-300">Churn pendente de subir no sistema</p>
              <p className="mt-1 text-lg font-bold text-purple-300">
                {churnsPendentes.length} cliente{churnsPendentes.length > 1 ? "s" : ""} pra processar no CRM externo
              </p>
              <p className="mt-1 text-[10px] text-brand-muted">
                {churnsPendentes.map((c) => c.nome).join(" · ")}
              </p>
            </div>
            <button className="btn text-xs" onClick={() => setView("churn")}>Ver churns</button>
          </div>
        </div>
      )}

      {(vencendo.vencidos.length + vencendo.criticos.length + vencendo.atencao.length) > 0 && (
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {vencendo.vencidos.length > 0 && (
            <div className="card border border-red-500/40 bg-red-500/5">
              <p className="text-[10px] uppercase tracking-wide text-red-300">Vencidos</p>
              <p className="mt-1 text-2xl font-bold text-red-300">{vencendo.vencidos.length}</p>
              <p className="mt-1 text-[10px] text-brand-muted line-clamp-2">
                {vencendo.vencidos.map((c) => c.nome).join(" · ")}
              </p>
            </div>
          )}
          {vencendo.criticos.length > 0 && (
            <div className="card border border-orange-500/40 bg-orange-500/5">
              <p className="text-[10px] uppercase tracking-wide text-orange-300">Vencem em ≤ 30 dias</p>
              <p className="mt-1 text-2xl font-bold text-orange-300">{vencendo.criticos.length}</p>
              <p className="mt-1 text-[10px] text-brand-muted line-clamp-2">
                {vencendo.criticos.map((c) => c.nome).join(" · ")}
              </p>
            </div>
          )}
          {vencendo.atencao.length > 0 && (
            <div className="card border border-amber-500/40 bg-amber-500/5">
              <p className="text-[10px] uppercase tracking-wide text-amber-300">Vencem em ≤ 60 dias</p>
              <p className="mt-1 text-2xl font-bold text-amber-300">{vencendo.atencao.length}</p>
              <p className="mt-1 text-[10px] text-brand-muted line-clamp-2">
                {vencendo.atencao.map((c) => c.nome).join(" · ")}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Toggle de views */}
      <div className="mb-6 inline-flex rounded-lg border border-white/10 bg-brand-panel/50 p-1">
        {[
          { v: "kanban_etapa", label: "Kanban por Etapa" },
          { v: "lista", label: "Lista" },
          { v: "kanban_gp", label: "Kanban por GP" },
          { v: "kanban_squad", label: "Kanban por Squad" },
          { v: "churn", label: `Churn (${clientes.filter((c) => c.churn_realizado).length})` },
        ].map((it) => (
          <button
            key={it.v}
            onClick={() => setView(it.v as View)}
            className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
              view === it.v ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>

      {/* Formulário */}
      {formOpen && (
        <form onSubmit={save} className="card mb-6">
          <p className="mb-4 text-sm font-semibold">
            {editingId ? "Editar cliente" : "Novo cliente"}
          </p>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <label className="label">Nome *</label>
              <input className="input" required value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })} />
            </div>
            <div>
              <label className="label">Código interno</label>
              <input className="input" value={form.codigo_interno}
                onChange={(e) => setForm({ ...form, codigo_interno: e.target.value })} />
            </div>
            <div>
              <label className="label">Etapa *</label>
              <select className="input" value={form.etapa}
                onChange={(e) => setForm({ ...form, etapa: e.target.value as EtapaCliente })}>
                {ETAPAS.map((et) => <option key={et} value={et}>{ETAPA_LABEL[et]}</option>)}
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
            <div>
              <label className="label">MRR (R$)</label>
              <input type="number" step="0.01" className="input" value={form.mrr}
                onChange={(e) => setForm({ ...form, mrr: e.target.value })} />
            </div>
            <div>
              <label className="label">Pontual (R$)</label>
              <input type="number" step="0.01" className="input" value={form.fee}
                onChange={(e) => setForm({ ...form, fee: e.target.value })} />
            </div>
            <div>
              <label className="label">Tier</label>
              <select className="input" value={form.tier}
                onChange={(e) => setForm({ ...form, tier: e.target.value as TierCliente | "" })}>
                <option value="">—</option>
                {TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Data assinatura</label>
              <input type="date" className="input" value={form.data_assinatura}
                onChange={(e) => setForm({ ...form, data_assinatura: e.target.value })} />
            </div>
            <div>
              <label className="label">Prazo contrato (meses)</label>
              <input type="number" min="1" className="input" placeholder="ex: 12"
                value={form.prazo_contrato_meses}
                onChange={(e) => setForm({ ...form, prazo_contrato_meses: e.target.value })} />
            </div>
            <div>
              <label className="label">Vencimento contrato</label>
              <input type="date" className="input" value={form.data_vencimento_contrato}
                onChange={(e) => setForm({ ...form, data_vencimento_contrato: e.target.value })} />
            </div>
            <div className="lg:col-span-3">
              <label className="label">URL do contrato</label>
              <input className="input" value={form.contrato_url}
                onChange={(e) => setForm({ ...form, contrato_url: e.target.value })} />
            </div>
            <div>
              <label className="label">Squad</label>
              <select className="input" value={form.squad_id}
                onChange={(e) => setForm({ ...form, squad_id: e.target.value })}>
                <option value="">—</option>
                {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Coordenador</label>
              <select className="input" value={form.coordenador_id}
                onChange={(e) => setForm({ ...form, coordenador_id: e.target.value })}>
                <option value="">—</option>
                {coordenadoresOuGerentes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nome}{p.cargo === "gerente" ? " (Gerente)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Account (GP)</label>
              <select className="input" value={form.account_id}
                onChange={(e) => setForm({ ...form, account_id: e.target.value })}>
                <option value="">—</option>
                {cargoDisponivel("gestor_projetos").map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Gestor de Tráfego</label>
              <select className="input" value={form.gestor_trafego_id}
                onChange={(e) => setForm({ ...form, gestor_trafego_id: e.target.value })}>
                <option value="">—</option>
                {cargoDisponivel("gestor_trafego").map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Designer</label>
              <select className="input" value={form.designer_id}
                onChange={(e) => setForm({ ...form, designer_id: e.target.value })}>
                <option value="">—</option>
                {cargoDisponivel("designer").map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
              </select>
            </div>
            <div className="lg:col-span-3">
              <label className="label">Observações</label>
              <textarea className="input" rows={2} value={form.observacoes}
                onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
            </div>
            <div className="lg:col-span-3 flex gap-2">
              <button type="submit" className="btn">{editingId ? "Atualizar" : "Salvar"}</button>
              <button type="button" className="btn-ghost"
                onClick={() => { setEditingId(null); setForm(emptyForm); setFormOpen(false); }}>
                Cancelar
              </button>
            </div>
          </div>
        </form>
      )}

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && filtered.length === 0 && (
        <div className="card text-center">
          <p className="text-brand-muted">
            {clientes.length === 0
              ? "Nenhum cliente cadastrado ainda. Cadastre pessoas primeiro em /pessoas, depois cria o primeiro cliente aqui."
              : "Nenhum cliente encontrado com essa busca."}
          </p>
        </div>
      )}

      {!loading && filtered.length > 0 && view === "kanban_etapa" && (
        <KanbanEtapa clientes={filtered} onEdit={edit} onRemove={remove} onMove={moveEtapa} />
      )}

      {!loading && filtered.length > 0 && view === "lista" && (
        <Lista clientes={filtered} onEdit={edit} onRemove={remove} />
      )}

      {!loading && filtered.length > 0 && view === "kanban_gp" && (
        <KanbanGP clientes={filtered} pessoas={pessoas} onEdit={edit} onRemove={remove} />
      )}

      {!loading && filtered.length > 0 && view === "kanban_squad" && (
        <KanbanSquad clientes={filtered} squads={squads} onEdit={edit} onRemove={remove} />
      )}

      {!loading && view === "churn" && (
        <ChurnList clientes={filtered} onMarkarSubiu={async (id) => {
          await supabase.from("ruston_clientes")
            .update({ subiu_no_sistema: true, subiu_no_sistema_em: new Date().toISOString() })
            .eq("id", id);
          load();
        }} onReativar={async (id) => {
          if (!confirm("Reativar esse cliente? Ele volta pra base ativa.")) return;
          await supabase.from("ruston_clientes")
            .update({ churn_realizado: false, ativo: true, data_churn: null, subiu_no_sistema: false })
            .eq("id", id);
          load();
        }} />
      )}

      {/* Modal SUBIR CHURN */}
      {churnModal && (
        <ModalSubirChurn
          cliente={churnModal}
          onFechar={() => setChurnModal(null)}
          onConfirmar={async ({ data_churn, motivo_churn, data_subir_churn_sistema }) => {
            await supabase.from("ruston_clientes").update({
              churn_realizado: true,
              ativo: false,
              data_churn,
              motivo_churn,
              data_subir_churn_sistema,
              etapa: "cancelado",
            }).eq("id", churnModal.id);
            setChurnModal(null);
            load();
          }}
        />
      )}

      {/* Botão flutuante SUBIR CHURN quando editando */}
      {formOpen && editingId && (
        <div className="fixed bottom-4 right-4 z-40">
          <button
            className="btn bg-purple-600 hover:bg-purple-700 border-purple-500 text-white text-xs"
            onClick={() => {
              const c = clientes.find((x) => x.id === editingId);
              if (c) { setFormOpen(false); setChurnModal(c); }
            }}
          >
            ⚠ Subir Churn
          </button>
        </div>
      )}
    </div>
  );
}

/* ============================== CHURN LIST ============================== */

function ChurnList({ clientes, onMarkarSubiu, onReativar }: {
  clientes: ClienteView[];
  onMarkarSubiu: (id: string) => void;
  onReativar: (id: string) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3">Data Churn</th>
            <th className="px-4 py-3">GP</th>
            <th className="px-4 py-3">Squad</th>
            <th className="px-4 py-3">MRR perdido</th>
            <th className="px-4 py-3">Motivo</th>
            <th className="px-4 py-3">Subir no sistema</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {clientes.length === 0 && (
            <tr><td colSpan={8} className="px-4 py-12 text-center text-brand-muted">
              Nenhum cliente em churn. Quando algum cliente pedir pra sair, edite ele e clique em "Subir Churn".
            </td></tr>
          )}
          {clientes.map((c) => {
            const dataSubir = c.data_subir_churn_sistema;
            const pendente = !c.subiu_no_sistema && dataSubir != null && dataSubir <= hoje;
            return (
              <tr key={c.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 font-medium">{c.nome}</td>
                <td className="px-4 py-3 text-brand-muted">{formatDate(c.data_churn)}</td>
                <td className="px-4 py-3 text-brand-muted">{c.account_nome ?? "—"}</td>
                <td className="px-4 py-3 text-brand-muted">{c.squad_nome ?? "—"}</td>
                <td className="px-4 py-3 font-medium text-red-300">{formatBRL(c.mrr)}</td>
                <td className="px-4 py-3 text-xs text-brand-muted line-clamp-2">{c.motivo_churn ?? "—"}</td>
                <td className="px-4 py-3">
                  {c.subiu_no_sistema ? (
                    <span className="badge bg-emerald-500/15 text-emerald-300 border-emerald-500/30">✓ Subiu</span>
                  ) : dataSubir ? (
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${pendente ? "text-purple-300 font-semibold" : "text-brand-muted"}`}>
                        {formatDate(dataSubir)}{pendente ? " · pendente!" : ""}
                      </span>
                      <button
                        className="text-[10px] text-emerald-300 hover:text-emerald-400"
                        onClick={() => onMarkarSubiu(c.id)}
                      >marcar como subiu</button>
                    </div>
                  ) : (
                    <span className="text-xs text-brand-muted">sem data</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onReativar(c.id)} className="text-xs text-brand hover:text-red-400">
                    reativar
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== MODAL SUBIR CHURN ============================== */

function ModalSubirChurn({ cliente, onFechar, onConfirmar }: {
  cliente: ClienteView;
  onFechar: () => void;
  onConfirmar: (payload: {
    data_churn: string;
    motivo_churn: string | null;
    data_subir_churn_sistema: string | null;
  }) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const diasFuturos = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const [dataChurn, setDataChurn] = useState(hoje);
  const [motivo, setMotivo] = useState("");
  const [dataSubir, setDataSubir] = useState(diasFuturos(7));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}>
      <div className="w-full max-w-md rounded-xl bg-brand-panel p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h3 className="text-lg font-bold text-purple-300">⚠ Subir Churn</h3>
          <p className="mt-1 text-sm text-brand-muted">
            Cliente: <strong className="text-white">{cliente.nome}</strong>
          </p>
          <p className="text-xs text-brand-muted">
            MRR perdido: {formatBRL(cliente.mrr)}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Data do churn</label>
            <input type="date" className="input" value={dataChurn}
              onChange={(e) => setDataChurn(e.target.value)} />
          </div>
          <div>
            <label className="label">Motivo (opcional)</label>
            <textarea className="input" rows={3} value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: sem verba, insatisfeito com resultado, mudou de agência..." />
          </div>
          <div>
            <label className="label">Data pra subir no CRM externo (opcional)</label>
            <input type="date" className="input" value={dataSubir}
              onChange={(e) => setDataSubir(e.target.value)} />
            <p className="mt-1 text-[10px] text-brand-muted">
              Sistema vai lembrar quando essa data chegar
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            className="btn bg-purple-600 hover:bg-purple-700 border-purple-500"
            onClick={() => onConfirmar({
              data_churn: dataChurn,
              motivo_churn: motivo || null,
              data_subir_churn_sistema: dataSubir || null,
            })}
          >Confirmar Churn</button>
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

/* -------- SUB-COMPONENTES -------- */

function KanbanEtapa({
  clientes, onEdit, onRemove, onMove,
}: {
  clientes: ClienteView[];
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
  onMove: (c: ClienteView, e: EtapaCliente) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {ETAPAS.map((et) => {
        const items = clientes.filter((c) => c.etapa === et);
        const soma = items.reduce((s, c) => s + (Number(c.mrr) || 0), 0);
        return (
          <div key={et} className="rounded-xl border border-white/5 bg-black/20 p-3">
            <div className="mb-2 flex items-center justify-between px-1">
              <span className="text-sm font-semibold">{ETAPA_LABEL[et]}</span>
              <span className="badge bg-white/5 text-brand-muted border-white/10">{items.length}</span>
            </div>
            <p className="mb-3 px-1 text-[10px] text-brand-muted">{formatBRL(soma)}</p>
            <div className="space-y-3">
              {items.map((c) => (
                <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} onMove={onMove} />
              ))}
              {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-brand-muted">vazio</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Lista({
  clientes, onEdit, onRemove,
}: {
  clientes: ClienteView[];
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3">Etapa</th>
            <th className="px-4 py-3">MRR</th>
            <th className="px-4 py-3">Tier</th>
            <th className="px-4 py-3">GP</th>
            <th className="px-4 py-3">Squad</th>
            <th className="px-4 py-3">LT</th>
            <th className="px-4 py-3">Vencimento</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {clientes.map((c) => (
            <tr key={c.id} className="border-b border-white/5 last:border-0">
              <td className="px-4 py-3">
                <p className="font-medium">{c.nome}</p>
                {c.codigo_interno && <p className="text-xs text-brand-muted">#{c.codigo_interno}</p>}
              </td>
              <td className="px-4 py-3">
                <span className={`badge ${ETAPA_COLOR[c.etapa]}`}>{ETAPA_LABEL[c.etapa]}</span>
              </td>
              <td className="px-4 py-3 font-medium text-brand">{formatBRL(c.mrr)}</td>
              <td className="px-4 py-3 text-brand-muted">{c.tier ? TIER_LABEL[c.tier] : "—"}</td>
              <td className="px-4 py-3 text-brand-muted">{c.account_nome ?? "—"}</td>
              <td className="px-4 py-3 text-brand-muted">{c.squad_nome ?? "—"}</td>
              <td className="px-4 py-3 text-brand-muted">{c.lt_meses != null ? `${c.lt_meses} m` : "—"}</td>
              <td className="px-4 py-3">
                {c.data_vencimento_contrato ? (
                  <span className={`badge ${STATUS_VENCIMENTO_COLOR[statusVencimento(c.data_vencimento_contrato)]}`}>
                    {formatDate(c.data_vencimento_contrato)}
                    {(() => {
                      const d = diasParaVencimento(c.data_vencimento_contrato);
                      if (d == null) return null;
                      if (d < 0) return ` · ${-d}d atrás`;
                      return ` · ${d}d`;
                    })()}
                  </span>
                ) : (
                  <span className="text-xs text-brand-muted">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right space-x-3">
                <button onClick={() => onEdit(c)} className="text-xs text-brand-muted hover:text-gray-200">editar</button>
                <button onClick={() => onRemove(c.id)} className="text-xs text-brand-muted hover:text-red-400">excluir</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function KanbanGP({
  clientes, pessoas, onEdit, onRemove,
}: {
  clientes: ClienteView[];
  pessoas: Pessoa[];
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
}) {
  // Agrupa por account_id (GP)
  const gps = pessoas.filter((p) => p.cargo === "gestor_projetos");
  const semGP = clientes.filter((c) => !c.account_id);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {gps.map((gp) => {
        const items = clientes.filter((c) => c.account_id === gp.id);
        const soma = items.reduce((s, c) => s + (Number(c.mrr) || 0), 0);
        return (
          <div key={gp.id} className="rounded-xl border border-white/5 bg-black/20 p-3">
            <div className="mb-2 flex items-center gap-2 px-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand/20 font-bold text-brand">
                {gp.nome.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold">{gp.nome}</p>
                <p className="text-[10px] text-brand-muted">{items.length} clientes · {formatBRL(soma)}</p>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {items.map((c) => <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} compact />)}
              {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-brand-muted">vazio</p>}
            </div>
          </div>
        );
      })}

      {semGP.length > 0 && (
        <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/5 font-bold text-brand-muted">?</div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Sem GP</p>
              <p className="text-[10px] text-brand-muted">{semGP.length} clientes</p>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {semGP.map((c) => <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} compact />)}
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanSquad({
  clientes, squads, onEdit, onRemove,
}: {
  clientes: ClienteView[];
  squads: Squad[];
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
}) {
  // Data-driven: cada squad da tabela vira uma coluna automaticamente
  const semSquad = clientes.filter((c) => !c.squad_id);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {squads.map((sq) => {
        const items = clientes.filter((c) => c.squad_id === sq.id);
        const soma = items.reduce((s, c) => s + (Number(c.mrr) || 0), 0);
        return (
          <div key={sq.id} className="rounded-xl border border-white/5 bg-black/20 p-3">
            <div className="mb-2 flex items-center gap-2 px-1">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg font-bold text-white"
                   style={{ backgroundColor: sq.cor || "#1a1a1a" }}>
                {sq.nome.charAt(0)}
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold tracking-wider">{sq.nome}</p>
                <p className="text-[10px] text-brand-muted">{items.length} clientes · {formatBRL(soma)}</p>
              </div>
            </div>
            <div className="mt-3 space-y-3">
              {items.map((c) => <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} compact />)}
              {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-brand-muted">vazio</p>}
            </div>
          </div>
        );
      })}

      {semSquad.length > 0 && (
        <div className="rounded-xl border border-dashed border-white/10 bg-black/20 p-3">
          <div className="mb-2 flex items-center gap-2 px-1">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/5 font-bold text-brand-muted">?</div>
            <div className="flex-1">
              <p className="text-sm font-semibold">Sem squad</p>
              <p className="text-[10px] text-brand-muted">{semSquad.length} clientes</p>
            </div>
          </div>
          <div className="mt-3 space-y-3">
            {semSquad.map((c) => <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} compact />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ClienteCard({
  c, onEdit, onRemove, onMove, compact,
}: {
  c: ClienteView;
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
  onMove?: (c: ClienteView, e: EtapaCliente) => void;
  compact?: boolean;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium">{c.nome}</p>
        {!compact && <span className={`badge shrink-0 ${ETAPA_COLOR[c.etapa]}`}>{ETAPA_LABEL[c.etapa]}</span>}
      </div>
      <p className="mt-1 text-xs font-semibold text-brand">{formatBRL(c.mrr)}/mês</p>
      <div className="mt-2 flex flex-wrap gap-1 text-[10px] text-brand-muted">
        {c.tier && <span>{TIER_LABEL[c.tier]}</span>}
        {c.squad_nome && <span>• {c.squad_nome}</span>}
        {c.lt_meses != null && <span>• {c.lt_meses}m</span>}
      </div>
      {c.account_nome && !compact && (
        <p className="mt-1 text-[10px] text-brand-muted">GP: {c.account_nome}</p>
      )}
      {c.data_vencimento_contrato && (() => {
        const status = statusVencimento(c.data_vencimento_contrato);
        if (status === "ok" || status === "sem_data") return null;
        const dias = diasParaVencimento(c.data_vencimento_contrato);
        return (
          <div className={`mt-2 rounded border px-2 py-1 text-[10px] ${STATUS_VENCIMENTO_COLOR[status]}`}>
            {status === "vencido"
              ? `⚠ Vencido há ${-(dias ?? 0)} dias`
              : `⏱ Vence em ${dias} dias (${formatDate(c.data_vencimento_contrato)})`}
          </div>
        );
      })()}
      {onMove && (
        <select
          value={c.etapa}
          onChange={(e) => onMove(c, e.target.value as EtapaCliente)}
          className="input mt-2 py-1 text-xs"
        >
          {ETAPAS.map((et) => <option key={et} value={et}>{ETAPA_LABEL[et]}</option>)}
          <option value="cancelado">Cancelado</option>
        </select>
      )}
      <div className="mt-2 flex items-center justify-between text-[10px] text-brand-muted">
        <button onClick={() => onEdit(c)} className="hover:text-gray-200">editar</button>
        <button onClick={() => onRemove(c.id)} className="hover:text-red-400">excluir</button>
      </div>
    </div>
  );
}
