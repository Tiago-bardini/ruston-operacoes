"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClienteView, Pessoa, Squad, EtapaCliente, TierCliente, FcaView } from "@/lib/types";
import {
  ETAPA_LABEL, ETAPA_COLOR, TIER_LABEL, formatBRL, formatDate,
  statusVencimento, diasParaVencimento, STATUS_VENCIMENTO_COLOR,
} from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { ModalSubirChurn, efetivarChurn, abrirRetencao } from "@/components/churn/ChurnEfetivado";
import { ModalEeFinalizada, finalizarEE } from "@/components/clientes/EeFinalizada";
import { TagSemanaEE, carregarSemanasEE, salvarSemanaEE } from "@/components/clientes/TagSemanaEE";

const ETAPAS: EtapaCliente[] = ["onboarding", "estruturacao_estrategica", "byline", "em_recuperacao", "suspenso"];
const TIERS: TierCliente[] = ["tiny", "small", "medium", "large"];

type View = "kanban_etapa" | "lista" | "kanban_gp" | "kanban_squad";

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
  whatsapp: "",
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
  const [eeModal, setEeModal] = useState<ClienteView | null>(null);
  const { isGerente, squadId: perfilSquadId } = useUsuarioPerfil();
  const [view, setView] = useState<View>("kanban_etapa");
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterSquad, setFilterSquad] = useState<string>("");

  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: ps }, { data: sq }, { data: fs }, semanasEE] = await Promise.all([
      // Traz TODOS (ativos + churn) — o alerta de churn pendente usa os churnados
      supabase.from("ruston_clientes_view").select("*").order("nome"),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_fca_view").select("*").order("ano", { ascending: false }).order("mes", { ascending: false }),
      carregarSemanasEE(supabase),
    ]);
    setClientes(((cs as ClienteView[]) ?? []).map((c) => ({ ...c, semana_ee: semanasEE[c.id] ?? null })));
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
      whatsapp: form.whatsapp
        ? form.whatsapp.split(",")
            .map((n) => n.replace(/\D/g, ""))
            .filter((n) => n.length >= 10)
            .join(",") || null
        : null,
      coordenador_id: form.coordenador_id || null,
      account_id: form.account_id || null,
      gestor_trafego_id: form.gestor_trafego_id || null,
      designer_id: form.designer_id || null,
      squad_id: form.squad_id || null,
      observacoes: form.observacoes || null,
    };
    if (editingId) {
      const antes = clientes.find((c) => c.id === editingId);
      const { error } = await supabase.from("ruston_clientes").update(payload).eq("id", editingId);
      if (!error && payload.etapa === "em_recuperacao" && antes?.etapa !== "em_recuperacao") {
        await abrirRetencao(supabase, { id: editingId, mrr: payload.mrr });
      }
    } else {
      const { data: novo } = await supabase.from("ruston_clientes").insert(payload).select("id").maybeSingle();
      if (novo && payload.etapa === "em_recuperacao") await abrirRetencao(supabase, { id: novo.id, mrr: payload.mrr });
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
      whatsapp: c.whatsapp ?? "",
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
    const { error } = await supabase.from("ruston_clientes").update({ etapa }).eq("id", c.id);
    // Em Retenção já conta como churn do mês na aba Churn
    if (!error && etapa === "em_recuperacao" && c.etapa !== "em_recuperacao") await abrirRetencao(supabase, c);
    load();
  }

  async function mudarSemanaEE(c: ClienteView, semana: number | null) {
    const error = await salvarSemanaEE(supabase, c.id, semana);
    if (!error) setClientes((cs) => cs.map((x) => (x.id === c.id ? { ...x, semana_ee: semana } : x)));
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
      // Coordenador/Investidor: só vê clientes do próprio squad
      if (!isGerente && perfilSquadId && c.squad_id !== perfilSquadId) return false;
      // Só ativos — churn efetivado fica em /churn (aba Efetivados)
      if (!c.ativo || c.churn_realizado) return false;
      if (filterSquad && c.squad_id !== filterSquad) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        (c.codigo_interno ?? "").toLowerCase().includes(q) ||
        (c.account_nome ?? "").toLowerCase().includes(q) ||
        (c.squad_nome ?? "").toLowerCase().includes(q)
      );
    });
  }, [clientes, search, filterSquad, isGerente, perfilSquadId]);

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
            <a href="/churn?aba=efetivados" className="btn text-xs">Ver churns</a>
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
            <div className="lg:col-span-3">
              <label className="label">📱 WhatsApp(s) do cliente</label>
              <textarea
                className="input"
                rows={2}
                value={form.whatsapp}
                onChange={(e) => setForm({ ...form, whatsapp: e.target.value })}
                placeholder="Ex: 5541988888888, 5541977777777"
              />
              <p className="mt-1 text-[10px] text-brand-muted">
                Vários números? Separa por vírgula. Usado pelo Radar WhatsApp pra ligar conversas ao cliente. Pode colar com (), -, espaços — a gente limpa.
              </p>
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
        <KanbanEtapa clientes={filtered} onEdit={edit} onRemove={remove} onFinalizarEE={setEeModal} onSemanaEE={mudarSemanaEE} onMove={moveEtapa} />
      )}

      {!loading && filtered.length > 0 && view === "lista" && (
        <Lista clientes={filtered} onEdit={edit} onRemove={remove} onFinalizarEE={setEeModal} onSemanaEE={mudarSemanaEE} />
      )}

      {!loading && filtered.length > 0 && view === "kanban_gp" && (
        <KanbanGP clientes={filtered} pessoas={pessoas} onEdit={edit} onRemove={remove} onFinalizarEE={setEeModal} onSemanaEE={mudarSemanaEE} />
      )}

      {!loading && filtered.length > 0 && view === "kanban_squad" && (
        <KanbanSquad clientes={filtered} squads={squads} onEdit={edit} onRemove={remove} onFinalizarEE={setEeModal} onSemanaEE={mudarSemanaEE} />
      )}

      {/* Modal SUBIR CHURN */}
      {churnModal && (
        <ModalSubirChurn
          cliente={churnModal}
          onFechar={() => setChurnModal(null)}
          onConfirmar={async (payload) => {
            const error = await efetivarChurn(supabase, churnModal, payload);
            if (error) return; // o AvisoErro já mostra a falha
            setChurnModal(null);
            load();
          }}
        />
      )}

      {/* Modal E.E FINALIZADA */}
      {eeModal && (
        <ModalEeFinalizada
          cliente={eeModal}
          onFechar={() => setEeModal(null)}
          onConfirmar={async (payload) => {
            const error = await finalizarEE(supabase, eeModal, payload);
            if (error) return; // o AvisoErro já mostra a falha
            setEeModal(null);
            load();
          }}
        />
      )}

      {/* Botões flutuantes SUBIR CHURN / E.E FINALIZADA quando editando */}
      {formOpen && editingId && (
        <div className="fixed bottom-4 right-4 z-40 flex gap-2">
          <button
            className="btn bg-sky-600 hover:bg-sky-700 border-sky-500 text-white text-xs"
            onClick={() => {
              const c = clientes.find((x) => x.id === editingId);
              if (c) { setFormOpen(false); setEeModal(c); }
            }}
          >
            🧭 E.E Finalizada
          </button>
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

/* -------- SUB-COMPONENTES -------- */

function KanbanEtapa({
  clientes, onEdit, onRemove, onFinalizarEE, onSemanaEE, onMove,
}: {
  clientes: ClienteView[];
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
  onFinalizarEE: (c: ClienteView) => void;
  onSemanaEE: (c: ClienteView, semana: number | null) => void;
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
                <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} onFinalizarEE={onFinalizarEE} onSemanaEE={onSemanaEE} onMove={onMove} />
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
  clientes, onEdit, onRemove, onFinalizarEE, onSemanaEE,
}: {
  clientes: ClienteView[];
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
  onFinalizarEE: (c: ClienteView) => void;
  onSemanaEE: (c: ClienteView, semana: number | null) => void;
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
                <div className="flex items-center gap-2">
                  <p className="font-medium">{c.nome}</p>
                  {c.etapa === "estruturacao_estrategica" && (
                    <TagSemanaEE semana={c.semana_ee} onChange={(s) => onSemanaEE(c, s)} />
                  )}
                </div>
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
                <a href={`/planejamento?cliente=${c.id}`}
                  className="inline-flex items-center gap-1 rounded-md border border-brand/40 bg-brand/15 px-2 py-1 text-xs font-semibold text-white hover:bg-brand/30">
                  📊 Planejamento
                </a>
                <button onClick={() => onEdit(c)} className="text-xs text-brand-muted hover:text-gray-200">editar</button>
                <button onClick={() => onFinalizarEE(c)} className="text-xs text-brand-muted hover:text-sky-300">E.E finalizada</button>
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
  clientes, pessoas, onEdit, onRemove, onFinalizarEE, onSemanaEE,
}: {
  clientes: ClienteView[];
  pessoas: Pessoa[];
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
  onFinalizarEE: (c: ClienteView) => void;
  onSemanaEE: (c: ClienteView, semana: number | null) => void;
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
              {items.map((c) => <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} onFinalizarEE={onFinalizarEE} onSemanaEE={onSemanaEE} compact />)}
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
            {semGP.map((c) => <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} onFinalizarEE={onFinalizarEE} onSemanaEE={onSemanaEE} compact />)}
          </div>
        </div>
      )}
    </div>
  );
}

