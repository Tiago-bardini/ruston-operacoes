"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

// ============================================================
// TIPOS
// ============================================================
type Area = { id: string; nome: string; tipo: "fixa" | "squad"; cor: string; ordem: number; ativo: boolean };
type Subsecao = { id: string; area_id: string; nome: string; ordem: number; ativo: boolean };
type OrgPessoa = {
  id: string; area_id: string; subsecao_id: string | null;
  nome: string; cargo: string | null; foto_url: string | null;
  destaque: boolean; linha: number; coluna: number; ordem: number;
  ativo: boolean; tem_carteira: boolean;
};
type Carteira = { id: string; pessoa_id: string; cliente_nome: string; tags: string[]; ordem: number; ativo: boolean };

// ============================================================
// PÁGINA
// ============================================================
export default function OrganogramaPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, podeEditar } = useUsuarioPerfil();
  const [areas, setAreas] = useState<Area[]>([]);
  const [subsecoes, setSubsecoes] = useState<Subsecao[]>([]);
  const [pessoas, setPessoas] = useState<OrgPessoa[]>([]);
  const [carteiras, setCarteiras] = useState<Carteira[]>([]);
  const [loading, setLoading] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState<string>("todos");
  const [editando, setEditando] = useState<OrgPessoa | null>(null);
  const [novaPessoa, setNovaPessoa] = useState<{ area_id: string; subsecao_id: string | null } | null>(null);
  // Drag & Drop
  const [pessoaArrastando, setPessoaArrastando] = useState<string | null>(null);
  const [dropzoneAtiva, setDropzoneAtiva] = useState<string | null>(null); // formato: "area_id" ou "area_id:subsecao_id"

  async function load() {
    setLoading(true);
    const [{ data: a }, { data: s }, { data: p }, { data: c }] = await Promise.all([
      supabase.from("ruston_org_areas").select("*").eq("ativo", true).order("ordem"),
      supabase.from("ruston_org_subsecoes").select("*").eq("ativo", true).order("ordem"),
      supabase.from("ruston_org_pessoas").select("*").eq("ativo", true).order("linha").order("coluna"),
      supabase.from("ruston_org_carteiras").select("*").eq("ativo", true).order("ordem"),
    ]);
    setAreas((a as Area[]) ?? []);
    setSubsecoes((s as Subsecao[]) ?? []);
    setPessoas((p as OrgPessoa[]) ?? []);
    setCarteiras((c as Carteira[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { if (!loadingPerfil) load(); /* eslint-disable-next-line */ }, [loadingPerfil]);

  // Handler: mover pessoa pra outra área/subseção
  async function moverPessoa(pessoaId: string, novaAreaId: string, novaSubsecaoId: string | null) {
    // Atualização otimista (UI reage antes do banco)
    setPessoas((prev) =>
      prev.map((p) =>
        p.id === pessoaId
          ? { ...p, area_id: novaAreaId, subsecao_id: novaSubsecaoId, linha: 0, coluna: 0 }
          : p
      )
    );
    await supabase
      .from("ruston_org_pessoas")
      .update({ area_id: novaAreaId, subsecao_id: novaSubsecaoId, linha: 0, coluna: 0 })
      .eq("id", pessoaId);
    // Recarrega pra garantir sincronia
    load();
  }

  const areasFixas = useMemo(() => areas.filter((a) => a.tipo === "fixa"), [areas]);
  const squads = useMemo(() => areas.filter((a) => a.tipo === "squad"), [areas]);

  const contagens = useMemo(() => {
    const map: Record<string, number> = { todos: 0 };
    areasFixas.forEach((a) => (map.todos += pessoas.filter((p) => p.area_id === a.id).length));
    squads.forEach((a) => (map[a.id] = pessoas.filter((p) => p.area_id === a.id).length));
    return map;
  }, [pessoas, areasFixas, squads]);

  const areasVisiveis = useMemo(() => {
    if (abaAtiva === "todos") return areasFixas;
    return areas.filter((a) => a.id === abaAtiva);
  }, [abaAtiva, areas, areasFixas]);

  const pessoasCarteira = useMemo(() => {
    const squadIds = abaAtiva === "todos" ? squads.map((s) => s.id) : [abaAtiva];
    return pessoas
      .filter((p) => p.tem_carteira && squadIds.includes(p.area_id))
      .sort((a, b) => a.linha - b.linha || a.ordem - b.ordem);
  }, [pessoas, squads, abaAtiva]);

  // Quando o user solta em algum lugar não-válido
  function limparDrag() {
    setPessoaArrastando(null);
    setDropzoneAtiva(null);
  }

  if (loadingPerfil || loading) {
    return <p className="text-brand-muted">Carregando organograma...</p>;
  }

  return (
    <div onDragEnd={limparDrag}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">👥 Organograma</h1>
          <p className="text-sm text-brand-muted">
            Estrutura visual da Ruston · <strong>arrasta as pessoas</strong> pra mover entre áreas
          </p>
        </div>
      </div>

      {/* GRID DE ÁREAS - topo */}
      <div className={`mb-6 grid gap-4 ${areasVisiveis.length === 1 ? "grid-cols-1 max-w-3xl mx-auto" : "grid-cols-1 lg:grid-cols-3"}`}>
        {areasVisiveis.map((area) => (
          <AreaCard
            key={area.id}
            area={area}
            subsecoes={subsecoes.filter((s) => s.area_id === area.id)}
            pessoas={pessoas.filter((p) => p.area_id === area.id)}
            podeEditar={podeEditar}
            onEditar={setEditando}
            onAdicionar={(sub) => setNovaPessoa({ area_id: area.id, subsecao_id: sub })}
            pessoaArrastando={pessoaArrastando}
            setPessoaArrastando={setPessoaArrastando}
            dropzoneAtiva={dropzoneAtiva}
            setDropzoneAtiva={setDropzoneAtiva}
            moverPessoa={moverPessoa}
          />
        ))}
      </div>

      {/* ABAS DE SQUADS */}
      <div className="mt-6 flex flex-wrap gap-2 border-t border-white/5 pt-4">
        <TabButton label="Todos" count={contagens.todos} ativo={abaAtiva === "todos"} onClick={() => setAbaAtiva("todos")} />
        {squads.map((s) => (
          <TabButton
            key={s.id}
            label={s.nome}
            count={contagens[s.id] ?? 0}
            ativo={abaAtiva === s.id}
            onClick={() => setAbaAtiva(s.id)}
            areaId={s.id}
            pessoaArrastando={pessoaArrastando}
            dropzoneAtiva={dropzoneAtiva}
            setDropzoneAtiva={setDropzoneAtiva}
            moverPessoa={moverPessoa}
          />
        ))}
        {podeEditar && (
          <button
            onClick={async () => {
              const nome = prompt("Nome do novo squad:");
              if (!nome) return;
              await supabase.from("ruston_org_areas").insert({
                nome: nome.toUpperCase(),
                tipo: "squad",
                ordem: (squads.length + 1) * 10,
              });
              load();
            }}
            className="rounded-lg border border-dashed border-white/20 px-3 py-1.5 text-xs text-brand-muted hover:border-brand hover:text-brand"
          >
            + squad
          </button>
        )}
      </div>

      {/* Área do squad selecionado (mostra suas pessoas + permite drop) */}
      {abaAtiva !== "todos" && (
        <div className="mt-6">
          {areas
            .filter((a) => a.id === abaAtiva)
            .map((a) => (
              <AreaCard
                key={a.id}
                area={a}
                subsecoes={subsecoes.filter((s) => s.area_id === a.id)}
                pessoas={pessoas.filter((p) => p.area_id === a.id)}
                podeEditar={podeEditar}
                onEditar={setEditando}
                onAdicionar={(sub) => setNovaPessoa({ area_id: a.id, subsecao_id: sub })}
                pessoaArrastando={pessoaArrastando}
                setPessoaArrastando={setPessoaArrastando}
                dropzoneAtiva={dropzoneAtiva}
                setDropzoneAtiva={setDropzoneAtiva}
                moverPessoa={moverPessoa}
              />
            ))}
        </div>
      )}

      {/* SEÇÃO: CARTEIRA DE CLIENTES */}
      {pessoasCarteira.length > 0 && (
        <div className="mt-8 border-t border-white/5 pt-6">
          <h2 className="mb-6 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-brand-muted">
            📋 Carteira de Clientes
          </h2>
          <div className="grid gap-4 grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {pessoasCarteira.map((p) => (
              <CarteiraCard key={p.id} pessoa={p} clientes={carteiras.filter((c) => c.pessoa_id === p.id)} podeEditar={podeEditar} onChanged={load} />
            ))}
          </div>
        </div>
      )}

      {pessoasCarteira.length === 0 && abaAtiva !== "todos" && (
        <div className="mt-8 border-t border-white/5 pt-6">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-brand-muted">
            📋 Carteira de Clientes
          </h2>
          <p className="text-xs text-brand-muted">
            Nenhuma pessoa desse squad tem carteira marcada. Clica em alguém e marca <strong>"Tem carteira"</strong>.
          </p>
        </div>
      )}

      {/* Modais */}
      {editando && (
        <ModalPessoa
          pessoa={editando}
          areas={areas}
          subsecoes={subsecoes}
          onFechar={() => setEditando(null)}
          onSalvo={() => { setEditando(null); load(); }}
        />
      )}
      {novaPessoa && (
        <ModalPessoa
          pessoa={{
            id: "", area_id: novaPessoa.area_id, subsecao_id: novaPessoa.subsecao_id,
            nome: "", cargo: "", foto_url: null, destaque: false,
            linha: 0, coluna: 0, ordem: 0, ativo: true, tem_carteira: false,
          }}
          areas={areas}
          subsecoes={subsecoes}
          onFechar={() => setNovaPessoa(null)}
          onSalvo={() => { setNovaPessoa(null); load(); }}
        />
      )}
    </div>
  );
}

