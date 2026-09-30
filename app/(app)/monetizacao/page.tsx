"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import type { ClienteView, Pessoa, Squad } from "@/lib/types";
import { formatBRL, MESES_LABEL } from "@/lib/types";

// ============================================================
// TIPOS
// ============================================================
type Estagio = "ideia" | "apresentado" | "negociacao" | "ganho" | "perdido";

const ESTAGIOS: { key: Estagio; label: string; cor: string; corBg: string }[] = [
  { key: "ideia",        label: "💡 Ideia",         cor: "text-brand-muted",  corBg: "bg-white/5 border-white/10" },
  { key: "apresentado",  label: "📤 Apresentado",   cor: "text-sky-300",      corBg: "bg-sky-500/10 border-sky-500/30" },
  { key: "negociacao",   label: "🤝 Negociação",    cor: "text-amber-300",    corBg: "bg-amber-500/10 border-amber-500/30" },
  { key: "ganho",        label: "✅ Ganho",          cor: "text-emerald-300",  corBg: "bg-emerald-500/10 border-emerald-500/30" },
  { key: "perdido",      label: "❌ Perdido",       cor: "text-red-300",      corBg: "bg-red-500/10 border-red-500/30" },
];

type Oportunidade = {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  cliente_mrr_atual: number;
  cliente_squad_id: string | null;
  cliente_account_id: string | null;
  squad_nome: string | null;
  gp_nome: string | null;
  responsavel_id: string | null;
  responsavel_nome: string | null;
  titulo: string;
  descricao: string | null;
  estagio: Estagio;
  valor_mrr_estimado: number;
  valor_onetime_estimado: number;
  probabilidade: number;
  data_prevista_fechamento: string | null;
  data_ganho: string | null;
  data_perda: string | null;
  motivo_perda: string | null;
  observacoes: string | null;
  ordem_kanban: number;
  aplicado_no_mrr: boolean;
  criado_por_email: string | null;
  dias_parado: number;
  created_at: string;
  updated_at: string;
};

type Aba = "pipeline" | "por_cliente";

