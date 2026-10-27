"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { TagSemanaEE, carregarSemanasEE, TagContratoCliente, carregarTagsContrato, type TagContrato } from "@/components/clientes/TagSemanaEE";

/** Projeção: cópia do organograma em modo simulação, só para o gerente.
 *  Lê os dados reais uma vez e daí em diante tudo fica no navegador (localStorage).
 *  Nenhuma alteração desta tela é gravada no banco. */

type Area = { id: string; nome: string; tipo: "fixa" | "squad"; ordem: number };
type OrgPessoa = {
  id: string; area_id: string; nome: string; cargo: string | null; foto_url: string | null;
  tem_carteira: boolean; ruston_pessoa_id: string | null; capacidade: number | null;
};
type SimCliente = {
  id: string; nome: string; mrr: number; gp: string | null;
  etapa?: string | null; semana_ee?: number | null; tag_contrato?: TagContrato | null;
  novo?: boolean; removido?: boolean;
};
type SimGp = { id: string; nome: string; area_id: string; foto_url: string | null; capacidade: number | null; ficticio?: boolean };
type Cenario = { clientes: SimCliente[]; gpsExtras: SimGp[]; areaDoGp: Record<string, string> };

const CHAVE = "projecao:cenario:v1";
const SEM_GP = "__sem_gp__";

