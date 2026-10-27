"use client";

import { useEffect, useState, useMemo, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClienteView, Pessoa, Squad, EtapaCliente, TierCliente, FcaView } from "@/lib/types";
import {
  ETAPA_LABEL, ETAPA_COLOR, TIER_LABEL, formatBRL, formatDate,
  statusVencimento, diasParaVencimento, STATUS_VENCIMENTO_COLOR,
} from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { ModalSubirChurn, efetivarChurn, abrirRetencao } from "@/components/churn/ChurnEfetivado";
import { ModalEeFinalizada, finalizarEE } from "@/components/clientes/EeFinalizada";
import {
  TagSemanaEE, carregarSemanasEE, salvarSemanaEE,
  TagContratoCliente, carregarTagsContrato, salvarTagContrato, type TagContrato, TAG_CONTRATO_LABEL,
} from "@/components/clientes/TagSemanaEE";

const ETAPAS: EtapaCliente[] = ["onboarding", "estruturacao_estrategica", "byline", "em_recuperacao", "suspenso"];
const TIERS: TierCliente[] = ["tiny", "small", "medium", "large"];

type View = "kanban_etapa" | "lista" | "kanban_gp" | "kanban_squad";

type Filtros = {
  busca: string; squad: string; gp: string; etapa: string; tag: string; semana: string; fca: string; vencendo: boolean;
};
const filtrosVazios: Filtros = { busca: "", squad: "", gp: "", etapa: "", tag: "", semana: "", fca: "", vencendo: false };
const CHAVE_PREFS = "carteira:prefs";

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
  const [view, setView] = useState<View>("kanban_gp");
  const [filtros, setFiltros] = useState<Filtros>(filtrosVazios);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Visão e filtros ficam salvos neste navegador ao voltar pra tela
  useEffect(() => {
    try {
      const salvo = JSON.parse(localStorage.getItem(CHAVE_PREFS) ?? "null");
      if (salvo?.view) setView(salvo.view);
      if (salvo?.filtros) setFiltros({ ...filtrosVazios, ...salvo.filtros });
    } catch { /* sem localStorage: usa o padrão */ }
  }, []);
  useEffect(() => {
    try { localStorage.setItem(CHAVE_PREFS, JSON.stringify({ view, filtros })); } catch { /* ignora */ }
  }, [view, filtros]);

  function alternar(campo: "fca" | "etapa", valor: string) {
    setFiltros((f) => ({ ...f, [campo]: f[campo] === valor ? "" : valor }));
  }

  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: ps }, { data: sq }, { data: fs }, semanasEE, tagsContrato] = await Promise.all([
      // Traz TODOS (ativos + churn) — o alerta de churn pendente usa os churnados
      supabase.from("ruston_clientes_view").select("*").order("nome"),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_fca_view").select("*").order("ano", { ascending: false }).order("mes", { ascending: false }),
      carregarSemanasEE(supabase),
      carregarTagsContrato(supabase),
    ]);
    setClientes(((cs as ClienteView[]) ?? []).map((c) => ({ ...c, semana_ee: semanasEE[c.id] ?? null, tag_contrato: tagsContrato[c.id] ?? null })));
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

  async function mudarTagContrato(c: ClienteView, tag: TagContrato | null) {
    const error = await salvarTagContrato(supabase, c.id, tag);
    if (!error) setClientes((cs) => cs.map((x) => (x.id === c.id ? { ...x, tag_contrato: tag } : x)));
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

  // Base da carteira: perfil (coordenador vê só o squad) + só ativos.
  // Churn efetivado fica em /churn (aba Efetivados)
  const base = useMemo(() => clientes.filter((c) => {
    if (!isGerente && perfilSquadId && c.squad_id !== perfilSquadId) return false;
    return c.ativo && !c.churn_realizado;
  }), [clientes, isGerente, perfilSquadId]);

  const filtered = useMemo(() => {
    const q = filtros.busca.trim().toLowerCase();
    return base.filter((c) => {
      if (filtros.squad && c.squad_id !== filtros.squad) return false;
      if (filtros.gp && (filtros.gp === "sem" ? c.account_id : c.account_id !== filtros.gp)) return false;
      if (filtros.etapa && c.etapa !== filtros.etapa) return false;
      if (filtros.tag && (filtros.tag === "sem" ? c.tag_contrato : c.tag_contrato !== filtros.tag)) return false;
      if (filtros.semana && (filtros.semana === "sem" ? c.semana_ee : String(c.semana_ee ?? "") !== filtros.semana)) return false;
      if (filtros.fca && (fcasRecentes[c.id]?.bandeira ?? "sem_dado") !== filtros.fca) return false;
      if (filtros.vencendo && !vencendoLogo(c)) return false;
      if (!q) return true;
      return (
        c.nome.toLowerCase().includes(q) ||
        (c.codigo_interno ?? "").toLowerCase().includes(q) ||
        (c.account_nome ?? "").toLowerCase().includes(q) ||
        (c.squad_nome ?? "").toLowerCase().includes(q)
      );
    });
  }, [base, filtros, fcasRecentes]);

  // Churns pendentes de subir no sistema (data <= hoje E não subiu)
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
  const nFcaVermelho = base.filter((c) => fcasRecentes[c.id]?.bandeira === "vermelho").length;
  const nVencendo = base.filter(vencendoLogo).length;
  const nEmEE = base.filter((c) => c.etapa === "estruturacao_estrategica").length;
  const filtrosAtivos = Object.entries(filtros).some(([, v]) => v);
  const gps = pessoas.filter((p) => p.cargo === "gestor_projetos");

  const acoes: AcoesCliente = {
    onEdit: edit,
    onRemove: remove,
    onFinalizarEE: setEeModal,
    onSubirChurn: setChurnModal,
    onSemanaEE: mudarSemanaEE,
    onTagContrato: mudarTagContrato,
    onMove: moveEtapa,
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Carteira</h1>
          <p className="text-sm text-brand-muted">
            {filtered.length} clientes · MRR {formatBRL(totalMRR)}
            {filtrosAtivos && <span className="text-brand"> · filtrado</span>}
          </p>
        </div>
        <button className="btn" onClick={() => { setEditingId(null); setForm(emptyForm); setFormOpen(!formOpen); }}>
          {formOpen ? "Fechar" : "+ Novo cliente"}
        </button>
      </div>

      {/* Indicadores: clicar filtra a carteira */}
      <div className="mb-4 flex flex-wrap gap-2">
        <Indicador label="clientes" valor={base.length} ativo={!filtrosAtivos}
          onClick={() => setFiltros(filtrosVazios)} />
        <Indicador label="MRR" valor={formatBRL(base.reduce((s, c) => s + (Number(c.mrr) || 0), 0))} />
        <Indicador icone="🔴" label="FCA vermelho" valor={nFcaVermelho} cor="text-red-300"
          ativo={filtros.fca === "vermelho"} onClick={() => alternar("fca", "vermelho")} />
        <Indicador icone="⏱" label="vencendo em 30d" valor={nVencendo} cor="text-orange-300"
          ativo={filtros.vencendo} onClick={() => setFiltros((f) => ({ ...f, vencendo: !f.vencendo }))} />
        <Indicador icone="🧭" label="em E.E" valor={nEmEE} cor="text-sky-300"
          ativo={filtros.etapa === "estruturacao_estrategica"} onClick={() => alternar("etapa", "estruturacao_estrategica")} />
        {churnsPendentes.length > 0 && (
          <a href="/churn?aba=efetivados" title={churnsPendentes.map((c) => c.nome).join(" · ")}>
            <Indicador icone="⚠" label="churn pendente no CRM" valor={churnsPendentes.length} cor="text-purple-300" />
          </a>
        )}
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input className="input h-8 max-w-[200px] py-1 text-xs" placeholder="Buscar cliente, GP..."
          value={filtros.busca} onChange={(e) => setFiltros((f) => ({ ...f, busca: e.target.value }))} />
        {isGerente && (
          <FiltroChip label="Squad" valor={filtros.squad} onChange={(v) => setFiltros((f) => ({ ...f, squad: v }))}
            opcoes={squads.map((s) => ({ v: s.id, l: s.nome }))} />
        )}
        <FiltroChip label="GP" valor={filtros.gp} onChange={(v) => setFiltros((f) => ({ ...f, gp: v }))}
          opcoes={[...gps.map((p) => ({ v: p.id, l: p.nome })), { v: "sem", l: "Sem GP" }]} />
        <FiltroChip label="Etapa" valor={filtros.etapa} onChange={(v) => setFiltros((f) => ({ ...f, etapa: v }))}
          opcoes={ETAPAS.map((et) => ({ v: et, l: ETAPA_LABEL[et] }))} />
        <FiltroChip label="Tag" valor={filtros.tag} onChange={(v) => setFiltros((f) => ({ ...f, tag: v }))}
          opcoes={[...(Object.keys(TAG_CONTRATO_LABEL) as TagContrato[]).map((t) => ({ v: t, l: TAG_CONTRATO_LABEL[t] })), { v: "sem", l: "Sem tag" }]} />
        <FiltroChip label="Semana" valor={filtros.semana} onChange={(v) => setFiltros((f) => ({ ...f, semana: v }))}
          opcoes={[...[1, 2, 3, 4, 5].map((s) => ({ v: String(s), l: `S${s}` })), { v: "sem", l: "Sem semana" }]} />
        <FiltroChip label="FCA" valor={filtros.fca} onChange={(v) => setFiltros((f) => ({ ...f, fca: v }))}
          opcoes={[{ v: "verde", l: "🟢 Safe" }, { v: "amarelo", l: "🟡 Care" }, { v: "vermelho", l: "🔴 Danger" }, { v: "sem_dado", l: "Sem FCA" }]} />
        {filtrosAtivos && (
          <button className="text-xs text-brand-muted underline-offset-2 hover:text-gray-200 hover:underline"
            onClick={() => setFiltros(filtrosVazios)}>limpar filtros</button>
        )}

        {/* Toggle de views */}
        <div className="ml-auto inline-flex rounded-lg border border-white/10 bg-brand-panel/50 p-1">
          {[
            { v: "kanban_gp", label: "Por GP" },
            { v: "kanban_etapa", label: "Por Etapa" },
            { v: "kanban_squad", label: "Por Squad" },
            { v: "lista", label: "Lista" },
          ].map((it) => (
            <button
              key={it.v}
              onClick={() => setView(it.v as View)}
              className={`rounded-md px-3 py-1 text-xs font-medium transition ${
                view === it.v ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"
              }`}
            >
              {it.label}
            </button>
          ))}
        </div>
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
        <KanbanEtapa clientes={filtered} fcas={fcasRecentes} acoes={acoes} />
      )}

      {!loading && filtered.length > 0 && view === "lista" && (
        <Lista clientes={filtered} fcas={fcasRecentes} acoes={acoes} />
      )}

      {!loading && filtered.length > 0 && view === "kanban_gp" && (
        <KanbanGP clientes={filtered} gps={gps} fcas={fcasRecentes} acoes={acoes} />
      )}

      {!loading && filtered.length > 0 && view === "kanban_squad" && (
        <KanbanSquad clientes={filtered} squads={squads} fcas={fcasRecentes} acoes={acoes} />
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

type AcoesCliente = {
  onEdit: (c: ClienteView) => void;
  onRemove: (id: string) => void;
  onFinalizarEE: (c: ClienteView) => void;
  onSubirChurn: (c: ClienteView) => void;
  onSemanaEE: (c: ClienteView, semana: number | null) => void;
  onTagContrato: (c: ClienteView, tag: TagContrato | null) => void;
  onMove: (c: ClienteView, e: EtapaCliente) => void;
};
type Fcas = Record<string, FcaView>;

/** Contrato vencido ou vencendo em até 30 dias — o que pede ação agora. */
function vencendoLogo(c: ClienteView) {
  const s = statusVencimento(c.data_vencimento_contrato);
  return s === "vencido" || s === "critico";
}

const BOLINHA_FCA: Record<string, string> = {
  verde: "bg-emerald-500",
  amarelo: "bg-amber-500",
  vermelho: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]",
  sem_dado: "bg-white/20",
};
const LABEL_FCA: Record<string, string> = { verde: "Safe", amarelo: "Care", vermelho: "Danger", sem_dado: "Sem FCA" };

function BolinhaFca({ fca }: { fca?: FcaView }) {
  const b = fca?.bandeira ?? "sem_dado";
  return (
    <span className={`mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full ${BOLINHA_FCA[b]}`}
      title={`FCA: ${LABEL_FCA[b]}${fca?.nota_final != null ? ` · nota ${Number(fca.nota_final).toFixed(1)}` : ""}`} />
  );
}

function Indicador({ icone, label, valor, cor, ativo, onClick }: {
  icone?: string; label: string; valor: number | string; cor?: string; ativo?: boolean; onClick?: () => void;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick}
      className={`inline-flex items-baseline gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition ${
        ativo ? "border-brand/60 bg-brand/15" : "border-white/10 bg-white/[0.03]"
      } ${onClick ? "cursor-pointer hover:border-white/25" : ""}`}>
      {icone && <span>{icone}</span>}
      <span className={`text-sm font-bold ${cor ?? "text-white"}`}>{valor}</span>
      <span className="text-brand-muted">{label}</span>
    </Tag>
  );
}

