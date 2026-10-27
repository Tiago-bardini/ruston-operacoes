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
  id: string; area_id: string; subsecao_id: string | null; nome: string; cargo: string | null; foto_url: string | null;
  tem_carteira: boolean; ruston_pessoa_id: string | null; capacidade: number | null; linha: number; coluna: number;
};
type SimCliente = {
  id: string; nome: string; mrr: number; gp: string | null;
  etapa?: string | null; semana_ee?: number | null; tag_contrato?: TagContrato | null;
  novo?: boolean; removido?: boolean;
};
type SimGp = { id: string; nome: string; area_id: string; foto_url: string | null; capacidade: number | null; ficticio?: boolean };
type Subsecao = { id: string; area_id: string; nome: string; ordem: number };
/** Cadeira do time: cargo + quem senta nela. nome vazio = vaga em aberto. */
type Cadeira = {
  id: string; area_id: string; subsecao_id: string | null; nome: string; cargo: string;
  linha?: number; coluna?: number; gpId?: string | null;
  nomeReal?: string; areaReal?: string; nova?: boolean; removida?: boolean;
};
type Cenario = { clientes: SimCliente[]; gpsExtras: SimGp[]; areaDoGp: Record<string, string>; cadeiras?: Cadeira[]; squadsExtras?: Area[] };

const CHAVE = "projecao:cenario:v2";
const FORA = "__fora__";
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

function salvoAntes(): Cenario | null {
  try { const t = localStorage.getItem(CHAVE); return t ? JSON.parse(t) : null; } catch { return null; }
}
const ehGp = (cargo: string) => /^\s*(gp|gestor de projetos?)\b/i.test(cargo);