function brl(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
}
function compacto(v: number): string {
  if (Math.abs(v) >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (Math.abs(v) >= 1_000) return `R$ ${Math.round(v / 100) / 10}k`;
  return `R$ ${Math.round(v)}`;
}
function Delta({ v, moeda = true }: { v: number; moeda?: boolean }) {
  if (!v) return null;
  return (
    <span className={`text-[10px] font-bold ${v > 0 ? "text-emerald-300" : "text-red-300"}`}>
      {v > 0 ? "+" : "−"}{moeda ? compacto(Math.abs(v)) : Math.abs(v)}
    </span>
  );
}

export default function ProjecaoPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, isGerente } = useUsuarioPerfil();
  const [loading, setLoading] = useState(true);
  const [squads, setSquads] = useState<Area[]>([]);
  const [gpsReais, setGpsReais] = useState<SimGp[]>([]);
  const [reais, setReais] = useState<SimCliente[]>([]);
  const [cenario, setCenario] = useState<Cenario>({ clientes: [], gpsExtras: [], areaDoGp: {} });
  const [aba, setAba] = useState<string>("todos");
  const [arrastando, setArrastando] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: a }, { data: p }, { data: cli }, semanas, tags] = await Promise.all([
      supabase.from("ruston_org_areas").select("id,nome,tipo,ordem").eq("ativo", true).eq("tipo", "squad").order("ordem"),
      supabase.from("ruston_org_pessoas").select("id,area_id,nome,cargo,foto_url,tem_carteira,ruston_pessoa_id,capacidade").eq("ativo", true),
      supabase.from("ruston_clientes").select("id,nome,account_id,mrr,churn_realizado,subiu_no_sistema,etapa").eq("ativo", true),
      carregarSemanasEE(supabase),
      carregarTagsContrato(supabase),
    ]);
    const sq = (a as Area[]) ?? [];
    const idsSquad = new Set(sq.map((s) => s.id));
    const gps: SimGp[] = ((p as OrgPessoa[]) ?? [])
      .filter((x) => x.tem_carteira && x.ruston_pessoa_id && idsSquad.has(x.area_id))
      .map((x) => ({ id: x.ruston_pessoa_id!, nome: x.nome, area_id: x.area_id, foto_url: x.foto_url, capacidade: x.capacidade }));
    const idsGp = new Set(gps.map((g) => g.id));
    const clientes: SimCliente[] = ((cli as { id: string; nome: string; account_id: string | null; mrr: number | null; churn_realizado: boolean; subiu_no_sistema: boolean; etapa: string | null }[]) ?? [])
      .filter((x) => !(x.churn_realizado && x.subiu_no_sistema))
      .map((x) => ({
        id: x.id, nome: x.nome, mrr: x.mrr ?? 0,
        gp: x.account_id && idsGp.has(x.account_id) ? x.account_id : null,
        etapa: x.etapa, semana_ee: semanas[x.id] ?? null, tag_contrato: tags[x.id] ?? null,
      }));
    setSquads(sq);
    setGpsReais(gps);
    setReais(clientes);
    let salvo: Cenario | null = null;
    try { const t = localStorage.getItem(CHAVE); if (t) salvo = JSON.parse(t); } catch {}
    setCenario(salvo ?? { clientes, gpsExtras: [], areaDoGp: {} });
    setLoading(false);
  }

  useEffect(() => { if (!loadingPerfil && isGerente) load(); /* eslint-disable-next-line */ }, [loadingPerfil, isGerente]);

  function atualizar(fn: (c: Cenario) => Cenario) {
    setCenario((prev) => {
      const novo = fn(prev);
      try { localStorage.setItem(CHAVE, JSON.stringify(novo)); } catch {}
      return novo;
    });
  }
  function resetar() {
    if (!confirm("Voltar a projeção para os dados reais de hoje? As simulações feitas aqui serão descartadas.")) return;
    try { localStorage.removeItem(CHAVE); } catch {}
    setCenario({ clientes: reais, gpsExtras: [], areaDoGp: {} });
  }

  const mudarCliente = (id: string, campos: Partial<SimCliente>) =>
    atualizar((c) => ({ ...c, clientes: c.clientes.map((x) => (x.id === id ? { ...x, ...campos } : x)) }));
  const excluirNovo = (id: string) => atualizar((c) => ({ ...c, clientes: c.clientes.filter((x) => x.id !== id) }));
  function adicionarCliente(gp: string | null) {
    const nome = prompt("Nome do cliente (projeção):");
    if (!nome?.trim()) return;
    const mrr = Number((prompt("MRR (R$):", "0") ?? "0").replace(/\./g, "").replace(",", "."));
    atualizar((c) => ({ ...c, clientes: [...c.clientes, { id: `novo:${Date.now()}`, nome: nome.trim(), mrr: isNaN(mrr) ? 0 : mrr, gp, novo: true }] }));
  }
  function adicionarGp(area_id: string) {
    const nome = prompt("Nome do GP (projeção, ex: Novo GP 1):");
    if (!nome?.trim()) return;
    atualizar((c) => ({ ...c, gpsExtras: [...c.gpsExtras, { id: `gp:${Date.now()}`, nome: nome.trim(), area_id, foto_url: null, capacidade: null, ficticio: true }] }));
  }
  function removerGpFicticio(id: string) {
    atualizar((c) => ({
      ...c,
      gpsExtras: c.gpsExtras.filter((g) => g.id !== id),
      clientes: c.clientes.map((x) => (x.gp === id ? { ...x, gp: null } : x)),
    }));
  }
  const moverGpDeSquad = (gpId: string, area_id: string) =>
    atualizar((c) => ({ ...c, areaDoGp: { ...c.areaDoGp, [gpId]: area_id } }));
  const soltar = (gp: string | null) => {
    if (arrastando) mudarCliente(arrastando, { gp });
    setArrastando(null);
  };

  const gps = useMemo(
    () => [...gpsReais, ...cenario.gpsExtras].map((g) => ({ ...g, area_id: cenario.areaDoGp[g.id] ?? g.area_id })),
    [gpsReais, cenario]
  );
  const ativos = cenario.clientes.filter((c) => !c.removido);
  const removidos = cenario.clientes.filter((c) => c.removido && !c.novo);
  const reaisPorId = useMemo(() => new Map(reais.map((r) => [r.id, r])), [reais]);

  const mrrReal = reais.reduce((s, c) => s + c.mrr, 0);
  const mrrProj = ativos.reduce((s, c) => s + c.mrr, 0);
  const alterados = cenario.clientes.filter((c) => {
    if (c.novo || c.removido) return true;
    const r = reaisPorId.get(c.id);
    return !r || r.gp !== c.gp || r.mrr !== c.mrr;
  }).length + cenario.gpsExtras.length + Object.keys(cenario.areaDoGp).length;

  if (loadingPerfil) return <p className="text-brand-muted">Carregando...</p>;
  if (!isGerente) return <p className="text-brand-muted">Esta tela é exclusiva do gerente.</p>;
  if (loading) return <p className="text-brand-muted">Carregando projeção...</p>;

  const squadsVisiveis = aba === "todos" ? squads : squads.filter((s) => s.id === aba);
  const semGp = ativos.filter((c) => !c.gp || !gps.some((g) => g.id === c.gp));
  const real = (gpId: string) => reais.filter((c) => c.gp === gpId);

  return (
    <div onDragEnd={() => setArrastando(null)}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🔮 Projeção</h1>
          <p className="text-sm text-brand-muted">
            Cópia do organograma para simular cenários. Arraste clientes entre GPs, mude o MRR, inclua ou tire clientes.
          </p>
        </div>
        <button onClick={resetar} className="rounded-lg border border-white/15 px-3 py-1.5 text-xs text-brand-muted hover:border-brand hover:text-brand">
          ↺ Voltar para o real
        </button>
      </div>

      <div className="mb-4 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 py-2 text-xs text-violet-200">
        🧪 <strong>Modo simulação:</strong> nada desta tela altera o sistema ou o banco. A projeção fica salva só neste navegador.
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Resumo titulo="MRR real" valor={brl(mrrReal)} />
        <Resumo titulo="MRR projetado" valor={brl(mrrProj)} extra={<Delta v={mrrProj - mrrReal} />} />
        <Resumo titulo="Clientes" valor={`${reais.length} → ${ativos.length}`} extra={<Delta v={ativos.length - reais.length} moeda={false} />} />
        <Resumo titulo="Alterações na projeção" valor={String(alterados)} />
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-white/5 pb-4">
        {[{ id: "todos", nome: "Todos" }, ...squads].map((s) => (
          <button key={s.id} onClick={() => setAba(s.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${aba === s.id ? "bg-brand text-white" : "border border-white/10 text-brand-muted hover:text-gray-200"}`}>
            {s.nome}
          </button>
        ))}
      </div>

      <div className="space-y-8">
        {squadsVisiveis.map((sq) => {
          const gpsSquad = gps.filter((g) => g.area_id === sq.id);
          const cliSquad = ativos.filter((c) => gpsSquad.some((g) => g.id === c.gp));
          const mrrSquad = cliSquad.reduce((s, c) => s + c.mrr, 0);
          const mrrSquadReal = reais.filter((c) => gpsReais.some((g) => g.area_id === sq.id && g.id === c.gp)).reduce((s, c) => s + c.mrr, 0);
          return (
            <div key={sq.id} className="rounded-2xl border-2 border-red-500/60 bg-white/[0.02] p-5">
              <div className="mb-4 text-center">
                <h2 className="text-sm font-bold uppercase tracking-widest text-white">{sq.nome}</h2>
                <p className="text-[11px] font-bold text-emerald-300">
                  MRR projetado · {compacto(mrrSquad)} · {cliSquad.length} clientes <Delta v={mrrSquad - mrrSquadReal} />
                </p>
              </div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {gpsSquad.map((g) => (
                  <CartaoGp key={g.id} gp={g} squads={squads}
                    clientes={ativos.filter((c) => c.gp === g.id)} reais={real(g.id)} reaisPorId={reaisPorId}
                    arrastando={arrastando} setArrastando={setArrastando} onSoltar={() => soltar(g.id)}
                    onMudar={mudarCliente} onExcluirNovo={excluirNovo} onAdicionar={() => adicionarCliente(g.id)}
                    onMoverSquad={(area) => moverGpDeSquad(g.id, area)}
                    onRemoverGp={g.ficticio ? () => removerGpFicticio(g.id) : undefined} />
                ))}
              </div>
              <button onClick={() => adicionarGp(sq.id)}
                className="mt-3 w-full rounded-lg border border-dashed border-white/15 py-2 text-xs text-brand-muted hover:border-brand hover:text-brand">
                + GP fictício neste squad
              </button>
            </div>
          );
        })}

        <div onDragOver={(e) => e.preventDefault()} onDrop={() => soltar(null)}
          className={`rounded-2xl border-2 border-dashed p-4 ${arrastando ? "border-amber-400/60" : "border-white/10"}`}>
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-widest text-brand-muted">
              Sem GP · {semGp.length} · {compacto(semGp.reduce((s, c) => s + c.mrr, 0))}
            </h3>
            <button onClick={() => adicionarCliente(null)} className="text-xs text-brand-muted hover:text-brand">+ cliente</button>
          </div>
          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
            {semGp.map((c) => (
              <LinhaCliente key={c.id} c={c} real={reaisPorId.get(c.id)} arrastando={arrastando} setArrastando={setArrastando}
                onMudar={mudarCliente} onExcluirNovo={excluirNovo} />
            ))}
            {semGp.length === 0 && <p className="text-[11px] italic text-brand-muted">Arraste um cliente aqui para tirá-lo do GP.</p>}
          </div>
        </div>

        {removidos.length > 0 && (
          <div className="rounded-2xl border border-red-500/20 p-4">
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-red-300">
              Saíram na projeção · {removidos.length} · −{compacto(removidos.reduce((s, c) => s + c.mrr, 0))}
            </h3>
            <div className="flex flex-wrap gap-2">
              {removidos.map((c) => (
                <button key={c.id} onClick={() => mudarCliente(c.id, { removido: false })} title="Clique para voltar com o cliente"
                  className="rounded border border-white/10 px-2 py-1 text-[11px] text-brand-muted line-through hover:text-gray-200 hover:no-underline">
                  {c.nome} · {compacto(c.mrr)} ↺
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Resumo({ titulo, valor, extra }: { titulo: string; valor: string; extra?: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <p className="text-[10px] uppercase tracking-widest text-brand-muted">{titulo}</p>
      <p className="mt-1 text-lg font-bold text-white">{valor} {extra}</p>
    </div>
  );
}

function CartaoGp({ gp, squads, clientes, reais, reaisPorId, arrastando, setArrastando, onSoltar, onMudar, onExcluirNovo, onAdicionar, onMoverSquad, onRemoverGp }: {
  gp: SimGp; squads: Area[]; clientes: SimCliente[]; reais: SimCliente[]; reaisPorId: Map<string, SimCliente>;
  arrastando: string | null; setArrastando: (id: string | null) => void; onSoltar: () => void;
  onMudar: (id: string, campos: Partial<SimCliente>) => void; onExcluirNovo: (id: string) => void;
  onAdicionar: () => void; onMoverSquad: (area: string) => void; onRemoverGp?: () => void;
}) {
  const [sobre, setSobre] = useState(false);
  const mrr = clientes.reduce((s, c) => s + c.mrr, 0);
  const mrrReal = reais.reduce((s, c) => s + c.mrr, 0);
  const acimaCap = gp.capacidade != null && clientes.length > gp.capacidade;
  const iniciais = gp.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
      onDragLeave={() => setSobre(false)}
      onDrop={() => { setSobre(false); onSoltar(); }}
      className={`rounded-2xl border-2 bg-white/[0.02] p-4 transition ${sobre && arrastando ? "border-emerald-400" : gp.ficticio ? "border-dashed border-violet-500/50" : "border-red-500/40"}`}
    >
      <div className="mb-3 flex items-center gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 border-red-500/40 bg-gradient-to-br from-red-600 to-red-800">
          {gp.foto_url
            ? // eslint-disable-next-line @next/next/no-img-element
              <img src={gp.foto_url} alt={gp.nome} className="h-full w-full object-cover" />
            : <span className="text-sm font-black text-white">{iniciais}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold uppercase text-white">
            {gp.nome} {gp.ficticio && <span className="text-[9px] text-violet-300">(fictício)</span>}
          </p>
          <p className="text-[11px] font-bold text-emerald-300">
            {compacto(mrr)} <Delta v={mrr - mrrReal} />
            <span className={`ml-2 ${acimaCap ? "text-red-300" : "text-brand-muted"}`}>
              {clientes.length}{gp.capacidade != null ? `/${gp.capacidade}` : ""} clientes{acimaCap ? " ⚠" : ""}
            </span>
          </p>
        </div>
        <select value={gp.area_id} onChange={(e) => onMoverSquad(e.target.value)} title="Mover GP para outro squad (projeção)"
          className="max-w-[90px] rounded border border-white/10 bg-brand-panel px-1 py-0.5 text-[10px] text-brand-muted">
          {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
        </select>
        {onRemoverGp && <button onClick={onRemoverGp} title="Remover GP fictício" className="text-xs text-brand-muted hover:text-red-300">✕</button>}
      </div>
      <div className="space-y-1.5">
        {clientes.slice().sort((a, b) => a.nome.localeCompare(b.nome)).map((c) => (
          <LinhaCliente key={c.id} c={c} real={reaisPorId.get(c.id)} arrastando={arrastando} setArrastando={setArrastando}
            onMudar={onMudar} onExcluirNovo={onExcluirNovo} />
        ))}
        {clientes.length === 0 && <p className="py-3 text-center text-[11px] italic text-brand-muted">Arraste clientes para cá</p>}
      </div>
      <button onClick={onAdicionar} className="mt-2 w-full rounded-lg border border-dashed border-white/15 py-1.5 text-[11px] text-brand-muted hover:border-brand hover:text-brand">
        + cliente novo (projeção)
      </button>
    </div>
  );
}

function LinhaCliente({ c, real, arrastando, setArrastando, onMudar, onExcluirNovo }: {
  c: SimCliente; real?: SimCliente; arrastando: string | null; setArrastando: (id: string | null) => void;
  onMudar: (id: string, campos: Partial<SimCliente>) => void; onExcluirNovo: (id: string) => void;
}) {
  const movido = real && real.gp !== c.gp;
  const mrrMudou = real && real.mrr !== c.mrr;
  return (
    <div
      draggable
      onDragStart={(e) => { setArrastando(c.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", c.id); } catch {} }}
      onDragEnd={() => setArrastando(null)}
      className={`group flex cursor-grab items-center gap-2 rounded-lg border p-2 active:cursor-grabbing ${
        arrastando === c.id ? "opacity-40" : ""} ${
        c.novo ? "border-violet-500/40 bg-violet-500/10" : movido ? "border-sky-500/40 bg-sky-500/10" : "border-white/10 bg-white/[0.03]"}`}
    >
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <p className="truncate text-xs font-semibold uppercase text-white">{c.nome}</p>
          <TagSemanaEE semana={c.semana_ee} size="xs" />
          <TagContratoCliente tag={c.tag_contrato} size="xs" />
          {c.novo && <span className="rounded border border-violet-500/40 px-1 text-[8px] font-bold text-violet-300">NOVO</span>}
          {movido && <span className="rounded border border-sky-500/40 px-1 text-[8px] font-bold text-sky-300">MOVIDO</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px]">
          <span className="text-brand-muted">R$</span>
          <input
            type="number" defaultValue={c.mrr} key={c.mrr}
            onBlur={(e) => { const v = Number(e.target.value) || 0; if (v !== c.mrr) onMudar(c.id, { mrr: v }); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className={`w-20 border-b border-transparent bg-transparent font-bold outline-none focus:border-emerald-400 ${mrrMudou ? "text-amber-300" : "text-emerald-300"}`}
          />
          {mrrMudou && <span className="text-brand-muted line-through">{compacto(real!.mrr)}</span>}
        </div>
      </div>
      <button
        onClick={() => (c.novo ? onExcluirNovo(c.id) : onMudar(c.id, { removido: true }))}
        title={c.novo ? "Excluir da projeção" : "Simular saída do cliente"}
        className="text-xs text-brand-muted opacity-0 hover:text-red-300 group-hover:opacity-100"
      >✕</button>
    </div>
  );
}
