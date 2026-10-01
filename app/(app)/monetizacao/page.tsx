"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import type { ClienteView, Pessoa, Squad } from "@/lib/types";
import { formatBRL, MESES_LABEL } from "@/lib/types";

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

type MetaSquad = {
  id: string;
  squad_id: string;
  ano: number;
  mes: number;
  valor_meta: number;
  observacoes: string | null;
};

type Aba = "pipeline" | "por_cliente";

// Pré-preenchimento de modal (usado pra duplicar OU pra criar com cliente/estagio)
type PreencherNovaOp = {
  cliente_id: string;
  cliente_nome: string;
  estagio?: Estagio;
  titulo?: string;
  descricao?: string | null;
  valor_mrr?: number;
  valor_ot?: number;
  probabilidade?: number;
  responsavel_id?: string | null;
  data_prevista?: string | null;
  observacoes?: string | null;
};

export default function MonetizacaoPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, isGerente, isCoordenador, squadId, email } = useUsuarioPerfil();
  const podeEditar = isGerente || isCoordenador;
  const [aba, setAba] = useState<Aba>("pipeline");
  const [ops, setOps] = useState<Oportunidade[]>([]);
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [metas, setMetas] = useState<MetaSquad[]>([]);
  const [loading, setLoading] = useState(true);
  const [filtroSquad, setFiltroSquad] = useState<string>("");
  const [filtroGP, setFiltroGP] = useState<string>("");
  const hoje = new Date();
  const [filtroMes, setFiltroMes] = useState<string>(
    `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`
  );
  const [editando, setEditando] = useState<Oportunidade | null>(null);
  const [novaPara, setNovaPara] = useState<PreencherNovaOp | null>(null);
  const [criandoNova, setCriandoNova] = useState<boolean>(false);
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [modalMetas, setModalMetas] = useState(false);
  const [editandoPlano, setEditandoPlano] = useState<ClienteView | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: o }, { data: c }, { data: p }, { data: s }, { data: m }] = await Promise.all([
      supabase.from("ruston_monetizacao_view").select("*").eq("ativo", true),
      supabase.from("ruston_clientes_view").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_monetizacao_metas").select("*"),
    ]);
    setOps((o as Oportunidade[]) ?? []);
    setClientes((c as ClienteView[]) ?? []);
    setPessoas((p as Pessoa[]) ?? []);
    setSquads((s as Squad[]) ?? []);
    setMetas((m as MetaSquad[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { if (!loadingPerfil) load(); /* eslint-disable-next-line */ }, [loadingPerfil]);

  const [anoFiltro, mesFiltro] = useMemo(() => {
    const [a, m] = filtroMes.split("-").map(Number);
    return [a, m];
  }, [filtroMes]);

  const opsFiltradas = useMemo(() => {
    return ops.filter((o) => {
      if (isCoordenador && !isGerente && squadId && o.cliente_squad_id !== squadId) return false;
      if (filtroSquad && o.cliente_squad_id !== filtroSquad) return false;
      if (filtroGP && o.cliente_account_id !== filtroGP) return false;
      const dataRef = o.data_prevista_fechamento ?? o.data_ganho ?? o.data_perda ?? o.created_at;
      const ym = dataRef ? dataRef.slice(0, 7) : "";
      if (ym !== filtroMes) return false;
      return true;
    });
  }, [ops, isCoordenador, isGerente, squadId, filtroSquad, filtroGP, filtroMes]);

  const clientesFiltrados = useMemo(() => {
    return clientes.filter((c) => {
      if (isCoordenador && !isGerente && squadId && c.squad_id !== squadId) return false;
      if (filtroSquad && c.squad_id !== filtroSquad) return false;
      if (filtroGP && c.account_id !== filtroGP) return false;
      return true;
    });
  }, [clientes, isCoordenador, isGerente, squadId, filtroSquad, filtroGP]);

  const clientesAMonetizar = useMemo(() => {
    const idsComOp = new Set(ops.filter((o) => o.estagio !== "ganho" && o.estagio !== "perdido").map((o) => o.cliente_id));
    return clientesFiltrados.filter((c) => (!c.mrr || Number(c.mrr) === 0) && !idsComOp.has(c.id));
  }, [clientesFiltrados, ops]);

  const metaEProgresso = useMemo(() => {
    const squadsVisiveis = squads.filter((sq) => {
      if (isCoordenador && !isGerente && squadId && sq.id !== squadId) return false;
      if (filtroSquad && sq.id !== filtroSquad) return false;
      return true;
    });
    const metasDoMes = metas.filter((m) => m.ano === anoFiltro && m.mes === mesFiltro && squadsVisiveis.find((s) => s.id === m.squad_id));
    const metaTotal = metasDoMes.reduce((s, m) => s + Number(m.valor_meta), 0);
    const ganhas = ops.filter((o) => {
      if (o.estagio !== "ganho") return false;
      const dataRef = o.data_prevista_fechamento ?? o.data_ganho;
      if (!dataRef) return false;
      if (dataRef.slice(0, 7) !== filtroMes) return false;
      if (!squadsVisiveis.find((s) => s.id === o.cliente_squad_id)) return false;
      return true;
    });
    const realizado = ganhas.reduce((s, o) => s + Number(o.valor_mrr_estimado ?? 0) + Number(o.valor_onetime_estimado ?? 0), 0);
    const hj = new Date();
    const ehMesAtual = hj.getFullYear() === anoFiltro && hj.getMonth() + 1 === mesFiltro;
    const ehFuturo = anoFiltro > hj.getFullYear() || (anoFiltro === hj.getFullYear() && mesFiltro > hj.getMonth() + 1);
    const diasNoMes = new Date(anoFiltro, mesFiltro, 0).getDate();
    const diaDoMes = ehMesAtual ? hj.getDate() : diasNoMes;
    const fracaoEsperada = ehFuturo ? 0 : Math.min(1, diaDoMes / diasNoMes);
    const esperadoAteHoje = metaTotal * fracaoEsperada;
    const semanaAtual = ehMesAtual ? Math.ceil(diaDoMes / 7) : 4;
    const metaSemanal = metaTotal / 4;
    const realizadoSemanaAtual = ganhas.filter((o) => {
      const dataRef = o.data_prevista_fechamento ?? o.data_ganho;
      if (!dataRef) return false;
      const d = new Date(dataRef);
      return Math.ceil(d.getDate() / 7) === semanaAtual;
    }).reduce((s, o) => s + Number(o.valor_mrr_estimado ?? 0) + Number(o.valor_onetime_estimado ?? 0), 0);
    const pctTotal = metaTotal > 0 ? Math.round((realizado / metaTotal) * 100) : 0;
    const pctSemana = metaSemanal > 0 ? Math.round((realizadoSemanaAtual / metaSemanal) * 100) : 0;
    const status: "ok" | "atencao" | "critico" | "sem_meta" =
      metaTotal === 0 ? "sem_meta" :
      realizado >= esperadoAteHoje ? "ok" :
      realizado >= esperadoAteHoje * 0.7 ? "atencao" : "critico";
    return { metaTotal, realizado, esperadoAteHoje, semanaAtual, metaSemanal, realizadoSemanaAtual, pctTotal, pctSemana, status, totalMetas: metasDoMes.length, squadsVisiveis: squadsVisiveis.length };
  }, [metas, ops, squads, isCoordenador, isGerente, squadId, filtroSquad, anoFiltro, mesFiltro, filtroMes]);

  async function moverEstagio(opId: string, novoEstagio: Estagio) {
    const op = ops.find((o) => o.id === opId);
    if (!op) return;
    if (op.estagio === novoEstagio) return;
    let aplicarMrr = false;
    if (novoEstagio === "ganho" && op.valor_mrr_estimado > 0 && !op.aplicado_no_mrr) {
      const cli = clientes.find((c) => c.id === op.cliente_id);
      aplicarMrr = confirm(
        `Somar R$ ${op.valor_mrr_estimado.toLocaleString("pt-BR", { minimumFractionDigits: 2 })} no MRR de "${op.cliente_nome}"?\n\n` +
        `MRR atual: ${formatBRL(cli?.mrr ?? 0)}\nMRR novo: ${formatBRL((cli?.mrr ?? 0) + op.valor_mrr_estimado)}\n\n` +
        `OK = soma no MRR do cliente\nCancelar = só marca como Ganho`
      );
    }
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
    if (aplicarMrr) {
      const cli = clientes.find((c) => c.id === op.cliente_id);
      const novoMrr = (cli?.mrr ?? 0) + op.valor_mrr_estimado;
      await supabase.from("ruston_clientes").update({ mrr: novoMrr, fee: novoMrr }).eq("id", op.cliente_id);
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
  // NOVO: duplicar oportunidade — fecha o modal atual e abre
  // um novo "Nova oportunidade" pré-preenchido com os valores dela
  // ------------------------------------------------------------
  function duplicarOp(op: Oportunidade) {
    setEditando(null);
    setNovaPara({
      cliente_id: op.cliente_id,
      cliente_nome: op.cliente_nome,
      titulo: op.titulo + " (cópia)",
      descricao: op.descricao,
      valor_mrr: op.valor_mrr_estimado,
      valor_ot: op.valor_onetime_estimado,
      probabilidade: op.probabilidade,
      responsavel_id: op.responsavel_id,
      data_prevista: op.data_prevista_fechamento,
      observacoes: op.observacoes,
      // Não copia estágio → cria sempre em Ideia
    });
  }

  if (loadingPerfil || loading) {
    return <p className="text-brand-muted">Carregando...</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">💰 Monetização</h1>
          <p className="text-sm text-brand-muted">
            Pipeline de oportunidades · Meta vs realizado · Radar de clientes a monetizar
          </p>
        </div>
        {isGerente && (
          <button className="btn-ghost text-xs" onClick={() => setModalMetas(true)}>
            🎯 Editar metas mensais
          </button>
        )}
      </div>

      <MetaProgressCard mp={metaEProgresso} filtroMes={filtroMes} />

      <div className="mb-4 mt-4 inline-flex rounded-lg border border-white/10 bg-brand-panel/50 p-1">
        {[{ v: "pipeline", label: "Pipeline (Kanban)" }, { v: "por_cliente", label: "Por cliente" }].map((it) => (
          <button key={it.v} onClick={() => setAba(it.v as Aba)}
            className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${aba === it.v ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"}`}>
            {it.label}
          </button>
        ))}
      </div>

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
        <select className="input max-w-[220px]" value={filtroMes} onChange={(e) => setFiltroMes(e.target.value)}>
          {(() => {
            const arr: { value: string; label: string; isFuturo: boolean; isAtual: boolean }[] = [];
            for (let i = -6; i <= 12; i++) {
              const d = new Date(hoje.getFullYear(), hoje.getMonth() + i, 1);
              const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
              const label = `${MESES_LABEL[d.getMonth()]}/${d.getFullYear()}`;
              arr.push({ value, label, isFuturo: i > 0, isAtual: i === 0 });
            }
            return arr.map((o) => (
              <option key={o.value} value={o.value}>{o.isAtual ? "▸ " : o.isFuturo ? "→ " : ""}{o.label}</option>
            ));
          })()}
        </select>
        {podeEditar && (
          <button className="btn ml-auto" onClick={() => setCriandoNova(true)}>+ Nova oportunidade</button>
        )}
      </div>

      {aba === "pipeline" && (
        <Kanban
          ops={opsFiltradas}
          clientesAMonetizar={clientesAMonetizar}
          arrastando={arrastando}
          setArrastando={setArrastando}
          moverEstagio={moverEstagio}
          podeEditar={podeEditar}
          onEditar={(o) => setEditando(o)}
          onRemover={remover}
          onNovaOpDoCliente={(c) => setNovaPara({ cliente_id: c.id, cliente_nome: c.nome })}
          onNovaOpDoClienteComEstagio={(c, estagio) => setNovaPara({ cliente_id: c.id, cliente_nome: c.nome, estagio })}
          onEditarPlano={(c) => setEditandoPlano(c)}
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
          onEditarPlano={(c) => setEditandoPlano(c)}
        />
      )}

      {(editando !== null || novaPara || criandoNova) && (
        <ModalOp
          op={editando}
          clienteInicial={novaPara}
          clientes={clientesFiltrados}
          pessoas={pessoas}
          emailUsuario={email}
          onDuplicar={duplicarOp}
          onFechar={() => { setEditando(null); setNovaPara(null); setCriandoNova(false); }}
          onSalvo={() => { setEditando(null); setNovaPara(null); setCriandoNova(false); load(); }}
        />
      )}

      {modalMetas && (
        <ModalMetas squads={squads} metas={metas} anoFiltro={anoFiltro} mesFiltro={mesFiltro}
          onFechar={() => setModalMetas(false)} onSalvo={() => { setModalMetas(false); load(); }} />
      )}

      {editandoPlano && (
        <ModalPlano cliente={editandoPlano} onFechar={() => setEditandoPlano(null)} onSalvo={() => { setEditandoPlano(null); load(); }} />
      )}
    </div>
  );
}

function MetaProgressCard({ mp, filtroMes }: { mp: any; filtroMes: string }) {
  if (mp.status === "sem_meta") {
    return (
      <div className="card border-white/10 bg-white/5">
        <p className="text-xs text-brand-muted">🎯 Nenhuma meta cadastrada pra {filtroMes.replace("-", "/")}. Clica em "Editar metas mensais" pra definir.</p>
      </div>
    );
  }
  const corBg = mp.status === "ok" ? "border-emerald-500/40 bg-emerald-500/5" : mp.status === "atencao" ? "border-amber-500/40 bg-amber-500/5" : "border-red-500/40 bg-red-500/5";
  const corBar = mp.status === "ok" ? "bg-emerald-500" : mp.status === "atencao" ? "bg-amber-500" : "bg-red-500";
  return (
    <div className={`card ${corBg}`}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 min-w-[300px]">
          <p className="text-xs uppercase tracking-widest text-brand-muted">Meta do mês</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-2xl font-bold text-white">{formatBRL(mp.realizado)}</p>
            <p className="text-sm text-brand-muted">/ {formatBRL(mp.metaTotal)}</p>
            <p className={`text-sm font-bold ${mp.status === "ok" ? "text-emerald-300" : mp.status === "atencao" ? "text-amber-300" : "text-red-300"}`}>· {mp.pctTotal}%</p>
          </div>
          <div className="mt-2 h-3 w-full overflow-hidden rounded-full bg-white/5">
            <div className={`h-full ${corBar}`} style={{ width: `${Math.min(100, mp.pctTotal)}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-brand-muted">
            Esperado até hoje: {formatBRL(mp.esperadoAteHoje)}
            {mp.status === "critico" && ` · faltam ${formatBRL(mp.esperadoAteHoje - mp.realizado)} pra estar em dia`}
            {mp.status === "atencao" && ` · atrás por ${formatBRL(mp.esperadoAteHoje - mp.realizado)}`}
          </p>
        </div>
        <div className="min-w-[220px]">
          <p className="text-xs uppercase tracking-widest text-brand-muted">Semana {mp.semanaAtual}/4</p>
          <div className="mt-1 flex items-baseline gap-2">
            <p className="text-xl font-bold text-white">{formatBRL(mp.realizadoSemanaAtual)}</p>
            <p className="text-xs text-brand-muted">/ {formatBRL(mp.metaSemanal)}</p>
          </div>
          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/5">
            <div className={mp.pctSemana >= 100 ? "h-full bg-emerald-500" : "h-full bg-amber-500"} style={{ width: `${Math.min(100, mp.pctSemana)}%` }} />
          </div>
          <p className="mt-1 text-[10px] text-brand-muted">
            {mp.pctSemana >= 100 ? "✅ Meta semanal batida" : `⚠ Faltam ${formatBRL(Math.max(0, mp.metaSemanal - mp.realizadoSemanaAtual))} pra bater a semana`}
          </p>
        </div>
      </div>
    </div>
  );
}

function Kanban({ ops, clientesAMonetizar, arrastando, setArrastando, moverEstagio, podeEditar, onEditar, onRemover, onNovaOpDoCliente, onNovaOpDoClienteComEstagio, onEditarPlano }: {
  ops: Oportunidade[]; clientesAMonetizar: ClienteView[]; arrastando: string | null; setArrastando: (id: string | null) => void;
  moverEstagio: (opId: string, novoEstagio: Estagio) => Promise<void>; podeEditar: boolean;
  onEditar: (op: Oportunidade) => void; onRemover: (op: Oportunidade) => void;
  onNovaOpDoCliente: (c: ClienteView) => void; onNovaOpDoClienteComEstagio: (c: ClienteView, estagio: Estagio) => void;
  onEditarPlano: (c: ClienteView) => void;
}) {
  const [arrastandoCliente, setArrastandoCliente] = useState<ClienteView | null>(null);
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-6"
      onDragEnd={() => { setArrastando(null); setArrastandoCliente(null); }}>
      <div className="rounded-xl border-2 p-3 min-h-[300px] border-purple-500/40 bg-purple-500/5">
        <div className="mb-3">
          <p className="text-sm font-bold text-purple-300">🎯 A Monetizar · {clientesAMonetizar.length}</p>
          <p className="text-[10px] text-brand-muted">Clientes sem MRR ativo · arrasta pra uma coluna pra criar oportunidade</p>
        </div>
        <div className="space-y-2">
          {clientesAMonetizar.map((c) => {
            const semPlano = !c.plano_acao_monetizacao || c.plano_acao_monetizacao.trim() === "";
            const eu = arrastandoCliente?.id === c.id;
            return (
              <div key={c.id} draggable={podeEditar}
                onDragStart={() => { setArrastandoCliente(c); setArrastando(null); }}
                onDragEnd={() => setArrastandoCliente(null)}
                className={`rounded-lg border p-2 bg-brand-panel/60 transition ${semPlano ? "border-red-500/40" : "border-white/10"} ${podeEditar ? "cursor-grab active:cursor-grabbing hover:border-purple-400" : ""} ${eu ? "opacity-40 scale-95" : ""}`}>
                <p className="text-xs font-semibold text-white leading-tight">{c.nome}</p>
                <p className="text-[10px] text-brand-muted mt-0.5">
                  {c.etapa === "estruturacao_estrategica" ? "Estruturação Estratégica" : c.etapa} · GP: {c.account_nome ?? "—"}
                </p>
                {c.plano_acao_monetizacao && (
                  <p className="mt-1 text-[10px] text-amber-200 italic line-clamp-2">📝 {c.plano_acao_monetizacao}</p>
                )}
                {podeEditar && (
                  <div className="mt-2 flex gap-1">
                    <button onClick={() => onNovaOpDoCliente(c)} className="flex-1 text-[10px] rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 py-1 border border-emerald-500/30">+ Op</button>
                    <button onClick={() => onEditarPlano(c)} className={`flex-1 text-[10px] rounded py-1 border ${semPlano ? "bg-red-500/20 text-red-300 hover:bg-red-500/30 border-red-500/30" : "bg-white/5 text-brand-muted hover:bg-white/10 border-white/10"}`}>📝 {semPlano ? "Sem plano" : "Plano"}</button>
                  </div>
                )}
              </div>
            );
          })}
          {clientesAMonetizar.length === 0 && <p className="text-center text-[10px] text-brand-muted italic py-4">🎉 Todos os clientes sem MRR já têm oportunidade</p>}
        </div>
      </div>

      {ESTAGIOS.map((est) => {
        const opsEst = ops.filter((o) => o.estagio === est.key).sort((a, b) => a.ordem_kanban - b.ordem_kanban);
        const totalMrr = opsEst.reduce((s, o) => s + o.valor_mrr_estimado, 0);
        const totalOt = opsEst.reduce((s, o) => s + o.valor_onetime_estimado, 0);
        return (
          <div key={est.key}
            onDragOver={(e) => { if (arrastando || arrastandoCliente) e.preventDefault(); }}
            onDrop={async (e) => {
              e.preventDefault();
              if (arrastando) await moverEstagio(arrastando, est.key);
              else if (arrastandoCliente) { onNovaOpDoClienteComEstagio(arrastandoCliente, est.key); setArrastandoCliente(null); }
            }}
            className={`rounded-xl border-2 p-3 min-h-[300px] ${est.corBg}`}>
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
                <CardOp key={op.id} op={op} podeEditar={podeEditar}
                  onEditar={() => onEditar(op)}
                  onRemover={() => onRemover(op)}
                  setArrastando={setArrastando}
                  arrastando={arrastando === op.id} />
              ))}
              {opsEst.length === 0 && <p className="text-center text-[10px] text-brand-muted italic py-4">Vazio</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CardOp({ op, podeEditar, onEditar, onRemover, setArrastando, arrastando }: {
  op: Oportunidade; podeEditar: boolean; onEditar: () => void; onRemover: () => void;
  setArrastando: (id: string | null) => void; arrastando: boolean;
}) {
  const alertaParado = op.dias_parado > 14 && op.estagio !== "ganho" && op.estagio !== "perdido";
  return (
    <div draggable={podeEditar} onDragStart={() => setArrastando(op.id)} onDragEnd={() => setArrastando(null)}
      className={`group rounded-lg border bg-brand-panel/60 p-2 transition ${podeEditar ? "cursor-grab active:cursor-grabbing hover:border-brand" : ""} ${arrastando ? "opacity-40" : ""} ${alertaParado ? "border-red-500/40" : "border-white/10"}`}
      onClick={podeEditar ? onEditar : undefined}>
      <div className="flex items-start justify-between gap-1">
        <p className="text-xs font-semibold text-white leading-tight">{op.titulo}</p>
        {podeEditar && (
          <button onClick={(e) => { e.stopPropagation(); onRemover(); }}
            className="opacity-0 group-hover:opacity-100 text-[10px] text-red-300 hover:text-red-400">✕</button>
        )}
      </div>
      <p className="text-[10px] text-brand-muted mt-1">{op.cliente_nome}</p>
      <div className="mt-2 flex flex-wrap gap-1">
        {op.valor_mrr_estimado > 0 && <span className="rounded border border-sky-500/40 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-300">{formatBRL(op.valor_mrr_estimado)}/mês</span>}
        {op.valor_onetime_estimado > 0 && <span className="rounded border border-purple-500/40 bg-purple-500/10 px-1.5 py-0.5 text-[9px] font-bold text-purple-300">{formatBRL(op.valor_onetime_estimado)} 1x</span>}
        <span className="rounded border border-white/10 bg-white/5 px-1.5 py-0.5 text-[9px] text-brand-muted">{op.probabilidade}%</span>
      </div>
      <div className="mt-2 flex items-center justify-between text-[9px] text-brand-muted">
        <span>{op.responsavel_nome ?? op.gp_nome ?? "—"}</span>
        <span className={alertaParado ? "text-red-300 font-bold" : ""}>{alertaParado ? `⚠ ${op.dias_parado}d parado` : `${op.dias_parado}d`}</span>
      </div>
    </div>
  );
}

function PorCliente({ clientes, ops, podeEditar, onNovaOp, onEditar, onRemover, onEditarPlano }: {
  clientes: ClienteView[]; ops: Oportunidade[]; podeEditar: boolean;
  onNovaOp: (c: ClienteView) => void; onEditar: (op: Oportunidade) => void; onRemover: (op: Oportunidade) => void;
  onEditarPlano: (c: ClienteView) => void;
}) {
  const opsPorCliente = useMemo(() => {
    const map = new Map<string, Oportunidade[]>();
    ops.forEach((o) => { const arr = map.get(o.cliente_id) ?? []; arr.push(o); map.set(o.cliente_id, arr); });
    return map;
  }, [ops]);
  const clientesOrdenados = useMemo(() => {
    return [...clientes].sort((a, b) => {
      const ta = (opsPorCliente.get(a.id) ?? []).filter((o) => o.estagio !== "ganho" && o.estagio !== "perdido").length;
      const tb = (opsPorCliente.get(b.id) ?? []).filter((o) => o.estagio !== "ganho" && o.estagio !== "perdido").length;
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
        const ehEE = !c.mrr || Number(c.mrr) === 0;
        return (
          <div key={c.id} className={`card ${semOp && ehEE ? "border-red-500/30" : ""}`}>
            <div className="mb-2 flex items-start justify-between">
              <div>
                <p className="text-sm font-bold">{c.nome}</p>
                <p className="text-[10px] text-brand-muted">
                  {c.squad_nome ?? "sem squad"} · GP: {c.account_nome ?? "—"} · MRR {formatBRL(c.mrr ?? 0)}
                </p>
              </div>
              {podeEditar && <button onClick={() => onNovaOp(c)} className="btn text-[10px] py-1 px-2">+ Op</button>}
            </div>
            {semOp && ehEE && (
              <div className="mb-2 rounded bg-red-500/10 border border-red-500/30 p-2">
                <p className="text-[11px] text-red-300">🚨 Estruturação Estratégica sem oportunidade</p>
                {c.plano_acao_monetizacao && <p className="mt-1 text-[10px] text-amber-200 italic">📝 {c.plano_acao_monetizacao}</p>}
                {podeEditar && (
                  <button onClick={() => onEditarPlano(c)} className="mt-1 text-[10px] text-brand hover:text-red-400">
                    {c.plano_acao_monetizacao ? "Editar plano" : "+ Registrar plano de ação"}
                  </button>
                )}
              </div>
            )}
            <div className="space-y-1">
              {opsCli.map((o) => {
                const est = ESTAGIOS.find((e) => e.key === o.estagio)!;
                return (
                  <button key={o.id} onClick={() => onEditar(o)}
                    className={`w-full text-left rounded border p-2 hover:border-brand transition ${est.corBg}`}>
                    <div className="flex items-start justify-between">
                      <p className="text-xs font-medium">{o.titulo}</p>
                      <span className={`text-[9px] font-bold ${est.cor}`}>{est.label}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {o.valor_mrr_estimado > 0 && <span className="text-[9px] text-sky-300">{formatBRL(o.valor_mrr_estimado)}/mês</span>}
                      {o.valor_onetime_estimado > 0 && <span className="text-[9px] text-purple-300">· {formatBRL(o.valor_onetime_estimado)} 1x</span>}
                    </div>
                  </button>
                );
              })}
              {opsCli.length === 0 && !semOp && <p className="text-center text-[10px] text-brand-muted italic py-2">Sem oportunidades</p>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// MODAL — agora com botão DUPLICAR
// ============================================================
function ModalOp({ op, clienteInicial, clientes, pessoas, emailUsuario, onDuplicar, onFechar, onSalvo }: {
  op: Oportunidade | null;
  clienteInicial: PreencherNovaOp | null;
  clientes: ClienteView[]; pessoas: Pessoa[]; emailUsuario: string | null;
  onDuplicar: (op: Oportunidade) => void;
  onFechar: () => void; onSalvo: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    cliente_id: op?.cliente_id ?? clienteInicial?.cliente_id ?? "",
    titulo: op?.titulo ?? clienteInicial?.titulo ?? "",
    descricao: op?.descricao ?? clienteInicial?.descricao ?? "",
    valor_mrr: op ? String(op.valor_mrr_estimado ?? "") : (clienteInicial?.valor_mrr != null ? String(clienteInicial.valor_mrr) : ""),
    valor_ot: op ? String(op.valor_onetime_estimado ?? "") : (clienteInicial?.valor_ot != null ? String(clienteInicial.valor_ot) : ""),
    probabilidade: op?.probabilidade ?? clienteInicial?.probabilidade ?? 30,
    responsavel_id: op?.responsavel_id ?? clienteInicial?.responsavel_id ?? "",
    data_prevista: op?.data_prevista_fechamento ?? clienteInicial?.data_prevista ?? "",
    observacoes: op?.observacoes ?? clienteInicial?.observacoes ?? "",
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
      valor_mrr_estimado: form.valor_mrr ? Number(String(form.valor_mrr).replace(",", ".")) : 0,
      valor_onetime_estimado: form.valor_ot ? Number(String(form.valor_ot).replace(",", ".")) : 0,
      probabilidade: Number(form.probabilidade),
      responsavel_id: form.responsavel_id || null,
      data_prevista_fechamento: form.data_prevista || null,
      observacoes: form.observacoes || null,
    };
    if (op) {
      await supabase.from("ruston_monetizacao_oportunidades").update(payload).eq("id", op.id);
    } else {
      payload.estagio = clienteInicial?.estagio ?? "ideia";
      payload.criado_por_email = emailUsuario;
      if (payload.estagio === "ganho") { payload.data_ganho = new Date().toISOString().slice(0, 10); payload.probabilidade = 100; }
      else if (payload.estagio === "perdido") { payload.data_perda = new Date().toISOString().slice(0, 10); payload.probabilidade = 0; }
      await supabase.from("ruston_monetizacao_oportunidades").insert(payload);
    }
    setSaving(false);
    onSalvo();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-brand-panel p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">{op ? "Editar oportunidade" : "Nova oportunidade"}</h3>
            {clienteInicial?.estagio && (
              <p className="text-[11px] text-purple-300">
                Vai ser criada em: {ESTAGIOS.find((e) => e.key === clienteInicial.estagio)?.label}
              </p>
            )}
            {!op && clienteInicial?.titulo?.endsWith("(cópia)") && (
              <p className="text-[11px] text-emerald-300">📋 Duplicando — ajusta os campos e salva</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {op && (
              <button
                onClick={() => onDuplicar(op)}
                className="btn-ghost text-xs"
                title="Cria uma nova oportunidade com os mesmos dados"
              >
                📋 Duplicar
              </button>
            )}
            <button onClick={onFechar} className="text-brand-muted hover:text-white text-xl">✕</button>
          </div>
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
          <input className="input" value={form.titulo} onChange={(e) => setForm({ ...form, titulo: e.target.value })} placeholder="Ex: LP Institucional + Meta Ads adicional" />
        </div>
        <div className="mb-3">
          <label className="label">Descrição (opcional)</label>
          <textarea className="input min-h-[60px]" value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} placeholder="Detalhes, contexto, escopo…" />
        </div>
        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">R$ MRR (mensal)</label>
            <input className="input" type="text" inputMode="decimal" value={form.valor_mrr} onChange={(e) => setForm({ ...form, valor_mrr: e.target.value })} placeholder="ex: 3000,00" />
          </div>
          <div>
            <label className="label">R$ Pontual (one-time)</label>
            <input className="input" type="text" inputMode="decimal" value={form.valor_ot} onChange={(e) => setForm({ ...form, valor_ot: e.target.value })} placeholder="ex: 15000,00" />
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

function ModalMetas({ squads, metas, anoFiltro, mesFiltro, onFechar, onSalvo }: {
  squads: Squad[]; metas: MetaSquad[]; anoFiltro: number; mesFiltro: number;
  onFechar: () => void; onSalvo: () => void;
}) {
  const supabase = createClient();
  const [ano, setAno] = useState(anoFiltro);
  const [mes, setMes] = useState(mesFiltro);
  const [valores, setValores] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const map: Record<string, string> = {};
    squads.forEach((s) => {
      const meta = metas.find((m) => m.squad_id === s.id && m.ano === ano && m.mes === mes);
      map[s.id] = meta ? String(meta.valor_meta).replace(".", ",") : "";
    });
    setValores(map);
  }, [ano, mes, squads, metas]);
  async function salvar() {
    setSaving(true);
    for (const s of squads) {
      const v = valores[s.id];
      const valor = v ? Number(v.replace(",", ".")) : 0;
      const existente = metas.find((m) => m.squad_id === s.id && m.ano === ano && m.mes === mes);
      if (existente) await supabase.from("ruston_monetizacao_metas").update({ valor_meta: valor }).eq("id", existente.id);
      else if (valor > 0) await supabase.from("ruston_monetizacao_metas").insert({ squad_id: s.id, ano, mes, valor_meta: valor });
    }
    setSaving(false);
    onSalvo();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-brand-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-semibold">🎯 Metas mensais de monetização</h3>
          <button onClick={onFechar} className="text-brand-muted hover:text-white text-xl">✕</button>
        </div>
        <div className="mb-3 flex gap-2">
          <select className="input flex-1" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
            {MESES_LABEL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
            {[2025, 2026, 2027].map((y) => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>
        <div className="mb-4 space-y-2">
          {squads.map((s) => (
            <div key={s.id} className="flex items-center gap-2">
              <span className="w-24 text-sm">{s.nome}</span>
              <span className="text-brand-muted">R$</span>
              <input className="input flex-1" type="text" inputMode="decimal" value={valores[s.id] ?? ""}
                onChange={(e) => setValores({ ...valores, [s.id]: e.target.value })} placeholder="0,00" />
            </div>
          ))}
        </div>
        <p className="mb-3 text-[10px] text-brand-muted">Meta total = MRR ganho + One-time ganho no mês. Deixa zero pra squads sem meta.</p>
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn" onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar metas"}</button>
        </div>
      </div>
    </div>
  );
}

function ModalPlano({ cliente, onFechar, onSalvo }: {
  cliente: ClienteView; onFechar: () => void; onSalvo: () => void;
}) {
  const supabase = createClient();
  const [plano, setPlano] = useState((cliente as any).plano_acao_monetizacao ?? "");
  const [saving, setSaving] = useState(false);
  async function salvar() {
    setSaving(true);
    await supabase.from("ruston_clientes").update({
      plano_acao_monetizacao: plano.trim() || null,
      plano_acao_atualizado_em: plano.trim() ? new Date().toISOString().slice(0, 10) : null,
    }).eq("id", cliente.id);
    setSaving(false);
    onSalvo();
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-lg rounded-lg border border-white/10 bg-brand-panel p-5" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">📝 Plano de ação — {cliente.nome}</h3>
            <p className="text-xs text-brand-muted">Se não conseguimos monetizar esse cliente, qual é o plano pra reverter?</p>
          </div>
          <button onClick={onFechar} className="text-brand-muted hover:text-white text-xl">✕</button>
        </div>
        <textarea className="input min-h-[140px]" value={plano} onChange={(e) => setPlano(e.target.value)}
          placeholder="Ex: Cliente muito operacional, sem espaço orçamentário. Agendar reunião com o CEO em Nov pra apresentar cases similares e propor upgrade de plano." />
        {(cliente as any).plano_acao_atualizado_em && (
          <p className="mt-2 text-[10px] text-brand-muted">
            Última atualização: {new Date((cliente as any).plano_acao_atualizado_em).toLocaleDateString("pt-BR")}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
          <button className="btn" onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar plano"}</button>
        </div>
      </div>
    </div>
  );
}