function FiltroChip({ label, valor, opcoes, onChange }: {
  label: string; valor: string; opcoes: { v: string; l: string }[]; onChange: (v: string) => void;
}) {
  const atual = opcoes.find((o) => o.v === valor);
  return (
    <label className={`relative inline-flex h-8 cursor-pointer items-center gap-1 rounded-full border px-3 text-xs transition ${
      valor ? "border-brand/60 bg-brand/15 text-white" : "border-white/10 text-brand-muted hover:border-white/25 hover:text-gray-200"}`}>
      {label}{atual ? `: ${atual.l}` : ""} <span className="text-[8px]">▼</span>
      <select value={valor} onChange={(e) => onChange(e.target.value)}
        className="absolute inset-0 h-full w-full cursor-pointer opacity-0">
        <option value="" className="bg-brand-panel text-gray-100">Todos</option>
        {opcoes.map((o) => <option key={o.v} value={o.v} className="bg-brand-panel text-gray-100">{o.l}</option>)}
      </select>
    </label>
  );
}

/** Resumo do topo de cada coluna: clientes · MRR · FCA vermelho · vencendo. */
function ResumoColuna({ items, fcas }: { items: ClienteView[]; fcas: Fcas }) {
  const soma = items.reduce((s, c) => s + (Number(c.mrr) || 0), 0);
  const vermelhos = items.filter((c) => fcas[c.id]?.bandeira === "vermelho").length;
  const vencendo = items.filter(vencendoLogo).length;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-[10px] text-brand-muted">
      <span>{items.length} clientes</span>
      <span>· {formatBRL(soma)}</span>
      {vermelhos > 0 && <span className="font-semibold text-red-300">· 🔴 {vermelhos}</span>}
      {vencendo > 0 && <span className="font-semibold text-orange-300">· ⏱ {vencendo}</span>}
    </p>
  );
}