export default function ProjecaoPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, isGerente } = useUsuarioPerfil();
  const [loading, setLoading] = useState(true);
  const [squads, setSquads] = useState<Area[]>([]);
  const [fixas, setFixas] = useState<Area[]>([]);
  const [subsecoes, setSubsecoes] = useState<Subsecao[]>([]);
  const [cadeirasReais, setCadeirasReais] = useState<Cadeira[]>([]);
  const [gpsReais, setGpsReais] = useState<SimGp[]>([]);
  const [reais, setReais] = useState<SimCliente[]>([]);
  const [cenario, setCenario] = useState<Cenario>({ clientes: [], gpsExtras: [], areaDoGp: {} });
  const [aba, setAba] = useState<string>("todos");
  const [arrastando, setArrastando] = useState<string | null>(null);
  const [arrastandoPessoa, setArrastandoPessoa] = useState<string | null>(null);
  const [editandoCadeira, setEditandoCadeira] = useState<Cadeira | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: a }, { data: p }, { data: cli }, { data: pc }, { data: sub }, semanas, tags] = await Promise.all([
      supabase.from("ruston_org_areas").select("id,nome,tipo,ordem").eq("ativo", true).order("ordem"),
      supabase.from("ruston_org_pessoas").select("id,area_id,subsecao_id,nome,cargo,foto_url,tem_carteira,ruston_pessoa_id,capacidade,linha,coluna").eq("ativo", true).order("linha").order("coluna"),
      supabase.from("ruston_clientes").select("id,nome,account_id,mrr,churn_realizado,subiu_no_sistema,etapa").eq("ativo", true),
      supabase.from("ruston_pessoas").select("id,nome"),
      supabase.from("ruston_org_subsecoes").select("id,area_id,nome,ordem").eq("ativo", true).order("ordem"),
      carregarSemanasEE(supabase),
      carregarTagsContrato(supabase),
    ]);
    const todasAreas = (a as Area[]) ?? [];
    const sq = todasAreas.filter((x) => x.tipo === "squad");
    const pessoasOrg = (p as OrgPessoa[]) ?? [];
    const brutos = ((cli as { id: string; nome: string; account_id: string | null; mrr: number | null; churn_realizado: boolean; subiu_no_sistema: boolean; etapa: string | null }[]) ?? [])
      .filter((x) => !(x.churn_realizado && x.subiu_no_sistema));
    const comCliente = new Set(brutos.map((x) => x.account_id).filter(Boolean) as string[]);
    // GP = quem tem carteira no organograma ou tem cliente ativo no sistema
    const gps: SimGp[] = [];
    const idsGp = new Set<string>();
    pessoasOrg.forEach((x) => {
      if (!x.ruston_pessoa_id || idsGp.has(x.ruston_pessoa_id)) return;
      if (!x.tem_carteira && !comCliente.has(x.ruston_pessoa_id)) return;
      idsGp.add(x.ruston_pessoa_id);
      gps.push({ id: x.ruston_pessoa_id, nome: x.nome, area_id: x.area_id, foto_url: x.foto_url, capacidade: x.capacidade });
    });
    // Dono de cliente que não está no organograma também entra, num grupo à parte
    const nomes = new Map(((pc as { id: string; nome: string }[]) ?? []).map((x) => [x.id, x.nome]));
    comCliente.forEach((id) => {
      if (idsGp.has(id)) return;
      idsGp.add(id);
      gps.push({ id, nome: nomes.get(id) ?? "GP sem nome", area_id: FORA, foto_url: null, capacidade: null });
    });
    const clientes: SimCliente[] = brutos
      .map((x) => ({
        id: x.id, nome: x.nome, mrr: x.mrr ?? 0,
        gp: x.account_id && idsGp.has(x.account_id) ? x.account_id : null,
        etapa: x.etapa, semana_ee: semanas[x.id] ?? null, tag_contrato: tags[x.id] ?? null,
      }));
    setSquads([...sq, ...(salvoAntes()?.squadsExtras ?? [])]);
    setFixas(todasAreas.filter((x) => x.tipo !== "squad"));
    setSubsecoes((sub as Subsecao[]) ?? []);
    const cadeiras: Cadeira[] = pessoasOrg.map((x) => ({
      id: x.id, area_id: x.area_id, subsecao_id: x.subsecao_id ?? null,
      nome: x.nome, cargo: (x.cargo ?? "").replace(/\n/g, " "), nomeReal: x.nome, areaReal: x.area_id,
      linha: x.linha, coluna: x.coluna, gpId: x.ruston_pessoa_id && idsGp.has(x.ruston_pessoa_id) ? x.ruston_pessoa_id : null,
    }));
    const realPorId = new Map(cadeiras.map((x) => [x.id, x]));
    setCadeirasReais(cadeiras);
    setGpsReais(gps);
    setReais(clientes);
    let salvo: Cenario | null = null;
    try { const t = localStorage.getItem(CHAVE); if (t) salvo = JSON.parse(t); } catch {}
    // cenário salvo antes das cadeiras existirem é completado com o time real
    // e cadeira salva antes de existir posição no desenho herda a posição real
    const completar = (lista: Cadeira[]) => lista.map((x) => {
      const r = realPorId.get(x.id);
      return {
        ...x,
        linha: x.linha ?? (r && r.area_id === x.area_id ? r.linha : 99),
        coluna: x.coluna ?? r?.coluna ?? 99,
        gpId: x.gpId !== undefined ? x.gpId : r?.gpId ?? null,
      };
    });
    setCenario(salvo ? { ...salvo, cadeiras: completar(salvo.cadeiras ?? cadeiras) } : { clientes, gpsExtras: [], areaDoGp: {}, cadeiras });
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
    setSquads((prev) => prev.filter((x) => !x.id.startsWith("sq:")));
    setCenario({ clientes: reais, gpsExtras: [], areaDoGp: {}, cadeiras: cadeirasReais });
  }

  const mudarCadeira = (id: string, campos: Partial<Cadeira>) =>
    atualizar((c) => ({ ...c, cadeiras: (c.cadeiras ?? []).map((x) => (x.id === id ? { ...x, ...campos } : x)) }));
  function removerCadeira(cad: Cadeira) {
    atualizar((c) => ({
      ...c,
      cadeiras: cad.nova
        ? (c.cadeiras ?? []).filter((x) => x.id !== cad.id)
        : (c.cadeiras ?? []).map((x) => (x.id === cad.id ? { ...x, removida: true } : x)),
    }));
  }
  function salvarCadeira(cad: Cadeira) {
    atualizar((c) => {
      const lista = c.cadeiras ?? [];
      const existe = lista.some((x) => x.id === cad.id);
      return { ...c, cadeiras: existe ? lista.map((x) => (x.id === cad.id ? cad : x)) : [...lista, cad] };
    });
  }
  /** Solta a pessoa arrastada num lugar: em cima de outra (troca as duas de lugar) ou numa linha. */
  function soltarPessoa(destino: { area_id: string; subsecao_id: string | null; linha: number; coluna: number; trocaCom?: string }) {
    const id = arrastandoPessoa;
    setArrastandoPessoa(null);
    if (!id || id === destino.trocaCom) return;
    atualizar((c) => {
      const lista = c.cadeiras ?? [];
      const origem = lista.find((x) => x.id === id);
      if (!origem) return c;
      return {
        ...c,
        cadeiras: lista.map((x) => {
          if (x.id === id) return { ...x, area_id: destino.area_id, subsecao_id: destino.subsecao_id, linha: destino.linha, coluna: destino.coluna };
          if (destino.trocaCom && x.id === destino.trocaCom)
            return { ...x, area_id: origem.area_id, subsecao_id: origem.subsecao_id, linha: origem.linha, coluna: origem.coluna };
          return x;
        }),
      };
    });
  }
  const timeProps = (area_id: string) => ({
    area_id, subsecoes: subsecoes.filter((x) => x.area_id === area_id),
    cadeiras: (cenario.cadeiras ?? []).filter((x) => x.area_id === area_id && !x.removida),
    ativos: cenario.clientes.filter((x) => !x.removido),
    arrastando: arrastandoPessoa, setArrastando: setArrastandoPessoa, onSoltar: soltarPessoa,
    onEditar: (cad: Cadeira) => setEditandoCadeira(cad),
    onAdicionar: (subsecao_id: string | null, linha: number) =>
      setEditandoCadeira({ id: `cad:${Date.now()}`, area_id, subsecao_id, nome: "", cargo: "", linha, coluna: 99, gpId: null, nova: true }),
  });

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
  // a cadeira do GP vai junto, para o desenho do time acompanhar
  const moverGpDeSquad = (gpId: string, area_id: string) =>
    atualizar((c) => ({
      ...c,
      areaDoGp: { ...c.areaDoGp, [gpId]: area_id },
      cadeiras: (c.cadeiras ?? []).map((x) => (x.gpId === gpId || x.id === gpId ? { ...x, area_id, subsecao_id: null, linha: 99 } : x)),
    }));
  const soltar = (gp: string | null) => {
    if (arrastando) mudarCliente(arrastando, { gp });
    setArrastando(null);
  };

  const gps = useMemo(() => {
    const cads = (cenario.cadeiras ?? []).filter((x) => !x.removida);
    const porGp = new Map(cads.filter((x) => x.gpId).map((x) => [x.gpId!, x]));
    const base = [...gpsReais, ...cenario.gpsExtras].map((g) => {
      const cad = porGp.get(g.id);
      return { ...g, area_id: cad?.area_id ?? cenario.areaDoGp[g.id] ?? g.area_id, nome: cad?.nome || g.nome };
    });
    const novos: SimGp[] = cads.filter((x) => x.nova && ehGp(x.cargo))
      .map((x) => ({ id: x.id, nome: x.nome || "GP (vaga)", area_id: x.area_id, foto_url: null, capacidade: null, ficticio: true }));
    return [...base, ...novos];
  }, [gpsReais, cenario]);
  const ativos = cenario.clientes.filter((c) => !c.removido);
  const removidos = cenario.clientes.filter((c) => c.removido && !c.novo);
  const reaisPorId = useMemo(() => new Map(reais.map((r) => [r.id, r])), [reais]);

  const mrrReal = reais.reduce((s, c) => s + c.mrr, 0);
  const mrrProj = ativos.reduce((s, c) => s + c.mrr, 0);
  const alterados = cenario.clientes.filter((c) => {
    if (c.novo || c.removido) return true;
    const r = reaisPorId.get(c.id);
    return !r || r.gp !== c.gp || r.mrr !== c.mrr;
  }).length + cenario.gpsExtras.length + Object.keys(cenario.areaDoGp).length
    + (cenario.cadeiras ?? []).filter((x) => x.nova || x.removida || x.nome !== x.nomeReal || x.area_id !== x.areaReal).length;

  if (loadingPerfil) return <p className="text-brand-muted">Carregando...</p>;
  if (!isGerente) return <p className="text-brand-muted">Esta tela é exclusiva do gerente.</p>;
  if (loading) return <p className="text-brand-muted">Carregando projeção...</p>;

  const temFora = gps.some((g) => g.area_id === FORA);
  const blocos: Area[] = [...squads, ...(temFora ? [{ id: FORA, nome: "Fora do organograma", tipo: "squad" as const, ordem: 999 }] : [])];
  const squadsVisiveis = aba === "todos" ? blocos : blocos.filter((s) => s.id === aba);
  const semGp = ativos.filter((c) => !c.gp || !gps.some((g) => g.id === c.gp));
  const real = (gpId: string) => reais.filter((c) => c.gp === gpId);

  return (
    <div onDragEnd={() => { setArrastando(null); setArrastandoPessoa(null); }}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">🔮 Projeção</h1>
          <p className="text-sm text-brand-muted">
            Cópia do organograma para simular cenários. Arraste pessoas para trocar de lugar, clique para editar. Na aba de cada squad, arraste clientes entre GPs.
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
        {[{ id: "todos", nome: "Todos" }, ...blocos].map((s) => (
          <button key={s.id} onClick={() => setAba(s.id)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${aba === s.id ? "bg-brand text-white" : "border border-white/10 text-brand-muted hover:text-gray-200"}`}>
            {s.nome}
          </button>
        ))}
      </div>

      {aba === "todos" && (
        <>
          <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
            {fixas.map((f) => (
              <div key={f.id} className="rounded-2xl border-2 border-red-500/60 bg-white/[0.02] p-5">
                <h2 className="mb-5 text-center text-sm font-bold uppercase tracking-widest text-white">{f.nome}</h2>
                <Time {...timeProps(f.id)} />
              </div>
            ))}
          </div>
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-brand-muted">Squads</h2>
          <div className="mb-8 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
            {squads.map((sq) => {
              const mrrSquad = ativos.filter((c) => gps.some((g) => g.area_id === sq.id && g.id === c.gp)).reduce((s, c) => s + c.mrr, 0);
              return (
                <div key={sq.id} className="rounded-2xl border-2 border-red-500/60 bg-white/[0.02] p-5">
                  <h2 className="text-center text-sm font-bold uppercase tracking-widest text-white">{sq.nome}</h2>
                  <p className="mb-5 text-center text-[11px] font-bold text-emerald-300">MRR total · {compacto(mrrSquad)}</p>
                  <Time {...timeProps(sq.id)} />
                </div>
              );
            })}
          </div>
          <button
            onClick={() => {
              const nome = prompt("Nome do novo squad (projeção):");
              if (!nome?.trim()) return;
              const novo: Area = { id: `sq:${Date.now()}`, nome: nome.trim().toUpperCase(), tipo: "squad", ordem: 999 };
              setSquads((prev) => [...prev, novo]);
              atualizar((c) => ({ ...c, squadsExtras: [...(c.squadsExtras ?? []), novo] }));
            }}
            className="mb-8 w-full rounded-lg border border-dashed border-white/15 py-2 text-xs text-brand-muted hover:border-brand hover:text-brand"
          >
            + squad (projeção)
          </button>
        </>
      )}

      <div className="space-y-8">
        {(aba === "todos" ? [] : squadsVisiveis).map((sq) => {
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
              {sq.id !== FORA && <Time {...timeProps(sq.id)} />}
              {sq.id !== FORA && <h3 className="mb-3 mt-2 border-t border-red-500/20 pt-5 text-center text-xs font-semibold uppercase tracking-widest text-brand-muted">📋 Carteira de clientes</h3>}
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

        {editandoCadeira && (
          <ModalCadeira cad={editandoCadeira} areas={[...fixas, ...squads]} subsecoes={subsecoes}
            onFechar={() => setEditandoCadeira(null)}
            onSalvar={(cad) => { salvarCadeira(cad); setEditandoCadeira(null); }}
            onRemover={editandoCadeira.nova && !(cenario.cadeiras ?? []).some((x) => x.id === editandoCadeira.id)
              ? undefined : () => { removerCadeira(editandoCadeira); setEditandoCadeira(null); }} />
        )}

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

/** Time no formato do organograma: linhas de pessoas (coordenação em cima, células GP/GT/DG embaixo).
 *  Arrastar uma pessoa sobre outra troca as duas de lugar; soltar no "+" de uma linha coloca ali. */
function Time({ subsecoes, cadeiras, ativos, arrastando, setArrastando, onSoltar, onEditar, onAdicionar, area_id }: {
  area_id: string; subsecoes: Subsecao[]; cadeiras: Cadeira[]; ativos: SimCliente[];
  arrastando: string | null; setArrastando: (id: string | null) => void;
  onSoltar: (d: { area_id: string; subsecao_id: string | null; linha: number; coluna: number; trocaCom?: string }) => void;
  onEditar: (c: Cadeira) => void; onAdicionar: (subsecao_id: string | null, linha: number) => void;
}) {
  const idsSub = new Set(subsecoes.map((x) => x.id));
  const grupos: { id: string | null; nome: string | null }[] = [{ id: null, nome: null }, ...subsecoes.map((x) => ({ id: x.id, nome: x.nome }))];
  return (
    <div className="space-y-6">
      {grupos.map((g) => {
        const lista = cadeiras.filter((c) => (g.id === null ? !c.subsecao_id || !idsSub.has(c.subsecao_id) : c.subsecao_id === g.id));
        const linhas = Array.from(new Set(lista.map((c) => c.linha ?? 99))).sort((a, b) => a - b);
        const proxima = (linhas[linhas.length - 1] ?? -1) + 1;
        return (
          <div key={g.id ?? "topo"} className={g.nome ? "border-t border-white/10 pt-4" : ""}>
            {g.nome && <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-brand-muted">{g.nome}</p>}
            <div className="space-y-5">
              {linhas.map((l) => {
                const daLinha = lista.filter((c) => (c.linha ?? 99) === l).sort((a, b) => (a.coluna ?? 99) - (b.coluna ?? 99));
                const ultimaCol = (daLinha[daLinha.length - 1]?.coluna ?? 0) + 1;
                return (
                  <div key={l} className="flex flex-wrap items-start justify-center gap-x-4 gap-y-3">
                    {daLinha.map((c) => (
                      <Pessoa key={c.id} c={c} ativos={ativos} arrastando={arrastando} setArrastando={setArrastando}
                        onClick={() => onEditar(c)}
                        onSoltar={() => onSoltar({ area_id, subsecao_id: g.id, linha: l, coluna: c.coluna ?? 99, trocaCom: c.id })} />
                    ))}
                    <AlvoNovo ativo={!!arrastando} titulo="+" onClick={() => onAdicionar(g.id, l)}
                      onSoltar={() => onSoltar({ area_id, subsecao_id: g.id, linha: l, coluna: ultimaCol })} />
                  </div>
                );
              })}
              <div className="flex justify-center">
                <AlvoNovo ativo={!!arrastando} titulo={arrastando ? "soltar aqui = nova linha" : "+ adicionar pessoa"} largo
                  onClick={() => onAdicionar(g.id, proxima)}
                  onSoltar={() => onSoltar({ area_id, subsecao_id: g.id, linha: proxima, coluna: 0 })} />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AlvoNovo({ ativo, titulo, largo, onClick, onSoltar }: { ativo: boolean; titulo: string; largo?: boolean; onClick: () => void; onSoltar: () => void }) {
  const [sobre, setSobre] = useState(false);
  return (
    <button
      onClick={onClick}
      onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => { e.preventDefault(); setSobre(false); onSoltar(); }}
      className={`rounded-lg border border-dashed text-[10px] transition ${largo ? "px-4 py-1.5" : "mt-4 h-10 w-10"} ${
        sobre ? "border-emerald-400 text-emerald-300" : ativo ? "border-white/30 text-gray-300" : "border-white/10 text-brand-muted hover:border-brand hover:text-brand"}`}
    >
      {titulo}
    </button>
  );
}

function Pessoa({ c, ativos, arrastando, setArrastando, onClick, onSoltar }: {
  c: Cadeira; ativos: SimCliente[]; arrastando: string | null; setArrastando: (id: string | null) => void;
  onClick: () => void; onSoltar: () => void;
}) {
  const [sobre, setSobre] = useState(false);
  const vaga = !c.nome.trim();
  const iniciais = vaga ? "?" : c.nome.split(" ").map((x) => x[0]).slice(0, 2).join("").toUpperCase();
  const gpId = c.gpId ?? (c.nova && ehGp(c.cargo) ? c.id : null);
  const meus = gpId ? ativos.filter((x) => x.gp === gpId) : [];
  const mrr = meus.reduce((s, x) => s + x.mrr, 0);
  const mudou = c.nova || c.nome !== c.nomeReal || c.area_id !== c.areaReal;
  return (
    <div
      draggable
      onDragStart={(e) => { setArrastando(c.id); e.dataTransfer.effectAllowed = "move"; try { e.dataTransfer.setData("text/plain", c.id); } catch {} }}
      onDragEnd={() => setArrastando(null)}
      onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => { e.preventDefault(); setSobre(false); onSoltar(); }}
      onClick={onClick}
      title="Arraste para trocar de lugar · clique para editar"
      className={`flex w-24 cursor-grab flex-col items-center gap-1 rounded-lg p-1.5 text-center transition active:cursor-grabbing hover:bg-white/5 ${
        arrastando === c.id ? "scale-95 opacity-40" : ""} ${sobre && arrastando !== c.id ? "ring-2 ring-emerald-400" : ""}`}
    >
      <div className={`pointer-events-none flex h-12 w-12 items-center justify-center rounded-full border-2 ${
        vaga ? "border-dashed border-amber-400/70 bg-amber-500/10" : c.nova ? "border-violet-400/70 bg-violet-600/40" : "border-red-500/40 bg-gradient-to-br from-red-600 to-red-800"}`}>
        <span className={`text-sm font-black ${vaga ? "text-amber-300" : "text-white"}`}>{iniciais}</span>
      </div>
      <div className="pointer-events-none">
        <p className={`text-[11px] font-bold uppercase leading-tight ${vaga ? "italic text-amber-300" : "text-white"}`}>{vaga ? "Vaga" : c.nome}</p>
        {c.cargo && <p className="text-[9px] uppercase leading-tight text-red-300">{c.cargo}</p>}
        {gpId && (
          <>
            <p className="mt-0.5 text-[10px] font-bold text-emerald-300">💰 {compacto(mrr)}</p>
            <p className="text-[9px] text-brand-muted">{meus.length} {meus.length === 1 ? "cliente" : "clientes"}</p>
          </>
        )}
        {mudou && <p className="text-[8px] font-bold text-sky-300">{c.nova ? "NOVA" : "ALTERADO"}</p>}
      </div>
    </div>
  );
}

function ModalCadeira({ cad, areas, subsecoes, onFechar, onSalvar, onRemover }: {
  cad: Cadeira; areas: Area[]; subsecoes: Subsecao[];
  onFechar: () => void; onSalvar: (c: Cadeira) => void; onRemover?: () => void;
}) {
  const [f, setF] = useState(cad);
  const subsDoTime = subsecoes.filter((x) => x.area_id === f.area_id);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-white/10 bg-brand-panel p-5" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-sm font-bold">{cad.nova && !cad.nome ? "Nova pessoa (projeção)" : "Editar (projeção)"}</h3>
        <label className="block text-xs text-brand-muted">Nome <span className="text-[10px]">(vazio = vaga em aberto)</span>
          <input className="input mt-1" value={f.nome} autoFocus onChange={(e) => setF({ ...f, nome: e.target.value })} />
        </label>
        <label className="block text-xs text-brand-muted">Cargo
          <input className="input mt-1" value={f.cargo} placeholder="GP, GT, DG, Coordenador..." onChange={(e) => setF({ ...f, cargo: e.target.value })} />
        </label>
        <label className="block text-xs text-brand-muted">Time
          <select className="input mt-1" value={f.area_id} onChange={(e) => setF({ ...f, area_id: e.target.value, subsecao_id: null, linha: f.area_id === e.target.value ? f.linha : 99 })}>
            {areas.map((a) => <option key={a.id} value={a.id}>{a.nome}</option>)}
          </select>
        </label>
        {subsDoTime.length > 0 && (
          <label className="block text-xs text-brand-muted">Subseção
            <select className="input mt-1" value={f.subsecao_id ?? ""} onChange={(e) => setF({ ...f, subsecao_id: e.target.value || null })}>
              <option value="">Topo</option>
              {subsDoTime.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
            </select>
          </label>
        )}
        {cad.nomeReal && cad.nomeReal !== f.nome && <p className="text-[11px] text-brand-muted">No organograma real: <strong>{cad.nomeReal}</strong></p>}
        <div className="flex items-center gap-2 pt-2">
          <button className="btn flex-1 text-xs" onClick={() => onSalvar({ ...f, nome: f.nome.trim(), cargo: f.cargo.trim() })}>Salvar na projeção</button>
          <button className="btn-ghost text-xs" onClick={onFechar}>Cancelar</button>
          {onRemover && <button className="text-xs text-red-300 hover:text-red-200" onClick={onRemover}>Tirar</button>}
        </div>
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
          {gp.area_id === FORA && <option value={FORA}>Fora</option>}
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