// ============================================================
// TAB BUTTON (agora aceita drop)
// ============================================================
function TabButton({
  label, count, ativo, onClick, areaId, pessoaArrastando, dropzoneAtiva, setDropzoneAtiva, moverPessoa,
}: {
  label: string; count: number; ativo: boolean; onClick: () => void;
  areaId?: string;
  pessoaArrastando?: string | null;
  dropzoneAtiva?: string | null;
  setDropzoneAtiva?: (v: string | null) => void;
  moverPessoa?: (pessoaId: string, novaAreaId: string, novaSubsecaoId: string | null) => Promise<void>;
}) {
  const podeReceber = !!areaId && !!pessoaArrastando;
  const ativaDropzone = dropzoneAtiva === areaId;

  return (
    <button
      onClick={onClick}
      onDragOver={(e) => {
        if (podeReceber) {
          e.preventDefault();
          setDropzoneAtiva?.(areaId!);
        }
      }}
      onDragLeave={() => setDropzoneAtiva?.(null)}
      onDrop={async (e) => {
        e.preventDefault();
        if (pessoaArrastando && areaId && moverPessoa) {
          await moverPessoa(pessoaArrastando, areaId, null);
          setDropzoneAtiva?.(null);
        }
      }}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        ativaDropzone ? "ring-2 ring-emerald-400 bg-emerald-500/20 text-emerald-100" :
        ativo ? "bg-brand text-white" : "bg-white/5 text-brand-muted hover:bg-white/10 hover:text-white"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${
        ativo ? "bg-white/20 text-white" : "bg-brand text-white"
      }`}>
        {count}
      </span>
    </button>
  );
}

// ============================================================
// AREA CARD (aceita drop)
// ============================================================
function AreaCard({
  area, subsecoes, pessoas, podeEditar, onEditar, onAdicionar,
  pessoaArrastando, setPessoaArrastando, dropzoneAtiva, setDropzoneAtiva, moverPessoa,
}: {
  area: Area;
  subsecoes: Subsecao[];
  pessoas: OrgPessoa[];
  podeEditar: boolean;
  onEditar: (p: OrgPessoa) => void;
  onAdicionar: (subsecao_id: string | null) => void;
  pessoaArrastando: string | null;
  setPessoaArrastando: (id: string | null) => void;
  dropzoneAtiva: string | null;
  setDropzoneAtiva: (v: string | null) => void;
  moverPessoa: (pessoaId: string, novaAreaId: string, novaSubsecaoId: string | null) => Promise<void>;
}) {
  const pessoasTopo = pessoas.filter((p) => !p.subsecao_id);
  const linhas: Record<number, OrgPessoa[]> = {};
  pessoasTopo.forEach((p) => {
    if (!linhas[p.linha]) linhas[p.linha] = [];
    linhas[p.linha].push(p);
  });
  Object.keys(linhas).forEach((k) => linhas[Number(k)].sort((a, b) => a.coluna - b.coluna || a.ordem - b.ordem));
  const linhasOrdenadas = Object.keys(linhas).map((k) => Number(k)).sort((a, b) => a - b);

  const dropId = area.id;
  const isDropzoneAtiva = dropzoneAtiva === dropId;
  const podeReceber = !!pessoaArrastando;

  return (
    <div
      onDragOver={(e) => {
        if (podeReceber) {
          e.preventDefault();
          setDropzoneAtiva(dropId);
        }
      }}
      onDragLeave={(e) => {
        // só limpa se saiu do próprio elemento (não filho)
        if (e.currentTarget === e.target) setDropzoneAtiva(null);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        if (pessoaArrastando) {
          await moverPessoa(pessoaArrastando, area.id, null);
          setDropzoneAtiva(null);
        }
      }}
      className={`rounded-2xl border-2 bg-white/[0.02] p-6 transition ${
        isDropzoneAtiva ? "border-emerald-400 shadow-lg shadow-emerald-500/20 scale-[1.01]" : "border-red-500/60"
      }`}
    >
      <h2 className="mb-6 text-center text-sm font-bold uppercase tracking-widest text-white">{area.nome}</h2>
      <div className="space-y-6">
        {linhasOrdenadas.map((linha) => (
          <div key={linha} className="flex flex-wrap justify-center gap-6">
            {linhas[linha].map((p) => (
              <PessoaAvatar
                key={p.id}
                pessoa={p}
                podeEditar={podeEditar}
                onClick={() => onEditar(p)}
                pessoaArrastando={pessoaArrastando}
                setPessoaArrastando={setPessoaArrastando}
              />
            ))}
          </div>
        ))}
        {podeEditar && (
          <div className="flex justify-center">
            <button onClick={() => onAdicionar(null)} className="text-xs text-brand-muted hover:text-brand">+ adicionar pessoa</button>
          </div>
        )}
      </div>

      {/* Subseções (também aceitam drop) */}
      {subsecoes.map((sub) => {
        const dropSubId = `${area.id}:${sub.id}`;
        const isSubDropzone = dropzoneAtiva === dropSubId;
        const pSub = pessoas.filter((p) => p.subsecao_id === sub.id);
        const linhasSub: Record<number, OrgPessoa[]> = {};
        pSub.forEach((p) => {
          if (!linhasSub[p.linha]) linhasSub[p.linha] = [];
          linhasSub[p.linha].push(p);
        });
        Object.keys(linhasSub).forEach((k) => linhasSub[Number(k)].sort((a, b) => a.coluna - b.coluna || a.ordem - b.ordem));
        const linhasSubOrd = Object.keys(linhasSub).map((k) => Number(k)).sort((a, b) => a - b);

        return (
          <div
            key={sub.id}
            onDragOver={(e) => {
              if (podeReceber) {
                e.preventDefault();
                e.stopPropagation();
                setDropzoneAtiva(dropSubId);
              }
            }}
            onDrop={async (e) => {
              e.preventDefault();
              e.stopPropagation();
              if (pessoaArrastando) {
                await moverPessoa(pessoaArrastando, area.id, sub.id);
                setDropzoneAtiva(null);
              }
            }}
            className={`mt-8 border-t pt-4 rounded-lg transition ${
              isSubDropzone ? "border-emerald-400 bg-emerald-500/10" : "border-white/10"
            }`}
          >
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-brand-muted">{sub.nome}</p>
            <div className="space-y-6">
              {linhasSubOrd.map((linha) => (
                <div key={linha} className="flex flex-wrap justify-center gap-6">
                  {linhasSub[linha].map((p) => (
                    <PessoaAvatar
                      key={p.id}
                      pessoa={p}
                      podeEditar={podeEditar}
                      onClick={() => onEditar(p)}
                      pessoaArrastando={pessoaArrastando}
                      setPessoaArrastando={setPessoaArrastando}
                    />
                  ))}
                </div>
              ))}
              {podeEditar && (
                <div className="flex justify-center">
                  <button onClick={() => onAdicionar(sub.id)} className="text-xs text-brand-muted hover:text-brand">
                    + adicionar em {sub.nome}
                  </button>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ============================================================
// AVATAR (draggable)
// ============================================================
function PessoaAvatar({
  pessoa, podeEditar, onClick, pessoaArrastando, setPessoaArrastando,
}: {
  pessoa: OrgPessoa;
  podeEditar: boolean;
  onClick: () => void;
  pessoaArrastando: string | null;
  setPessoaArrastando: (id: string | null) => void;
}) {
  const iniciais = pessoa.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const size = pessoa.destaque ? "h-24 w-24" : "h-16 w-16";
  const textSize = pessoa.destaque ? "text-2xl" : "text-lg";
  const arrastando = pessoaArrastando === pessoa.id;

  return (
    <div
      draggable={podeEditar}
      onDragStart={(e) => {
        setPessoaArrastando(pessoa.id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragEnd={() => setPessoaArrastando(null)}
      onClick={podeEditar ? onClick : undefined}
      className={`flex flex-col items-center gap-2 transition ${
        podeEditar ? "cursor-grab active:cursor-grabbing hover:opacity-80" : "cursor-default"
      } ${arrastando ? "opacity-40 scale-95" : ""}`}
      title={podeEditar ? "Arraste pra mover · Clica pra editar" : ""}
    >
      <div className={`${size} rounded-full overflow-hidden bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center border-2 border-red-500/40`}>
        {pessoa.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pessoa.foto_url} alt={pessoa.nome} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className={`font-black text-white ${textSize}`}>{iniciais}</span>
        )}
      </div>
      <div className="text-center">
        <p className={`font-bold text-white uppercase ${pessoa.destaque ? "text-sm" : "text-xs"}`}>{pessoa.nome}</p>
        {pessoa.cargo && <p className="mt-0.5 text-[10px] text-red-300 whitespace-pre-line max-w-[140px]">{pessoa.cargo}</p>}
      </div>
    </div>
  );
}

// ============================================================
// CARTEIRA CARD (igual V3)
// ============================================================
function CarteiraCard({ pessoa, clientes, podeEditar, onChanged }: {
  pessoa: OrgPessoa; clientes: Carteira[]; podeEditar: boolean; onChanged: () => void;
}) {
  const supabase = createClient();
  const [adicionando, setAdicionando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const iniciais = pessoa.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  async function adicionar() {
    const nome = novoNome.trim();
    if (!nome) return;
    await supabase.from("ruston_org_carteiras").insert({
      pessoa_id: pessoa.id, cliente_nome: nome, ordem: clientes.length,
    });
    setNovoNome(""); setAdicionando(false); onChanged();
  }

  return (
    <div className="rounded-2xl border-2 border-red-500/40 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-col items-center gap-2">
        <div className="h-14 w-14 rounded-full overflow-hidden bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center border-2 border-red-500/40">
          {pessoa.foto_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pessoa.foto_url} alt={pessoa.nome} className="h-full w-full object-cover" />
          ) : (
            <span className="font-black text-white">{iniciais}</span>
          )}
        </div>
        <p className="text-sm font-bold uppercase tracking-wide text-white">
          {pessoa.nome} <span className="text-red-300">| {clientes.length}</span>
        </p>
      </div>
      <div className="mb-3 border-t border-red-500/30" />
      <div className="space-y-2">
        {clientes.map((c) => <ClienteRow key={c.id} carteira={c} podeEditar={podeEditar} onChanged={onChanged} />)}
        {clientes.length === 0 && !adicionando && (
          <p className="text-center text-[11px] text-brand-muted italic py-4">Sem clientes</p>
        )}
      </div>
      {podeEditar && !adicionando && (
        <button onClick={() => setAdicionando(true)} className="mt-3 w-full rounded-lg border border-dashed border-white/20 py-2 text-xs text-brand-muted hover:border-brand hover:text-brand">
          + Adicionar cliente
        </button>
      )}
      {adicionando && (
        <div className="mt-3 space-y-2">
          <input
            className="input text-xs"
            placeholder="Nome do cliente"
            value={novoNome}
            onChange={(e) => setNovoNome(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") adicionar();
              if (e.key === "Escape") { setAdicionando(false); setNovoNome(""); }
            }}
            autoFocus
          />
          <div className="flex gap-2">
            <button className="btn text-xs flex-1" onClick={adicionar}>Adicionar</button>
            <button className="btn-ghost text-xs" onClick={() => { setAdicionando(false); setNovoNome(""); }}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function ClienteRow({ carteira, podeEditar, onChanged }: {
  carteira: Carteira; podeEditar: boolean; onChanged: () => void;
}) {
  const supabase = createClient();
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(carteira.cliente_nome);
  const [tags, setTags] = useState<string[]>(carteira.tags ?? []);
  const [novaTag, setNovaTag] = useState("");

  async function salvar() {
    await supabase.from("ruston_org_carteiras").update({ cliente_nome: nome.trim(), tags }).eq("id", carteira.id);
    setEditando(false); onChanged();
  }
  async function remover() {
    if (!confirm(`Remover ${carteira.cliente_nome}?`)) return;
    await supabase.from("ruston_org_carteiras").delete().eq("id", carteira.id);
    onChanged();
  }
  function adicionarTag() {
    const t = novaTag.trim().toUpperCase();
    if (!t || tags.includes(t)) return;
    setTags([...tags, t]); setNovaTag("");
  }
  function removerTag(t: string) { setTags(tags.filter((x) => x !== t)); }

  if (!editando) {
    return (
      <div className="group rounded-lg border border-white/10 bg-white/[0.03] p-2 hover:border-red-500/40 transition">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold uppercase text-white truncate">{carteira.cliente_nome}</p>
            {carteira.tags && carteira.tags.length > 0 && (
              <div className="mt-1 flex flex-wrap gap-1">
                {carteira.tags.map((t) => (
                  <span key={t} className="rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[8px] font-bold text-red-300">{t}</span>
                ))}
              </div>
            )}
          </div>
          {podeEditar && (
            <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition">
              <button onClick={() => setEditando(true)} className="text-[10px] text-brand hover:text-brand/80">✏️</button>
              <button onClick={remover} className="text-[10px] text-red-300 hover:text-red-400">✕</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-brand/40 bg-brand/5 p-2 space-y-2">
      <input className="input py-1 text-xs" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome do cliente" autoFocus />
      <div>
        <label className="text-[9px] text-brand-muted uppercase">Tags</label>
        <div className="flex flex-wrap gap-1 mb-1">
          {tags.map((t) => (
            <span key={t} className="inline-flex items-center gap-1 rounded border border-red-500/40 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-bold text-red-300">
              {t}
              <button onClick={() => removerTag(t)} className="text-red-400 hover:text-red-200">×</button>
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          <input
            className="input py-1 text-[10px] flex-1"
            placeholder="Nova tag (ex: PONTUAL)"
            value={novaTag}
            onChange={(e) => setNovaTag(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionarTag(); } }}
          />
          <button onClick={adicionarTag} className="btn-ghost text-[10px]">+ tag</button>
        </div>
      </div>
      <div className="flex gap-1">
        <button className="btn text-xs flex-1 py-1" onClick={salvar}>Salvar</button>
        <button className="btn-ghost text-xs py-1" onClick={() => {
          setEditando(false); setNome(carteira.cliente_nome); setTags(carteira.tags ?? []);
        }}>Cancelar</button>
      </div>
    </div>
  );
}

// ============================================================
// MODAL DE EDIÇÃO / CRIAÇÃO
// ============================================================
function ModalPessoa({ pessoa, areas, subsecoes, onFechar, onSalvo }: {
  pessoa: OrgPessoa; areas: Area[]; subsecoes: Subsecao[]; onFechar: () => void; onSalvo: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    nome: pessoa.nome, cargo: pessoa.cargo ?? "",
    area_id: pessoa.area_id, subsecao_id: pessoa.subsecao_id ?? "",
    linha: pessoa.linha, coluna: pessoa.coluna, destaque: pessoa.destaque,
    tem_carteira: pessoa.tem_carteira, foto_url: pessoa.foto_url,
  });
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const subsecoesDaArea = subsecoes.filter((s) => s.area_id === form.area_id);

  async function fazerUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `org_${Date.now()}.${ext}`;
    const { error } = await supabase.storage.from("fotos-pessoas").upload(path, file, { upsert: true, contentType: file.type });
    if (error) { alert("Erro: " + error.message); setUploading(false); return; }
    const { data } = supabase.storage.from("fotos-pessoas").getPublicUrl(path);
    setForm({ ...form, foto_url: data.publicUrl + `?t=${Date.now()}` });
    setUploading(false);
  }

  async function salvar() {
    if (!form.nome.trim()) { alert("Nome obrigatório"); return; }
    setSaving(true);
    const payload = {
      nome: form.nome.trim(), cargo: form.cargo || null,
      area_id: form.area_id, subsecao_id: form.subsecao_id || null,
      linha: form.linha, coluna: form.coluna, destaque: form.destaque,
      tem_carteira: form.tem_carteira, foto_url: form.foto_url,
    };
    if (pessoa.id) {
      await supabase.from("ruston_org_pessoas").update(payload).eq("id", pessoa.id);
    } else {
      await supabase.from("ruston_org_pessoas").insert(payload);
    }
    setSaving(false); onSalvo();
  }

  async function remover() {
    if (!pessoa.id) return;
    if (!confirm(`Remover ${pessoa.nome}?`)) return;
    await supabase.from("ruston_org_pessoas").delete().eq("id", pessoa.id);
    onSalvo();
  }

  const iniciais = form.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="w-full max-w-md rounded-lg border border-white/10 bg-brand-panel p-5 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-semibold">{pessoa.id ? "Editar pessoa" : "Nova pessoa"}</h3>
          <button onClick={onFechar} className="text-brand-muted hover:text-white">✕</button>
        </div>

        <div className="mb-4 flex justify-center">
          <div className="h-24 w-24 rounded-full overflow-hidden bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center border-2 border-red-500/40">
            {form.foto_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={form.foto_url} alt="preview" className="h-full w-full object-cover" />
            ) : (
              <span className="text-2xl font-black text-white">{iniciais || "?"}</span>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className="btn-ghost w-full cursor-pointer text-center text-xs block">
            {uploading ? "Enviando..." : "📸 Trocar foto"}
            <input type="file" accept="image/*" className="hidden" onChange={fazerUpload} disabled={uploading} />
          </label>
        </div>

        <div className="mb-3">
          <label className="label">Nome *</label>
          <input className="input" value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} />
        </div>

        <div className="mb-3">
          <label className="label">Cargo</label>
          <input className="input" value={form.cargo} onChange={(e) => setForm({ ...form, cargo: e.target.value })} placeholder="Ex: Gestora de Projetos" />
        </div>

        <div className="mb-3">
          <label className="label">Área</label>
          <select className="input" value={form.area_id} onChange={(e) => setForm({ ...form, area_id: e.target.value, subsecao_id: "" })}>
            {areas.map((a) => (<option key={a.id} value={a.id}>{a.nome} ({a.tipo})</option>))}
          </select>
        </div>

        {subsecoesDaArea.length > 0 && (
          <div className="mb-3">
            <label className="label">Subseção (opcional)</label>
            <select className="input" value={form.subsecao_id} onChange={(e) => setForm({ ...form, subsecao_id: e.target.value })}>
              <option value="">— sem subseção —</option>
              {subsecoesDaArea.map((s) => (<option key={s.id} value={s.id}>{s.nome}</option>))}
            </select>
          </div>
        )}

        <div className="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label className="label">Linha</label>
            <input type="number" className="input" value={form.linha} onChange={(e) => setForm({ ...form, linha: Number(e.target.value) })} />
          </div>
          <div>
            <label className="label">Coluna</label>
            <input type="number" className="input" value={form.coluna} onChange={(e) => setForm({ ...form, coluna: Number(e.target.value) })} />
          </div>
        </div>

        <div className="mb-2 flex items-center gap-2">
          <input type="checkbox" id="destaque" checked={form.destaque} onChange={(e) => setForm({ ...form, destaque: e.target.checked })} />
          <label htmlFor="destaque" className="text-sm">Foto grande (Gerente)</label>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <input type="checkbox" id="carteira" checked={form.tem_carteira} onChange={(e) => setForm({ ...form, tem_carteira: e.target.checked })} />
          <label htmlFor="carteira" className="text-sm">📋 Tem carteira de clientes</label>
        </div>

        <div className="flex justify-between gap-2">
          {pessoa.id && <button className="text-xs text-red-300 hover:text-red-400" onClick={remover}>Remover</button>}
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
            <button className="btn" onClick={salvar} disabled={saving}>{saving ? "..." : "Salvar"}</button>
          </div>
        </div>
      </div>
    </div>
  );
}