function Coluna({ titulo, avatar, items, fcas, acoes, mostrar, tracejada }: {
  titulo: string;
  avatar?: ReactNode;
  items: ClienteView[];
  fcas: Fcas;
  acoes: AcoesCliente;
  mostrar: "gp" | "etapa";
  tracejada?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-black/20 p-3 ${tracejada ? "border-dashed border-white/10" : "border-white/5"}`}>
      <div className="mb-3 flex items-center gap-2 px-1">
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{titulo}</p>
          <ResumoColuna items={items} fcas={fcas} />
        </div>
      </div>
      <div className="space-y-2">
        {items.map((c) => <ClienteCard key={c.id} c={c} fca={fcas[c.id]} acoes={acoes} mostrar={mostrar} />)}
        {items.length === 0 && <p className="px-1 py-4 text-center text-xs text-brand-muted">vazio</p>}
      </div>
    </div>
  );
}

function KanbanEtapa({ clientes, fcas, acoes }: { clientes: ClienteView[]; fcas: Fcas; acoes: AcoesCliente }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-5">
      {ETAPAS.map((et) => (
        <Coluna key={et} titulo={ETAPA_LABEL[et]} items={clientes.filter((c) => c.etapa === et)}
          fcas={fcas} acoes={acoes} mostrar="gp" />
      ))}
    </div>
  );
}

function KanbanGP({ clientes, gps, fcas, acoes }: { clientes: ClienteView[]; gps: Pessoa[]; fcas: Fcas; acoes: AcoesCliente }) {
  const semGP = clientes.filter((c) => !c.account_id);
  // Com filtro ativo, GP sem nenhum cliente no resultado não ocupa espaço
  const colunas = gps.map((gp) => ({ gp, items: clientes.filter((c) => c.account_id === gp.id) }))
    .filter((x) => x.items.length > 0);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {colunas.map(({ gp, items }) => (
        <Coluna key={gp.id} titulo={gp.nome} items={items} fcas={fcas} acoes={acoes} mostrar="etapa"
          avatar={
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand/20 text-sm font-bold text-brand">
              {gp.nome.charAt(0).toUpperCase()}
            </div>
          } />
      ))}
      {semGP.length > 0 && (
        <Coluna titulo="Sem GP" items={semGP} fcas={fcas} acoes={acoes} mostrar="etapa" tracejada
          avatar={<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/5 font-bold text-brand-muted">?</div>} />
      )}
    </div>
  );
}

function KanbanSquad({ clientes, squads, fcas, acoes }: { clientes: ClienteView[]; squads: Squad[]; fcas: Fcas; acoes: AcoesCliente }) {
  // Data-driven: cada squad da tabela vira uma coluna automaticamente
  const semSquad = clientes.filter((c) => !c.squad_id);
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
      {squads.map((sq) => {
        const items = clientes.filter((c) => c.squad_id === sq.id);
        if (items.length === 0) return null;
        return (
          <Coluna key={sq.id} titulo={sq.nome} items={items} fcas={fcas} acoes={acoes} mostrar="gp"
            avatar={
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-sm font-bold text-white"
                style={{ backgroundColor: sq.cor || "#1a1a1a" }}>
                {sq.nome.charAt(0)}
              </div>
            } />
        );
      })}
      {semSquad.length > 0 && (
        <Coluna titulo="Sem squad" items={semSquad} fcas={fcas} acoes={acoes} mostrar="gp" tracejada
          avatar={<div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/5 font-bold text-brand-muted">?</div>} />
      )}
    </div>
  );
}

/** Menu "⋯": mover de etapa e as ações que tiram o cliente da carteira, longe do clique acidental. */
function MenuAcoes({ c, acoes }: { c: ClienteView; acoes: AcoesCliente }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded px-1.5 py-0.5 text-sm text-brand-muted hover:bg-white/5 hover:text-gray-200 [&::-webkit-details-marker]:hidden"
        title="Mais ações">⋯</summary>
      {/* Fecha o menu depois de escolher */}
      <div className="absolute right-0 z-30 mt-1 w-48 rounded-lg border border-white/10 bg-brand-panel p-1 text-left text-xs shadow-lg"
        onClick={(e) => { (e.currentTarget.parentElement as HTMLDetailsElement).open = false; }}>
        <p className="px-2 pb-1 pt-1.5 text-[10px] uppercase tracking-wide text-brand-muted">Mover de etapa</p>
        {ETAPAS.filter((et) => et !== c.etapa).map((et) => (
          <button key={et} onClick={() => acoes.onMove(c, et)}
            className="block w-full rounded px-2 py-1.5 text-left text-gray-200 hover:bg-white/5">{ETAPA_LABEL[et]}</button>
        ))}
        <div className="my-1 border-t border-white/10" />
        <button onClick={() => acoes.onFinalizarEE(c)}
          className="block w-full rounded px-2 py-1.5 text-left text-sky-300 hover:bg-white/5">🧭 E.E Finalizada</button>
        <button onClick={() => acoes.onSubirChurn(c)}
          className="block w-full rounded px-2 py-1.5 text-left text-purple-300 hover:bg-white/5">⚠ Subir Churn</button>
        <button onClick={() => acoes.onRemove(c.id)}
          className="block w-full rounded px-2 py-1.5 text-left text-red-400 hover:bg-white/5">🗑 Excluir</button>
      </div>
    </details>
  );
}

function AvisoVencimento({ c }: { c: ClienteView }) {
  const status = statusVencimento(c.data_vencimento_contrato);
  if (status !== "vencido" && status !== "critico") return null;
  const dias = diasParaVencimento(c.data_vencimento_contrato) ?? 0;
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] ${STATUS_VENCIMENTO_COLOR[status]}`}>
      {status === "vencido" ? `⚠ vencido há ${-dias}d` : `⏱ vence em ${dias}d`}
    </span>
  );
}