function KanbanSquad({
  clientes, squads, onEdit, onRemove, onFinalizarEE, onSemanaEE,
}: {
  clientes: ClienteView[];
  squads: Squad[];
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
  onFinalizarEE: (c: ClienteView) => void;
  onSemanaEE: (c: ClienteView, semana: number | null) => void;
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
              {items.map((c) => <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} onFinalizarEE={onFinalizarEE} onSemanaEE={onSemanaEE} compact />)}
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
            {semSquad.map((c) => <ClienteCard key={c.id} c={c} onEdit={onEdit} onRemove={onRemove} onFinalizarEE={onFinalizarEE} onSemanaEE={onSemanaEE} compact />)}
          </div>
        </div>
      )}
    </div>
  );
}

function ClienteCard({
  c, onEdit, onRemove, onFinalizarEE, onSemanaEE, onMove, compact,
}: {
  c: ClienteView;
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
  onFinalizarEE: (c: ClienteView) => void;
  onSemanaEE: (c: ClienteView, semana: number | null) => void;
  onMove?: (c: ClienteView, e: EtapaCliente) => void;
  compact?: boolean;
}) {
  return (
    <div className="card p-3">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold leading-snug">{c.nome}</p>
        {c.etapa === "estruturacao_estrategica" && (
          <TagSemanaEE semana={c.semana_ee} onChange={(s) => onSemanaEE(c, s)} />
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-2">
        <p className="min-w-0 truncate text-xs font-semibold text-brand">{formatBRL(c.mrr)}/mês</p>
        {/* No Kanban por Etapa a coluna já diz a fase — aqui fica só o atalho pra mover */}
        {onMove ? (
          <label className="relative inline-flex shrink-0 cursor-pointer items-center gap-1 overflow-hidden rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-brand-muted transition hover:border-white/20 hover:text-gray-200"
            title="Mover de etapa">
            Mover <span className="text-[8px]">▼</span>
            <select
              value={c.etapa}
              onChange={(e) => onMove(c, e.target.value as EtapaCliente)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            >
              {ETAPAS.map((et) => <option key={et} value={et} className="bg-brand-panel text-gray-100">{ETAPA_LABEL[et]}</option>)}
              <option value="cancelado" className="bg-brand-panel text-gray-100">Cancelado</option>
            </select>
          </label>
        ) : !compact && (
          <span className={`badge max-w-[120px] shrink-0 truncate text-[10px] ${ETAPA_COLOR[c.etapa]}`}>{ETAPA_LABEL[c.etapa]}</span>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-x-1.5 text-[10px] text-brand-muted">
        {c.tier && <span>{TIER_LABEL[c.tier]}</span>}
        {c.squad_nome && <span>· {c.squad_nome}</span>}
        {c.lt_meses != null && <span>· {c.lt_meses}m</span>}
        {c.account_nome && !compact && <span>· GP {c.account_nome}</span>}
      </div>
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
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/5 pt-2.5">
        <a href={`/planejamento?cliente=${c.id}`}
          className="inline-flex items-center gap-1 whitespace-nowrap rounded-md border border-brand/40 bg-brand/15 px-2 py-1 text-[11px] font-semibold text-white transition hover:bg-brand/30">
          📊 Planejamento
        </a>
        <div className="flex items-center gap-1 text-brand-muted">
          <button onClick={() => onEdit(c)} title="Editar"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-white/5 hover:text-gray-200">✎</button>
          <button onClick={() => onFinalizarEE(c)} title="E.E Finalizada (não fechou a assessoria)"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-white/5 hover:text-sky-300">🧭</button>
          <button onClick={() => onRemove(c.id)} title="Excluir"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-white/5 hover:text-red-400">🗑</button>
        </div>
      </div>
    </div>
  );
}