// ============================================================
// PÁGINA
// ============================================================
export default function MonetizacaoPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, isGerente, isCoordenador, squadId, email } = useUsuarioPerfil();
  const podeEditar = isGerente || isCoordenador;
  const [aba, setAba] = useState<Aba>("pipeline");
  const [ops, setOps] = useState<Oportunidade[]>([]);
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroSquad, setFiltroSquad] = useState<string>("");
  const [filtroGP, setFiltroGP] = useState<string>("");
  const [editando, setEditando] = useState<Oportunidade | null>(null);
  const [novaPara, setNovaPara] = useState<{ cliente_id: string; cliente_nome: string } | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: o }, { data: c }, { data: p }, { data: s }] = await Promise.all([
      supabase.from("ruston_monetizacao_view").select("*").eq("ativo", true),
      supabase.from("ruston_clientes_view").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
    ]);
    setOps((o as Oportunidade[]) ?? []);
    setClientes((c as ClienteView[]) ?? []);
    setPessoas((p as Pessoa[]) ?? []);
    setSquads((s as Squad[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { if (!loadingPerfil) load(); /* eslint-disable-next-line */ }, [loadingPerfil]);

  // Coord só vê seu squad; gerente vê tudo
  const opsFiltradas = useMemo(() => {
    return ops.filter((o) => {
      if (isCoordenador && !isGerente && squadId && o.cliente_squad_id !== squadId) return false;
      if (filtroSquad && o.cliente_squad_id !== filtroSquad) return false;
      if (filtroGP && o.cliente_account_id !== filtroGP) return false;
      return true;
    });
  }, [ops, isCoordenador, isGerente, squadId, filtroSquad, filtroGP]);

  const clientesFiltrados = useMemo(() => {
    return clientes.filter((c) => {
      if (isCoordenador && !isGerente && squadId && c.squad_id !== squadId) return false;
      if (filtroSquad && c.squad_id !== filtroSquad) return false;
      if (filtroGP && c.account_id !== filtroGP) return false;
      return true;
    });
  }, [clientes, isCoordenador, isGerente, squadId, filtroSquad, filtroGP]);

  // ------------------------------------------------------------
  // Move oportunidade entre estágios (drag & drop)
  // ------------------------------------------------------------
  async function moverEstagio(opId: string, novoEstagio: Estagio) {
    const op = ops.find((o) => o.id === opId);
    if (!op) return;
    if (op.estagio === novoEstagio) return;

    // Se está movendo pra GANHO com MRR, pergunta se aplica no cliente
    let aplicarMrr = false;
    if (novoEstagio === "ganho" && op.valor_mrr_estimado > 0 && !op.aplicado_no_mrr) {
      const cli = clientes.find((c) => c.id === op.cliente_id);
      aplicarMrr = confirm(
        `Somar R$ ${op.valor_mrr_estimado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} no MRR de "${op.cliente_nome}"?\n\n` +
        `MRR atual: ${formatBRL(cli?.mrr ?? 0)}\n` +
        `MRR novo: ${formatBRL((cli?.mrr ?? 0) + op.valor_mrr_estimado)}\n\n` +
        `OK = soma no MRR do cliente\nCancelar = só marca como Ganho (não mexe no MRR)`
      );
    }

    // Se está movendo pra PERDIDO, pergunta motivo
    let motivoPerda = op.motivo_perda;
    if (novoEstagio === "perdido") {
      const motivo = prompt("Motivo da perda (obrigatório):", motivoPerda ?? "");
      if (motivo === null) { setArrastando(null); return; }
      motivoPerda = motivo.trim() || "Não informado";
    }

    const payload: any = {
      estagio: novoEstagio,
      motivo_perda: novoEstagio === "perdido" ? motivoPerda : null,
      data_ganho: novoEstagio === "ganho" ? new Date().toISOString().slice(0, 10) : null,
      data_perda: novoEstagio === "perdido" ? new Date().toISOString().slice(0, 10) : null,
      probabilidade: novoEstagio === "ganho" ? 100 : novoEstagio === "perdido" ? 0 : op.probabilidade,
      aplicado_no_mrr: aplicarMrr ? true : op.aplicado_no_mrr,
    };

    await supabase.from("ruston_monetizacao_oportunidades").update(payload).eq("id", opId);

    // Aplica no MRR do cliente se confirmado
    if (aplicarMrr) {
      const cli = clientes.find((c) => c.id === op.cliente_id);
      const novoMrr = (cli?.mrr ?? 0) + op.valor_mrr_estimado;
      await supabase.from("ruston_clientes")
        .update({ mrr: novoMrr, fee: novoMrr })
        .eq("id", op.cliente_id);
    }
    setArrastando(null);
    load();
  }

  async function remover(op: Oportunidade) {
    if (!confirm(`Excluir a oportunidade "${op.titulo}" do cliente ${op.cliente_nome}?`)) return;
    await supabase.from("ruston_monetizacao_oportunidades").update({ ativo: false }).eq("id", op.id);
    load();
  }

  // ------------------------------------------------------------
  // Métricas do topo
  // ------------------------------------------------------------
  const stats = useMemo(() => {
    const abertas = opsFiltradas.filter((o) => o.estagio !== "ganho" && o.estagio !== "perdido");
    const ganhas = opsFiltradas.filter((o) => o.estagio === "ganho");
    const perdidas = opsFiltradas.filter((o) => o.estagio === "perdido");
    const mesAtual = new Date().getMonth();
    const anoAtual = new Date().getFullYear();
    const ganhasMes = ganhas.filter((o) => {
      if (!o.data_ganho) return false;
      const d = new Date(o.data_ganho);
      return d.getMonth() === mesAtual && d.getFullYear() === anoAtual;
    });

    const mrrPipeline = abertas.reduce((s, o) => s + (o.valor_mrr_estimado * o.probabilidade / 100), 0);
    const otPipeline = abertas.reduce((s, o) => s + (o.valor_onetime_estimado * o.probabilidade / 100), 0);
    const mrrGanhoMes = ganhasMes.reduce((s, o) => s + o.valor_mrr_estimado, 0);
    const otGanhoMes = ganhasMes.reduce((s, o) => s + o.valor_onetime_estimado, 0);

    const totalFechado = ganhas.length + perdidas.length;
    const conversao = totalFechado > 0 ? Math.round((ganhas.length / totalFechado) * 100) : 0;
    const paradas = abertas.filter((o) => o.dias_parado > 14).length;

    return { abertas: abertas.length, ganhas: ganhas.length, perdidas: perdidas.length,
             mrrPipeline, otPipeline, mrrGanhoMes, otGanhoMes, conversao, paradas };
  }, [opsFiltradas]);

  if (loadingPerfil || loading) {
    return <p className="text-brand-muted">Carregando...</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">💰 Monetização</h1>
          <p className="text-sm text-brand-muted">
            Pipeline de oportunidades de expansão · upsell · cross-sell · vendas pontuais
          </p>
        </div>
      </div>

      {/* Métricas topo */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
        <StatCard label="Em pipeline" valor={stats.abertas} sub="oportunidades" cor="text-white" />
        <StatCard label="MRR ponderado" valor={formatBRL(stats.mrrPipeline)} sub="× probabilidade" cor="text-sky-300" />
        <StatCard label="One-time pond." valor={formatBRL(stats.otPipeline)} sub="× probabilidade" cor="text-sky-300" />
        <StatCard label={`Ganho ${MESES_LABEL[new Date().getMonth()].slice(0,3)}`} valor={formatBRL(stats.mrrGanhoMes + stats.otGanhoMes)} sub={`${stats.mrrGanhoMes > 0 ? formatBRL(stats.mrrGanhoMes) + " MRR · " : ""}${formatBRL(stats.otGanhoMes)} one-time`} cor="text-emerald-300" />
        <StatCard label="Conversão" valor={`${stats.conversao}%`} sub={`${stats.ganhas}g / ${stats.perdidas}p`} cor="text-white" />
        <StatCard label="Paradas +14d" valor={stats.paradas} sub="precisa mover" cor={stats.paradas > 0 ? "text-red-300" : "text-emerald-300"} />
      </div>

      {/* Abas */}
      <div className="mb-4 inline-flex rounded-lg border border-white/10 bg-brand-panel/50 p-1">
        {[
          { v: "pipeline",    label: "Pipeline (Kanban)" },
          { v: "por_cliente", label: "Por cliente" },
        ].map((it) => (
          <button
            key={it.v}
            onClick={() => setAba(it.v as Aba)}
            className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
              aba === it.v ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>

      {/* Filtros */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {isGerente && (
          <select className="input max-w-[180px]" value={filtroSquad} onChange={(e) => setFiltroSquad(e.target.value)}>
            <option value="">Todos os squads</option>
            {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
          </select>
        )}
        <select className="input max-w-[220px]" value={filtroGP} onChange={(e) => setFiltroGP(e.target.value)}>
          <option value="">Todos os GPs</option>
          {pessoas.filter((p) => p.cargo === "gestor_projetos").map((p) => (
            <option key={p.id} value={p.id}>{p.nome}</option>
          ))}
        </select>
        {podeEditar && (
          <button className="btn ml-auto" onClick={() => setEditando(null as any)}>
            + Nova oportunidade
          </button>
        )}
      </div>

      {/* Conteúdo das abas */}
      {aba === "pipeline" && (
        <Kanban
          ops={opsFiltradas}
          arrastando={arrastando}
          setArrastando={setArrastando}
          moverEstagio={moverEstagio}
          podeEditar={podeEditar}
          onEditar={(o) => setEditando(o)}
          onRemover={remover}
        />
      )}

      {aba === "por_cliente" && (
        <PorCliente
          clientes={clientesFiltrados}
          ops={opsFiltradas}
          podeEditar={podeEditar}
          onNovaOp={(c) => setNovaPara({ cliente_id: c.id, cliente_nome: c.nome })}
          onEditar={(o) => setEditando(o)}
          onRemover={remover}
        />
      )}

      {/* Modal criar/editar */}
      {(editando !== null || novaPara) && (
        <ModalOp
          op={editando}
          clienteInicial={novaPara}
          clientes={clientesFiltrados}
          pessoas={pessoas}
          emailUsuario={email}
          onFechar={() => { setEditando(null); setNovaPara(null); }}
          onSalvo={() => { setEditando(null); setNovaPara(null); load(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// STAT CARD
// ============================================================
function StatCard({ label, valor, sub, cor }: { label: string; valor: any; sub?: string; cor: string }) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${cor}`}>{valor}</p>
      {sub && <p className="text-[10px] text-brand-muted mt-0.5">{sub}</p>}
    </div>
  );
}

// ============================================================
// KANBAN
// ============================================================
function Kanban({ ops, arrastando, setArrastando, moverEstagio, podeEditar, onEditar, onRemover }: {
  ops: Oportunidade[];
  arrastando: string | null;
  setArrastando: (id: string | null) => void;
  moverEstagio: (opId: string, novoEstagio: Estagio) => Promise<void>;
  podeEditar: boolean;
  onEditar: (op: Oportunidade) => void;
  onRemover: (op: Oportunidade) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5" onDragEnd={() => setArrastando(null)}>
      {ESTAGIOS.map((est) => {
        const opsEst = ops.filter((o) => o.estagio === est.key).sort((a, b) => a.ordem_kanban - b.ordem_kanban);
        const totalMrr = opsEst.reduce((s, o) => s + o.valor_mrr_estimado, 0);
        const totalOt = opsEst.reduce((s, o) => s + o.valor_onetime_estimado, 0);
        return (
          <div
            key={est.key}
            onDragOver={(e) => { if (arrastando) e.preventDefault(); }}
            onDrop={async (e) => {
              e.preventDefault();
              if (arrastando) await moverEstagio(arrastando, est.key);
            }}
            className={`rounded-xl border-2 p-3 min-h-[300px] ${est.corBg}`}
          >
            <div className="mb-3">
              <p className={`text-sm font-bold ${est.cor}`}>{est.label} · {opsEst.length}</p>
              <p className="text-[10px] text-brand-muted">
                {totalMrr > 0 && `${formatBRL(totalMrr)}/mês`}
                {totalMrr > 0 && totalOt > 0 && " · "}
                {totalOt > 0 && `${formatBRL(totalOt)} one-time`}
              </p>
            </div>
            <div className="space-y-2">
              {opsEst.map((op) => (
                <CardOp
                  key={op.id}
                  op={op}
                  podeEditar={podeEditar}
                  onEditar={() => onEditar(op)}
                  onRemover={() => onRemover(op)}
                  setArrastando={setArrastando}
                  arrastando={arrastando === op.id}
                />
              ))}
              {opsEst.length === 0 && (
                <p className="text-center text-[10px] text-brand-muted italic py-4">Vazio</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardOp({ op, podeEditar, onEditar, onRemover, setArrastando, arrastando }: {
  op: Oportunidade;
  podeEditar: boolean;
  onEditar: () => void;
  onRemover: () => void;
  setArrastando: (id: string | null) => void;
  arrastando: boolean;
}) {
  const alertaParado = op.dias_parado > 14 && op.estagio !== "ganho" && op.estagio !== "perdido";
  return (
    <div
      draggable={podeEditar}
      onDragStart={() => setArrastando(op.id)}
      onDragEnd={() => setArrastando(null)}
      className={`group rounded-lg border bg-brand-panel/60 p-2 transition ${
        podeEditar ? "cursor-grab active:cursor-grabbing hover:border-brand" : ""
      } ${arrastando ? "opacity-40" : ""} ${alertaParado ? "border-red-500/40" : "border-white/10"}`}
      onClick={podeEditar ? onEditar : undefined}
    >
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold text-white leading-tight">{op.titulo}</p>
        {podeEditar && (
          <button
            onClick={(e) => { e.stopPropagation(); onRemover(); }}
            className="opacity-0 group-hover:opacity-100 text-[10px] text-red-300 hover:text-red-400"
          >✕</button>
        )}
      </div>
      <p className="text-[10px] text-brand-muted mt-1">{op.cliente_nome}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {op.valor_mrr_estimado > 0 && (
          <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">
            {formatBRL(op.valor_mrr_estimado)}/mês
          </span>
        )}
        {op.valor_onetime_estimado > 0 && (
          <span className="rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-bold text-purple-300">
            {formatBRL(op.valor_onetime_estimado)} 1x
          </span>
        )}
        <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-brand-muted">
          {op.probabilidade}%
        </span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] text-brand-muted">
        <span>{op.responsavel_nome ?? op.gp_nome ?? "—"}</span>
        <span className={alertaParado ? "text-red-300 font-bold" : ""}>
          {alertaParado ? `⚠ ${op.dias_parado}d parado` : `${op.dias_parado}d`}
        </span>
      </div>
    </div>
  );
}

// ============================================================
// POR CLIENTE
// ============================================================
function PorCliente({ clientes, ops, podeEditar, onNovaOp, onEditar, onRemover }: {
  clientes: ClienteView[];
  ops: Oportunidade[];
  podeEditar: boolean;
  onNovaOp: (c: ClienteView) => void;
  onEditar: (op: Oportunidade) => void;
  onRemover: (op: Oportunidade) => void;
}) {
  const opsPorCliente = useMemo(() => {
    const map = new Map<string, Oportunidade[]>();
    ops.forEach((o) => {
      const arr = map.get(o.cliente_id) ?? [];
      arr.push(o);
      map.set(o.cliente_id, arr);
    });
    return map;
  }, [ops]);

  const clientesOrdenados = useMemo(() => {
    return [...clientes].sort((a, b) => {
      const ta = (opsPorCliente.get(a.id) ?? []).filter((o) => o.estagio !== "ganho" && o.estagio !== "perdido").length;
      const tb = (opsPorCliente.get(b.id) ?? []).filter((o) => o.estagio !== "ganho" && o.estagio !== "perdido").length;
      // Sem oportunidades primeiro (destaque pro coord agir)
      if (ta === 0 && tb > 0) return -1;
      if (tb === 0 && ta > 0) return 1;
      return a.nome.localeCompare(b.nome);
    });
  }, [clientes, opsPorCliente]);

  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {clientesOrdenados.map((c) => {
        const opsCli = opsPorCliente.get(c.id) ?? [];
        const abertas = opsCli.filter((o) => o.estagio !== "ganho" && o.estagio !== "perdido");
        const semOp = abertas.length === 0;
        return (
          <div key={c.id} className={`card ${semOp ? "border-red-500/30" : ""}`}>
            <div className="mb-2 flex items-start justify-between">
              <div>
                <p className="text-sm font-bold">{c.nome}</p>
                <p className="text-[10px] text-brand-muted">
                  {c.squad_nome ?? "sem squad"} · GP: {c.account_nome ?? "—"} · MRR {formatBRL(c.mrr ?? 0)}
                </p>
              </div>
              {podeEditar && (
                <button onClick={() => onNovaOp(c)} className="btn text-[10px] py-1 px-2">+ Op</button>
              )}
            </div>
            {semOp && (
              <p className="text-[11px] text-red-300 italic mb-2">🚨 Nenhuma oportunidade aberta</p>
            )}
            <div className="space-y-1">
              {opsCli.map((o) => {
                const est = ESTAGIOS.find((e) => e.key === o.estagio)!;
                return (
                  <button
                    key={o.id}
                    onClick={() => onEditar(o)}
                    className={`w-full text-left rounded border p-2 hover:border-brand transition ${est.corBg}`}
                  >
                    <div className="flex items-start justify-between">
                      <p className="text-xs font-medium">{o.titulo}</p>
                      <span className={`text-[9px] font-bold ${est.cor}`}>{est.label}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {o.valor_mrr_estimado > 0 && (
                        <span className="text-[9px] text-sky-300">{formatBRL(o.valor_mrr_estimado)}/mês</span>
                      )}
                      {o.valor_onetime_estimado > 0 && (
                        <span className="text-[9px] text-purple-300">· {formatBRL(o.valor_onetime_estimado)} 1x</span>
                      )}
                    </div>
                  </button>
                );
              })}
              {opsCli.length === 0 && (
                <p className="text-center text-[10px] text-brand-muted italic py-2">Sem oportunidades</p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// MODAL CRIAR / EDITAR
// ============================================================
function ModalOp({ op, clienteInicial, clientes, pessoas, emailUsuario, onFechar, onSalvo }: {
  op: Oportunidade | null;
  clienteInicial: { cliente_id: string; cliente_nome: string } | null;
  clientes: ClienteView[];
  pessoas: Pessoa[];
  emailUsuario: string | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    cliente_id: op?.cliente_id ?? clienteInicial?.cliente_id ?? "",
    titulo: op?.titulo ?? "",
    descricao: op?.descricao ?? "",
    valor_mrr: op ? String(op.valor_mrr_estimado ?? "") : "",
    valor_ot: op ? String(op.valor_onetime_estimado ?? "") : "",
    probabilidade: op?.probabilidade ?? 30,
    responsavel_id: op?.responsavel_id ?? "",
    data_prevista: op?.data_prevista_fechamento ?? "",
    observacoes: op?.observacoes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function salvar() {
    if (!form.cliente_id) { alert("Selecione um cliente"); return; }
    if (!form.titulo.trim()) { alert("Título é obrigatório"); return; }
    setSaving(true);
    const payload: any = {
      cliente_id: form.cliente_id,
      titulo: form.titulo.trim(),
      descricao: form.descricao || null,
      valor_mrr_estimado: form.valor_mrr ? Number(form.valor_mrr.replace(",", ".")) : 0,
      valor_onetime_estimado: form.valor_ot ? Number(form.valor_ot.replace(",", ".")) : 0,
      probabilidade: Number(form.probabilidade),
      responsavel_id: form.responsavel_id || null,
      data_prevista_fechamento: form.data_prevista || null,
      observacoes: form.observacoes || null,
    };
    if (op) {
      await supabase.from("ruston_monetizacao_oportunidades").update(payload).eq("id", op.id);
    } else {
      payload.estagio = "ideia";
      payload.criado_por_email = emailUsuario;
      await supabase.from("ruston_monetizacao_oportunidades").insert(payload);
    }
    setSaving(false);
    onSalvo();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-brand-panel p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-semibold">{op ? "Editar oportunidade" : "Nova oportunidade"}</h3>
          <button onClick={onFechar} className="text-brand-muted hover:text-white text-xl">✕</button>
        </div>

        <div className="mb-3">
          <label className="label">Cliente *</label>
          <select className="input" value={form.cliente_id} onChange={(e) => setForm({ ...form, cliente_id: e.target.value })} disabled={!!op}>
            <option value="">— selecione —</option>
            {clientes.map((c) => (<option key={c.id} value={c.id}>{c.nome}</option>))}
          </select>
        </div>

        <div className="mb-3">
          <label className="label">Título * <span className="text-[10px] text-brand-muted">(o que você quer vender)</span></label>
          <input className="input" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })}
            placeholder="Ex: LP Institucional + Meta Ads adicional" />
        </div>

        <div className="mb-3">
          <label className="label">Descrição (opcional)</label>
          <textarea className="input min-h-[60px]" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })}
            placeholder="Detalhes, contexto, escopo…" />
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">R$ MRR (mensal) <span className="text-[10px] text-brand-muted">recorrente</span></label>
            <input className="input" type="text" inputMode="decimal" value={form.valor_mrr}
              onChange={(e) => setForm({ ...form, valor_mrr: e.target.value })}
              placeholder="ex: 3000,00" />
          </div>
          <div>
            <label className="label">R$ Pontual (one-time)</label>
            <input className="input" type="text" inputMode="decimal" value={form.valor_ot}
              onChange={(e) => setForm({ ...form, valor_ot: e.target.value })}
              placeholder="ex: 15000,00" />
          </div>
        </div>

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Probabilidade (%)</label>
            <select className="input" value={form.probabilidade} onChange={(e) => setForm({ ...form, probabilidade: Number(e.target.value) })}>
              <option value={10}>10% — Muito cedo</option>
              <option value={30}>30% — Ideia validada</option>
              <option value={60}>60% — Interesse claro</option>
              <option value={90}>90% — Fechando</option>
            </select>
          </div>
          <div>
            <label className="label">Data prevista fechamento</label>
            <input className="input" type="date" value={form.data_prevista} onChange={(e) => setForm({ ...form, data_prevista: e.target.value })} />
          </div>
        </div>

        <div className="mb-3">
          <label className="label">Responsável</label>
          <select className="input" value={form.responsavel_id} onChange={(e) => setForm({ ...form, responsavel_id: e.target.value })}>
            <option value="">— não definido —</option>
            {pessoas.map((p) => (<option key={p.id} value={p.id}>{p.nome}</option>))}
          </select>
        </div>

        <div className="mb-4">
          <label className="label">Observações</label>
          <textarea className="input min-h-[50px]" value={form.observacoes} onChange={(e) => setForm({ ...form, observacoes: e.target.value })} />
        </div>

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn" onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar"}</button>
        </div>
      </div>
    </div>
  );
}