/** Tags S? e "+ tag" vazias só aparecem ao passar o mouse (no celular, sempre). */
function TagsCliente({ c, acoes }: { c: ClienteView; acoes: AcoesCliente }) {
  return (
    <>
      <span className={c.semana_ee ? "inline-flex" : "inline-flex md:hidden md:group-hover:inline-flex"}>
        <TagSemanaEE semana={c.semana_ee} onChange={(s) => acoes.onSemanaEE(c, s)} />
      </span>
      <span className={c.tag_contrato ? "inline-flex" : "inline-flex md:hidden md:group-hover:inline-flex"}>
        <TagContratoCliente tag={c.tag_contrato} onChange={(t) => acoes.onTagContrato(c, t)} />
      </span>
    </>
  );
}

function ClienteCard({ c, fca, acoes, mostrar }: {
  c: ClienteView;
  fca?: FcaView;
  acoes: AcoesCliente;
  mostrar: "gp" | "etapa";
}) {
  const detalhe = mostrar === "gp"
    ? (c.account_nome ? `GP ${c.account_nome}` : "sem GP")
    : ETAPA_LABEL[c.etapa];
  return (
    <div className="group card p-2.5">
      {/* Linha 1: FCA + nome + tags */}
      <div className="flex items-start gap-2">
        <BolinhaFca fca={fca} />
        <p className="min-w-0 flex-1 text-sm font-semibold leading-snug">{c.nome}</p>
        <div className="flex shrink-0 flex-wrap justify-end gap-1">
          <TagsCliente c={c} acoes={acoes} />
        </div>
      </div>

      {/* Linha 2: MRR + GP (ou etapa, na visão por GP) */}
      <div className="mt-1 flex items-baseline gap-1.5 pl-[18px] text-xs">
        <span className="font-bold text-brand">{formatBRL(c.mrr)}</span>
        <span className="truncate text-brand-muted">· {detalhe}</span>
      </div>

      {/* Linha 3: só o que pede ação */}
      {vencendoLogo(c) && (
        <div className="mt-1.5 pl-[18px]"><AvisoVencimento c={c} /></div>
      )}

      {/* Detalhes e ações: aparecem ao passar o mouse (sempre visíveis no celular) */}
      <div className="mt-2 flex items-center justify-between gap-2 border-t border-white/5 pt-2 md:hidden md:group-focus-within:flex md:group-hover:flex">
        <p className="min-w-0 truncate text-[10px] text-brand-muted">
          {[c.tier && TIER_LABEL[c.tier], c.squad_nome, c.lt_meses != null && `LT ${c.lt_meses}m`]
            .filter(Boolean).join(" · ")}
        </p>
        <div className="flex shrink-0 items-center gap-0.5">
          <a href={`/planejamento?cliente=${c.id}`} title="Planejamento"
            className="rounded px-1.5 py-0.5 text-sm hover:bg-white/5">📊</a>
          <button onClick={() => acoes.onEdit(c)} title="Editar"
            className="rounded px-1.5 py-0.5 text-sm text-brand-muted hover:bg-white/5 hover:text-gray-200">✎</button>
          <MenuAcoes c={c} acoes={acoes} />
        </div>
      </div>
    </div>
  );
}

type Ordem = "nome" | "mrr" | "fca" | "lt" | "vencimento";

function Lista({ clientes, fcas, acoes }: { clientes: ClienteView[]; fcas: Fcas; acoes: AcoesCliente }) {
  const [ordem, setOrdem] = useState<{ campo: Ordem; asc: boolean }>({ campo: "nome", asc: true });
  const ordenados = useMemo(() => {
    const valor = (c: ClienteView): number | string => {
      switch (ordem.campo) {
        case "mrr": return Number(c.mrr) || 0;
        case "fca": return fcas[c.id]?.nota_final ?? -1;
        case "lt": return c.lt_meses ?? -1;
        case "vencimento": return c.data_vencimento_contrato ?? "9999";
        default: return c.nome.toLowerCase();
      }
    };
    return [...clientes].sort((a, b) => {
      const va = valor(a), vb = valor(b);
      const r = va < vb ? -1 : va > vb ? 1 : 0;
      return ordem.asc ? r : -r;
    });
  }, [clientes, fcas, ordem]);

  function ordenar(campo: Ordem) {
    // Primeiro clique: nome e vencimento crescente; valores (MRR, FCA, LT) do maior pro menor
    setOrdem((o) => ({ campo, asc: o.campo === campo ? !o.asc : campo === "nome" || campo === "vencimento" }));
  }
  const th = (campo: Ordem, label: string) => (
    <th className="px-3 py-3">
      <button className="inline-flex items-center gap-1 uppercase hover:text-gray-200" onClick={() => ordenar(campo)}>
        {label}{ordem.campo === campo && <span>{ordem.asc ? "▲" : "▼"}</span>}
      </button>
    </th>
  );

  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
            {th("nome", "Cliente")}
            <th className="px-3 py-3">Etapa</th>
            {th("mrr", "MRR")}
            {th("fca", "FCA")}
            <th className="px-3 py-3">GP</th>
            <th className="px-3 py-3">Squad</th>
            {th("lt", "LT")}
            {th("vencimento", "Vencimento")}
            <th className="px-3 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {ordenados.map((c) => {
            const fca = fcas[c.id];
            return (
              <tr key={c.id} className="group border-b border-white/5 last:border-0 hover:bg-white/[0.02]">
                <td className="px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="font-medium">{c.nome}</p>
                    <TagsCliente c={c} acoes={acoes} />
                  </div>
                </td>
                <td className="px-3 py-2.5">
                  <span className={`badge ${ETAPA_COLOR[c.etapa]}`}>{ETAPA_LABEL[c.etapa]}</span>
                </td>
                <td className="px-3 py-2.5 font-medium text-brand">{formatBRL(c.mrr)}</td>
                <td className="px-3 py-2.5">
                  <span className="inline-flex items-center gap-1.5 text-xs text-brand-muted">
                    <BolinhaFca fca={fca} />
                    {fca?.nota_final != null ? Number(fca.nota_final).toFixed(1) : "—"}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-brand-muted">{c.account_nome ?? "—"}</td>
                <td className="px-3 py-2.5 text-brand-muted">{c.squad_nome ?? "—"}</td>
                <td className="px-3 py-2.5 text-brand-muted">{c.lt_meses != null ? `${c.lt_meses} m` : "—"}</td>
                <td className="px-3 py-2.5">
                  {c.data_vencimento_contrato ? (
                    <span className={`badge ${STATUS_VENCIMENTO_COLOR[statusVencimento(c.data_vencimento_contrato)]}`}>
                      {formatDate(c.data_vencimento_contrato)}
                    </span>
                  ) : (
                    <span className="text-xs text-brand-muted">—</span>
                  )}
                </td>
                <td className="px-3 py-2.5">
                  <div className="flex items-center justify-end gap-0.5">
                    <a href={`/planejamento?cliente=${c.id}`} title="Planejamento"
                      className="rounded px-1.5 py-0.5 text-sm hover:bg-white/5">📊</a>
                    <button onClick={() => acoes.onEdit(c)} title="Editar"
                      className="rounded px-1.5 py-0.5 text-sm text-brand-muted hover:bg-white/5 hover:text-gray-200">✎</button>
                    <MenuAcoes c={c} acoes={acoes} />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
