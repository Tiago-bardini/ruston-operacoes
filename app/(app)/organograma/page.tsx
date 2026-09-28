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
  ruston_pessoa_id: string | null;
};
type Carteira = { id: string; pessoa_id: string; cliente_nome: string; tags: string[]; ordem: number; ativo: boolean };
type PessoaCadastro = { id: string; nome: string; ativo: boolean };
type ClienteAuto = {
  id: string; nome: string; account_id: string | null;
  mrr: number | null;
  churn_realizado: boolean; subiu_no_sistema: boolean;
  data_vencimento_contrato: string | null;
  ativo: boolean;
};
type FcaStatus = {
  cliente_id: string;
  bandeira: "verde" | "amarelo" | "vermelho" | "sem_dado";
  nota_final: number | null;
  data_referencia: string;
};

// ============================================================
// Helper — formata MRR compacto (R$ 12.4k / R$ 1.2M)
// ============================================================
function formatMrrCompact(v: number): string {
  if (v >= 1_000_000) return `R$ ${(v / 1_000_000).toFixed(1).replace(".", ",")}M`;
  if (v >= 1_000) return `R$ ${Math.round(v / 100) / 10}k`;
  return `R$ ${Math.round(v)}`;
}

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
  const [pessoasCadastro, setPessoasCadastro] = useState<PessoaCadastro[]>([]);
  const [clientesAuto, setClientesAuto] = useState<ClienteAuto[]>([]);
  const [fcaStatus, setFcaStatus] = useState<Map<string, FcaStatus>>(new Map());
  const [loading, setLoading] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState<string>("todos");
  const [editando, setEditando] = useState<OrgPessoa | null>(null);
  const [novaPessoa, setNovaPessoa] = useState<{ area_id: string; subsecao_id: string | null } | null>(null);
  const [arrastando, setArrastando] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: a }, { data: s }, { data: p }, { data: c }, { data: pc }, { data: cli }] = await Promise.all([
      supabase.from("ruston_org_areas").select("*").eq("ativo", true).order("ordem"),
      supabase.from("ruston_org_subsecoes").select("*").eq("ativo", true).order("ordem"),
      supabase.from("ruston_org_pessoas").select("*").eq("ativo", true).order("linha").order("coluna"),
      supabase.from("ruston_org_carteiras").select("*").eq("ativo", true).order("ordem"),
      supabase.from("ruston_pessoas").select("id,nome,ativo").eq("ativo", true).order("nome"),
      supabase.from("ruston_clientes")
        .select("id,nome,account_id,mrr,churn_realizado,subiu_no_sistema,data_vencimento_contrato,ativo")
        .eq("ativo", true),
    ]);
    setAreas((a as Area[]) ?? []);
    setSubsecoes((s as Subsecao[]) ?? []);
    setPessoas((p as OrgPessoa[]) ?? []);
    setCarteiras((c as Carteira[]) ?? []);
    setPessoasCadastro((pc as PessoaCadastro[]) ?? []);
    setClientesAuto(
      ((cli as ClienteAuto[]) ?? []).filter(
        (x) => !(x.churn_realizado === true && x.subiu_no_sistema === true)
      )
    );
    const { data: fcas } = await supabase
      .from("ruston_fca_view")
      .select("cliente_id,bandeira,nota_final,data_referencia")
      .order("data_referencia", { ascending: false });
    const map = new Map<string, FcaStatus>();
    ((fcas as FcaStatus[]) ?? []).forEach((f) => {
      if (!map.has(f.cliente_id)) map.set(f.cliente_id, f);
    });
    setFcaStatus(map);
    setLoading(false);
  }

  useEffect(() => { if (!loadingPerfil) load(); /* eslint-disable-next-line */ }, [loadingPerfil]);

  // ============================================================
  // MRR POR PESSOA — soma dos MRRs de clientes ativos daquela pessoa
  // chave = ruston_pessoa_id (pessoa do cadastro)
  // ============================================================
  const mrrPorPessoa = useMemo(() => {
    const map = new Map<string, number>();
    clientesAuto.forEach((c) => {
      if (!c.account_id || !c.mrr) return;
      map.set(c.account_id, (map.get(c.account_id) ?? 0) + c.mrr);
    });
    return map;
  }, [clientesAuto]);

  async function moverPessoa(
    pessoaId: string,
    destino: { area_id: string; subsecao_id: string | null; linha: number; colunaAlvo: number }
  ) {
    const pessoa = pessoas.find((p) => p.id === pessoaId);
    if (!pessoa) return;

    const mesmaLinha =
      pessoa.area_id === destino.area_id &&
      (pessoa.subsecao_id ?? null) === (destino.subsecao_id ?? null) &&
      pessoa.linha === destino.linha;

    const linhaDestino = pessoas
      .filter((p) =>
        p.area_id === destino.area_id &&
        (p.subsecao_id ?? null) === (destino.subsecao_id ?? null) &&
        p.linha === destino.linha &&
        p.id !== pessoaId
      )
      .sort((a, b) => a.coluna - b.coluna);

    const idx = Math.max(0, Math.min(destino.colunaAlvo, linhaDestino.length));
    const novaLinhaOrdem = [
      ...linhaDestino.slice(0, idx),
      { ...pessoa, area_id: destino.area_id, subsecao_id: destino.subsecao_id, linha: destino.linha },
      ...linhaDestino.slice(idx),
    ];

    const atualizacoesDestino = novaLinhaOrdem.map((p, i) => ({ id: p.id, coluna: i }));

    let atualizacoesOrigem: { id: string; coluna: number }[] = [];
    if (!mesmaLinha) {
      const linhaOrigem = pessoas
        .filter((p) =>
          p.area_id === pessoa.area_id &&
          (p.subsecao_id ?? null) === (pessoa.subsecao_id ?? null) &&
          p.linha === pessoa.linha &&
          p.id !== pessoaId
        )
        .sort((a, b) => a.coluna - b.coluna);
      atualizacoesOrigem = linhaOrigem.map((p, i) => ({ id: p.id, coluna: i }));
    }

    setPessoas((prev) =>
      prev.map((p) => {
        if (p.id === pessoaId) {
          const found = atualizacoesDestino.find((x) => x.id === pessoaId)!;
          return { ...p, area_id: destino.area_id, subsecao_id: destino.subsecao_id, linha: destino.linha, coluna: found.coluna };
        }
        const upd = [...atualizacoesDestino, ...atualizacoesOrigem].find((x) => x.id === p.id);
        if (upd) return { ...p, coluna: upd.coluna };
        return p;
      })
    );

    const colunaArrastada = atualizacoesDestino.find((x) => x.id === pessoaId)!.coluna;
    await supabase.from("ruston_org_pessoas")
      .update({
        area_id: destino.area_id,
        subsecao_id: destino.subsecao_id,
        linha: destino.linha,
        coluna: colunaArrastada,
      })
      .eq("id", pessoaId);

    for (const x of atualizacoesDestino) {
      if (x.id === pessoaId) continue;
      await supabase.from("ruston_org_pessoas").update({ coluna: x.coluna }).eq("id", x.id);
    }
    for (const x of atualizacoesOrigem) {
      await supabase.from("ruston_org_pessoas").update({ coluna: x.coluna }).eq("id", x.id);
    }
    load();
  }

  async function moverPessoaNovaLinha(
    pessoaId: string,
    destino: { area_id: string; subsecao_id: string | null; insertLinha: number }
  ) {
    const pessoa = pessoas.find((p) => p.id === pessoaId);
    if (!pessoa) return;

    const paraEmpurrar = pessoas.filter((p) =>
      p.area_id === destino.area_id &&
      (p.subsecao_id ?? null) === (destino.subsecao_id ?? null) &&
      p.linha >= destino.insertLinha &&
      p.id !== pessoaId
    );

    const mesmaLinha =
      pessoa.area_id === destino.area_id &&
      (pessoa.subsecao_id ?? null) === (destino.subsecao_id ?? null) &&
      pessoa.linha === destino.insertLinha;

    let atualizacoesOrigem: { id: string; coluna: number }[] = [];
    if (!mesmaLinha) {
      const linhaOrigem = pessoas
        .filter((p) =>
          p.area_id === pessoa.area_id &&
          (p.subsecao_id ?? null) === (pessoa.subsecao_id ?? null) &&
          p.linha === pessoa.linha &&
          p.id !== pessoaId
        )
        .sort((a, b) => a.coluna - b.coluna);
      atualizacoesOrigem = linhaOrigem.map((p, i) => ({ id: p.id, coluna: i }));
    }

    setPessoas((prev) =>
      prev.map((p) => {
        if (p.id === pessoaId) {
          return { ...p, area_id: destino.area_id, subsecao_id: destino.subsecao_id, linha: destino.insertLinha, coluna: 0 };
        }
        if (paraEmpurrar.find((x) => x.id === p.id)) {
          return { ...p, linha: p.linha + 1 };
        }
        const upd = atualizacoesOrigem.find((x) => x.id === p.id);
        if (upd) return { ...p, coluna: upd.coluna };
        return p;
      })
    );

    await supabase.from("ruston_org_pessoas")
      .update({
        area_id: destino.area_id,
        subsecao_id: destino.subsecao_id,
        linha: destino.insertLinha,
        coluna: 0,
      })
      .eq("id", pessoaId);
    for (const p of paraEmpurrar) {
      await supabase.from("ruston_org_pessoas").update({ linha: p.linha + 1 }).eq("id", p.id);
    }
    for (const x of atualizacoesOrigem) {
      await supabase.from("ruston_org_pessoas").update({ coluna: x.coluna }).eq("id", x.id);
    }
    load();
  }

  const areasFixas = useMemo(() => areas.filter((a) => a.tipo === "fixa"), [areas]);
  const squads = useMemo(() => areas.filter((a) => a.tipo === "squad"), [areas]);

  const contagens = useMemo(() => {
    const map: Record<string, number> = { todos: 0 };
    areas.forEach((a) => (map.todos += pessoas.filter((p) => p.area_id === a.id).length));
    squads.forEach((a) => (map[a.id] = pessoas.filter((p) => p.area_id === a.id).length));
    return map;
  }, [pessoas, areas, squads]);

  if (loadingPerfil || loading) {
    return <p className="text-brand-muted">Carregando organograma...</p>;
  }

  const commonProps = {
    podeEditar,
    onEditar: setEditando,
    onAdicionar: (area_id: string, subsecao_id: string | null) => setNovaPessoa({ area_id, subsecao_id }),
    arrastando,
    setArrastando,
    moverPessoa,
    moverPessoaNovaLinha,
    subsecoes,
    mrrPorPessoa,
  };

  return (
    <div onDragEnd={() => setArrastando(null)}>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">👥 Organograma</h1>
          <p className="text-sm text-brand-muted">
            <strong>Arrasta em cima de uma linha existente</strong> pra encaixar entre as pessoas · <strong>Solta no espaço entre linhas</strong> pra criar nova linha
          </p>
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-2 border-b border-white/5 pb-4">
        <TabButton label="Todos" count={contagens.todos} ativo={abaAtiva === "todos"} onClick={() => setAbaAtiva("todos")} />
        {squads.map((s) => (
          <TabButton
            key={s.id}
            label={s.nome}
            count={contagens[s.id] ?? 0}
            ativo={abaAtiva === s.id}
            onClick={() => setAbaAtiva(s.id)}
          />
        ))}
        {podeEditar && (
          <button
            onClick={async () => {
              const nome = prompt("Nome do novo squad:");
              if (!nome) return;
              await supabase.from("ruston_org_areas").insert({ nome: nome.toUpperCase(), tipo: "squad", ordem: (squads.length + 1) * 10 });
              load();
            }}
            className="rounded-lg border border-dashed border-white/20 px-3 py-1.5 text-xs text-brand-muted hover:border-brand hover:text-brand"
          >
            + squad
          </button>
        )}
      </div>

      {abaAtiva === "todos" ? (
        <>
          <div className="mb-8 grid gap-4 grid-cols-1 lg:grid-cols-3">
            {areasFixas.map((area) => (
              <AreaCard key={area.id} area={area} pessoas={pessoas.filter((p) => p.area_id === area.id)} carteiras={[]} mostrarCarteira={false} onChangedCarteira={load} {...commonProps} />
            ))}
          </div>
          {squads.length > 0 && (
            <>
              <h2 className="mb-4 text-sm font-semibold uppercase tracking-widest text-brand-muted">Squads</h2>
              <div className="grid gap-4 grid-cols-1 lg:grid-cols-2 xl:grid-cols-3">
                {squads.map((squad) => (
                  <AreaCard key={squad.id} area={squad} pessoas={pessoas.filter((p) => p.area_id === squad.id)} carteiras={[]} mostrarCarteira={false} onChangedCarteira={load} {...commonProps} />
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        areas.filter((a) => a.id === abaAtiva).map((squad) => (
          <div key={squad.id} className="max-w-5xl mx-auto">
            <AreaCard area={squad} pessoas={pessoas.filter((p) => p.area_id === squad.id)} carteiras={carteiras} clientesAuto={clientesAuto} fcaStatus={fcaStatus} mostrarCarteira={true} onChangedCarteira={load} {...commonProps} />
          </div>
        ))
      )}

      {editando && (
        <ModalPessoa pessoa={editando} areas={areas} subsecoes={subsecoes} pessoasCadastro={pessoasCadastro} onFechar={() => setEditando(null)} onSalvo={() => { setEditando(null); load(); }} />
      )}
      {novaPessoa && (
        <ModalPessoa
          pessoa={{
            id: "", area_id: novaPessoa.area_id, subsecao_id: novaPessoa.subsecao_id,
            nome: "", cargo: "", foto_url: null, destaque: false,
            linha: 0, coluna: 0, ordem: 0,
            ativo: true, tem_carteira: false,
            ruston_pessoa_id: null,
          }}
          areas={areas} subsecoes={subsecoes} pessoasCadastro={pessoasCadastro}
          onFechar={() => setNovaPessoa(null)}
          onSalvo={() => { setNovaPessoa(null); load(); }}
        />
      )}
    </div>
  );
}

function TabButton({ label, count, ativo, onClick }: { label: string; count: number; ativo: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
        ativo ? "bg-brand text-white" : "bg-white/5 text-brand-muted hover:bg-white/10 hover:text-white"
      }`}
    >
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold ${ativo ? "bg-white/20 text-white" : "bg-brand text-white"}`}>{count}</span>
    </button>
  );
}

type CommonProps = {
  podeEditar: boolean;
  onEditar: (p: OrgPessoa) => void;
  onAdicionar: (area_id: string, subsecao_id: string | null) => void;
  arrastando: string | null;
  setArrastando: (id: string | null) => void;
  moverPessoa: (pessoaId: string, destino: { area_id: string; subsecao_id: string | null; linha: number; colunaAlvo: number }) => Promise<void>;
  moverPessoaNovaLinha: (pessoaId: string, destino: { area_id: string; subsecao_id: string | null; insertLinha: number }) => Promise<void>;
  subsecoes: Subsecao[];
  mrrPorPessoa: Map<string, number>;
};

function AreaCard({
  area, pessoas, carteiras, clientesAuto, fcaStatus, mostrarCarteira, onChangedCarteira, ...common
}: {
  area: Area;
  pessoas: OrgPessoa[];
  carteiras: Carteira[];
  clientesAuto?: ClienteAuto[];
  fcaStatus?: Map<string, FcaStatus>;
  mostrarCarteira: boolean;
  onChangedCarteira: () => void;
} & CommonProps) {
  const subsecoesArea = common.subsecoes.filter((s) => s.area_id === area.id);
  const pessoasTopo = pessoas.filter((p) => !p.subsecao_id);
  const pessoasCarteira = mostrarCarteira ? pessoas.filter((p) => p.tem_carteira) : [];

  // MRR total do squad = soma do MRR de todas pessoas vinculadas desse card
  const mrrTotalArea = useMemo(() => {
    let total = 0;
    pessoas.forEach((p) => {
      if (p.ruston_pessoa_id) total += common.mrrPorPessoa.get(p.ruston_pessoa_id) ?? 0;
    });
    return total;
  }, [pessoas, common.mrrPorPessoa]);

  return (
    <div className="rounded-2xl border-2 border-red-500/60 bg-white/[0.02] p-6">
      <h2 className="mb-1 text-center text-sm font-bold uppercase tracking-widest text-white">{area.nome}</h2>
      {mrrTotalArea > 0 && (
        <p className="mb-5 text-center text-[11px] text-emerald-300 font-bold">
          MRR total · {formatMrrCompact(mrrTotalArea)}
        </p>
      )}
      {mrrTotalArea === 0 && <div className="mb-5" />}

      <LinhasContainer
        pessoas={pessoasTopo}
        areaId={area.id}
        subsecaoId={null}
        {...common}
      />

      {common.podeEditar && (
        <div className="mt-4 flex justify-center">
          <button onClick={() => common.onAdicionar(area.id, null)} className="text-xs text-brand-muted hover:text-brand">+ adicionar pessoa</button>
        </div>
      )}

      {subsecoesArea.map((sub) => {
        const pSub = pessoas.filter((p) => p.subsecao_id === sub.id);
        return (
          <div key={sub.id} className="mt-8 border-t border-white/10 pt-4">
            <p className="mb-4 text-[10px] font-semibold uppercase tracking-widest text-brand-muted">{sub.nome}</p>
            <LinhasContainer
              pessoas={pSub}
              areaId={area.id}
              subsecaoId={sub.id}
              {...common}
            />
            {common.podeEditar && (
              <div className="mt-4 flex justify-center">
                <button onClick={() => common.onAdicionar(area.id, sub.id)} className="text-xs text-brand-muted hover:text-brand">
                  + adicionar em {sub.nome}
                </button>
              </div>
            )}
          </div>
        );
      })}

      {mostrarCarteira && pessoasCarteira.length > 0 && (
        <div className="mt-8 border-t border-red-500/20 pt-6">
          <h3 className="mb-4 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest text-brand-muted">📋 Carteira de Clientes</h3>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-2">
            {pessoasCarteira.map((p) => (
              <CarteiraCard
                key={p.id}
                pessoa={p}
                clientes={carteiras.filter((c) => c.pessoa_id === p.id)}
                clientesAuto={(clientesAuto ?? []).filter((c) => p.ruston_pessoa_id && c.account_id === p.ruston_pessoa_id)}
                fcaStatus={fcaStatus}
                podeEditar={common.podeEditar}
                onChanged={onChangedCarteira}
              />
            ))}
          </div>
        </div>
      )}

      {mostrarCarteira && pessoasCarteira.length === 0 && (
        <div className="mt-8 border-t border-red-500/20 pt-6">
          <h3 className="mb-3 flex items-center justify-center gap-2 text-xs font-semibold uppercase tracking-widest text-brand-muted">📋 Carteira de Clientes</h3>
          <p className="text-center text-[11px] text-brand-muted">
            Nenhuma pessoa com carteira. Clica em alguém e marca <strong>"Tem carteira"</strong>.
          </p>
        </div>
      )}
    </div>
  );
}

function LinhasContainer({
  pessoas, areaId, subsecaoId,
  podeEditar, onEditar, arrastando, setArrastando,
  moverPessoa, moverPessoaNovaLinha, mrrPorPessoa,
}: {
  pessoas: OrgPessoa[];
  areaId: string;
  subsecaoId: string | null;
  podeEditar: boolean;
  onEditar: (p: OrgPessoa) => void;
  arrastando: string | null;
  setArrastando: (id: string | null) => void;
  moverPessoa: (pessoaId: string, destino: { area_id: string; subsecao_id: string | null; linha: number; colunaAlvo: number }) => Promise<void>;
  moverPessoaNovaLinha: (pessoaId: string, destino: { area_id: string; subsecao_id: string | null; insertLinha: number }) => Promise<void>;
  mrrPorPessoa: Map<string, number>;
}) {
  const linhas: Record<number, OrgPessoa[]> = {};
  pessoas.forEach((p) => {
    if (!linhas[p.linha]) linhas[p.linha] = [];
    linhas[p.linha].push(p);
  });
  Object.keys(linhas).forEach((k) => linhas[Number(k)].sort((a, b) => a.coluna - b.coluna));
  const linhaKeys = Object.keys(linhas).map((k) => Number(k)).sort((a, b) => a - b);

  const podeReceber = !!arrastando;

  return (
    <div>
      <RowGap
        insertLinha={linhaKeys[0] ?? 0}
        areaId={areaId} subsecaoId={subsecaoId}
        arrastando={arrastando}
        moverPessoaNovaLinha={moverPessoaNovaLinha}
        setArrastando={setArrastando}
      />

      {linhaKeys.map((linhaNum) => (
        <div key={linhaNum}>
          <Row
            pessoas={linhas[linhaNum]}
            linha={linhaNum}
            areaId={areaId} subsecaoId={subsecaoId}
            podeEditar={podeEditar}
            onEditar={onEditar}
            arrastando={arrastando}
            setArrastando={setArrastando}
            moverPessoa={moverPessoa}
            mrrPorPessoa={mrrPorPessoa}
          />
          <RowGap
            insertLinha={linhaNum + 1}
            areaId={areaId} subsecaoId={subsecaoId}
            arrastando={arrastando}
            moverPessoaNovaLinha={moverPessoaNovaLinha}
            setArrastando={setArrastando}
          />
        </div>
      ))}

      {linhaKeys.length === 0 && podeReceber && (
        <div
          onDragOver={(e) => { e.preventDefault(); }}
          onDrop={async (e) => {
            e.preventDefault();
            if (arrastando) {
              await moverPessoaNovaLinha(arrastando, { area_id: areaId, subsecao_id: subsecaoId, insertLinha: 0 });
              setArrastando(null);
            }
          }}
          className="min-h-[80px] rounded-lg border-2 border-dashed border-emerald-400/60 bg-emerald-500/10 flex items-center justify-center text-xs text-emerald-200 italic"
        >
          solta aqui pra criar a primeira linha
        </div>
      )}
    </div>
  );
}

function Row({
  pessoas, linha, areaId, subsecaoId,
  podeEditar, onEditar,
  arrastando, setArrastando, moverPessoa,
  mrrPorPessoa,
}: {
  pessoas: OrgPessoa[];
  linha: number;
  areaId: string;
  subsecaoId: string | null;
  podeEditar: boolean;
  onEditar: (p: OrgPessoa) => void;
  arrastando: string | null;
  setArrastando: (id: string | null) => void;
  moverPessoa: (pessoaId: string, destino: { area_id: string; subsecao_id: string | null; linha: number; colunaAlvo: number }) => Promise<void>;
  mrrPorPessoa: Map<string, number>;
}) {
  const [hover, setHover] = useState(false);
  const podeReceber = !!arrastando;

  return (
    <div
      onDragOver={(e) => {
        if (!podeReceber) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setHover(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setHover(false);
      }}
      onDrop={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setHover(false);
        if (!arrastando) return;

        const mouseX = e.clientX;
        const cards = Array.from(e.currentTarget.querySelectorAll<HTMLElement>("[data-pessoa-card]"));
        let colAlvo = cards.length;
        for (let i = 0; i < cards.length; i++) {
          const rect = cards[i].getBoundingClientRect();
          if (mouseX < rect.left + rect.width / 2) { colAlvo = i; break; }
        }
        await moverPessoa(arrastando, { area_id: areaId, subsecao_id: subsecaoId, linha, colunaAlvo: colAlvo });
        setArrastando(null);
      }}
      className={`flex flex-wrap justify-center gap-6 rounded-xl px-3 py-4 transition ${
        podeReceber ? (hover ? "bg-emerald-500/15 outline outline-2 outline-emerald-400" : "outline outline-1 outline-white/5") : ""
      }`}
    >
      {pessoas.map((p) => (
        <PessoaAvatar
          key={p.id}
          pessoa={p}
          podeEditar={podeEditar}
          onClick={() => onEditar(p)}
          arrastando={arrastando}
          setArrastando={setArrastando}
          mrrPorPessoa={mrrPorPessoa}
        />
      ))}
    </div>
  );
}

function RowGap({
  insertLinha, areaId, subsecaoId,
  arrastando, moverPessoaNovaLinha, setArrastando,
}: {
  insertLinha: number;
  areaId: string;
  subsecaoId: string | null;
  arrastando: string | null;
  moverPessoaNovaLinha: (pessoaId: string, destino: { area_id: string; subsecao_id: string | null; insertLinha: number }) => Promise<void>;
  setArrastando: (id: string | null) => void;
}) {
  const [ativo, setAtivo] = useState(false);
  const podeReceber = !!arrastando;

  return (
    <div
      onDragOver={(e) => {
        if (!podeReceber) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = "move";
        setAtivo(true);
      }}
      onDragLeave={() => setAtivo(false)}
      onDrop={async (e) => {
        e.preventDefault();
        e.stopPropagation();
        setAtivo(false);
        if (arrastando) {
          await moverPessoaNovaLinha(arrastando, { area_id: areaId, subsecao_id: subsecaoId, insertLinha });
          setArrastando(null);
        }
      }}
      className={`transition-all ${
        podeReceber
          ? ativo
            ? "h-12 bg-emerald-500/25 border-y-2 border-dashed border-emerald-400 rounded-lg my-1"
            : "h-4 hover:h-8 border-y border-dashed border-white/10 rounded-lg my-1"
          : "h-2"
      }`}
    />
  );
}

// ============================================================
// AVATAR — MRR embaixo do nome/cargo
// ============================================================
function PessoaAvatar({
  pessoa, podeEditar, onClick, arrastando, setArrastando, mrrPorPessoa,
}: {
  pessoa: OrgPessoa;
  podeEditar: boolean;
  onClick: () => void;
  arrastando: string | null;
  setArrastando: (id: string | null) => void;
  mrrPorPessoa: Map<string, number>;
}) {
  const iniciais = pessoa.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();
  const size = pessoa.destaque ? "h-24 w-24" : "h-16 w-16";
  const textSize = pessoa.destaque ? "text-2xl" : "text-lg";
  const eu = arrastando === pessoa.id;

  // MRR total da carteira dessa pessoa
  const mrr = pessoa.ruston_pessoa_id ? mrrPorPessoa.get(pessoa.ruston_pessoa_id) ?? 0 : 0;

  return (
    <div
      data-pessoa-card
      draggable={podeEditar}
      onDragStart={(e) => {
        setArrastando(pessoa.id);
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", pessoa.id); } catch {}
      }}
      onDragEnd={() => setArrastando(null)}
      onClick={podeEditar ? onClick : undefined}
      className={`flex flex-col items-center gap-2 transition p-2 ${
        podeEditar ? "cursor-grab active:cursor-grabbing hover:opacity-80" : "cursor-default"
      } ${eu ? "opacity-40 scale-95" : ""}`}
      title={podeEditar ? "Arrasta pra mover · Clica pra editar" : ""}
    >
      <div className={`${size} rounded-full overflow-hidden bg-gradient-to-br from-red-600 to-red-800 flex items-center justify-center border-2 border-red-500/40 pointer-events-none`}>
        {pessoa.foto_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pessoa.foto_url} alt={pessoa.nome} className="h-full w-full object-cover" draggable={false} />
        ) : (
          <span className={`font-black text-white ${textSize}`}>{iniciais}</span>
        )}
      </div>
      <div className="text-center pointer-events-none">
        <p className={`font-bold text-white uppercase ${pessoa.destaque ? "text-sm" : "text-xs"}`}>{pessoa.nome}</p>
        {pessoa.cargo && <p className="mt-0.5 text-[10px] text-red-300 whitespace-pre-line max-w-[140px]">{pessoa.cargo}</p>}
        {mrr > 0 && (
          <p
            className="mt-1 text-[10px] font-bold text-emerald-300"
            title={`MRR total da carteira: ${mrr.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}`}
          >
            💰 {formatMrrCompact(mrr)}
          </p>
        )}
        {pessoa.tem_carteira && mrr === 0 && <p className="mt-0.5 text-[9px] text-amber-300">📋</p>}
      </div>
    </div>
  );
}

// ============================================================
// CARTEIRA CARD
// ============================================================
function CarteiraCard({ pessoa, clientes, clientesAuto, fcaStatus, podeEditar, onChanged }: {
  pessoa: OrgPessoa;
  clientes: Carteira[];
  clientesAuto: ClienteAuto[];
  fcaStatus?: Map<string, FcaStatus>;
  podeEditar: boolean;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [adicionando, setAdicionando] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const iniciais = pessoa.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase();

  const modoAuto = !!pessoa.ruston_pessoa_id;
  const totalClientes = modoAuto ? clientesAuto.length : clientes.length;

  // MRR total da pessoa (só modo auto)
  const mrrTotal = modoAuto
    ? clientesAuto.reduce((soma, c) => soma + (c.mrr ?? 0), 0)
    : 0;

  async function adicionar() {
    const nome = novoNome.trim();
    if (!nome) return;
    await supabase.from("ruston_org_carteiras").insert({ pessoa_id: pessoa.id, cliente_nome: nome, ordem: clientes.length });
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
          {pessoa.nome} <span className="text-red-300">| {totalClientes}</span>
        </p>
        {modoAuto && mrrTotal > 0 && (
          <p className="text-[11px] font-bold text-emerald-300">
            💰 MRR {mrrTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 })}
          </p>
        )}
        {modoAuto && (
          <span className="text-[9px] text-emerald-300/70 uppercase tracking-widest">🔄 sincronizado</span>
        )}
      </div>
      <div className="mb-3 border-t border-red-500/30" />

      {modoAuto && (
        <div className="space-y-2">
          {clientesAuto
            .slice()
            .sort((a, b) => a.nome.localeCompare(b.nome))
            .map((c) => <ClienteAutoRow key={c.id} cliente={c} fca={fcaStatus?.get(c.id)} />)}
          {clientesAuto.length === 0 && (
            <p className="text-center text-[11px] text-brand-muted italic py-4">Nenhum cliente ativo pra esse GP</p>
          )}
        </div>
      )}

      {!modoAuto && (
        <>
          <div className="space-y-2">
            {clientes.map((c) => <ClienteRow key={c.id} carteira={c} podeEditar={podeEditar} onChanged={onChanged} />)}
            {clientes.length === 0 && !adicionando && (
              <p className="text-center text-[11px] text-brand-muted italic py-4">
                Sem clientes.<br />
                <span className="text-[10px] text-brand-muted/70">Dica: vincula essa pessoa a alguém do cadastro no modal, aí a lista vem automática.</span>
              </p>
            )}
          </div>
          {podeEditar && !adicionando && (
            <button onClick={() => setAdicionando(true)} className="mt-3 w-full rounded-lg border border-dashed border-white/20 py-2 text-xs text-brand-muted hover:border-brand hover:text-brand">
              + Adicionar cliente (manual)
            </button>
          )}
          {adicionando && (
            <div className="mt-3 space-y-2">
              <input className="input text-xs" placeholder="Nome do cliente"
                value={novoNome} onChange={(e) => setNovoNome(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") adicionar();
                  if (e.key === "Escape") { setAdicionando(false); setNovoNome(""); }
                }}
                autoFocus />
              <div className="flex gap-2">
                <button className="btn text-xs flex-1" onClick={adicionar}>Adicionar</button>
                <button className="btn-ghost text-xs" onClick={() => { setAdicionando(false); setNovoNome(""); }}>Cancelar</button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ClienteAutoRow({ cliente, fca }: { cliente: ClienteAuto; fca?: FcaStatus }) {
  const tags: { texto: string; cor: string }[] = [];
  if (cliente.churn_realizado && !cliente.subiu_no_sistema) {
    tags.push({ texto: "CHURN", cor: "border-red-500/40 bg-red-500/10 text-red-300" });
  }
  if (cliente.data_vencimento_contrato) {
    const dias = Math.floor((new Date(cliente.data_vencimento_contrato).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    if (dias >= 0 && dias <= 30) tags.push({ texto: `VENCE ${dias}D`, cor: "border-amber-500/40 bg-amber-500/10 text-amber-300" });
    if (dias < 0) tags.push({ texto: "VENCIDO", cor: "border-red-500/40 bg-red-500/10 text-red-300" });
  }
  const mrr = cliente.mrr ? cliente.mrr.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }) : null;

  const bandeira = fca?.bandeira ?? "sem_dado";
  const bolinhaClasses: Record<string, string> = {
    verde: "bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.7)]",
    amarelo: "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.7)]",
    vermelho: "bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.7)]",
    sem_dado: "bg-white/20",
  };
  const bolinhaLabel: Record<string, string> = {
    verde: "Safe", amarelo: "Care", vermelho: "Danger", sem_dado: "Sem FCA",
  };

  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] p-2">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span
              className={`inline-block h-3 w-3 rounded-full flex-shrink-0 ${bolinhaClasses[bandeira]}`}
              title={`${bolinhaLabel[bandeira]}${fca?.nota_final != null ? ` · Nota ${fca.nota_final.toFixed(2)}` : ""}${fca ? ` · Última: ${fca.data_referencia}` : ""}`}
            />
            <p className="text-xs font-semibold uppercase text-white truncate">{cliente.nome}</p>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1 ml-5">
            {mrr && (
              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[8px] font-bold text-emerald-300">
                {mrr}
              </span>
            )}
            {tags.map((t, i) => (
              <span key={i} className={`rounded border ${t.cor} px-1.5 py-0.5 text-[8px] font-bold`}>
                {t.texto}
              </span>
            ))}
          </div>
        </div>
      </div>
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

function ModalPessoa({ pessoa, areas, subsecoes, pessoasCadastro, onFechar, onSalvo }: {
  pessoa: OrgPessoa; areas: Area[]; subsecoes: Subsecao[];
  pessoasCadastro: PessoaCadastro[];
  onFechar: () => void; onSalvo: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    nome: pessoa.nome, cargo: pessoa.cargo ?? "",
    area_id: pessoa.area_id, subsecao_id: pessoa.subsecao_id ?? "",
    destaque: pessoa.destaque,
    tem_carteira: pessoa.tem_carteira, foto_url: pessoa.foto_url,
    ruston_pessoa_id: pessoa.ruston_pessoa_id ?? "",
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
    const payload: any = {
      nome: form.nome.trim(), cargo: form.cargo || null,
      area_id: form.area_id, subsecao_id: form.subsecao_id || null,
      destaque: form.destaque,
      tem_carteira: form.tem_carteira, foto_url: form.foto_url,
      ruston_pessoa_id: form.ruston_pessoa_id || null,
    };
    if (pessoa.id) {
      await supabase.from("ruston_org_pessoas").update(payload).eq("id", pessoa.id);
    } else {
      const { data: doGrupo } = await supabase
        .from("ruston_org_pessoas")
        .select("linha, coluna")
        .eq("area_id", form.area_id)
        .eq("ativo", true);
      const linha0 = (doGrupo ?? []).filter((p: any) => (p.linha ?? 0) === 0);
      payload.linha = 0;
      payload.coluna = linha0.length;
      payload.ordem = linha0.length;
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

        <div className="mb-2 flex items-center gap-2">
          <input type="checkbox" id="destaque" checked={form.destaque} onChange={(e) => setForm({ ...form, destaque: e.target.checked })} />
          <label htmlFor="destaque" className="text-sm">⭐ Foto grande (Gerente / Coordenador)</label>
        </div>

        <div className="mb-4 flex items-center gap-2">
          <input type="checkbox" id="carteira" checked={form.tem_carteira} onChange={(e) => setForm({ ...form, tem_carteira: e.target.checked })} />
          <label htmlFor="carteira" className="text-sm">📋 Tem carteira de clientes</label>
        </div>

        {form.tem_carteira && (
          <div className="mb-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-3">
            <label className="label text-emerald-200">🔗 Vincular ao cadastro (recomendado)</label>
            <p className="mb-2 text-[11px] text-brand-muted">
              Selecione a pessoa correspondente no cadastro pra <strong>carteira atualizar sozinha</strong>.
              Cliente novo com esse GP aparece automático; churn finalizado some.
            </p>
            <select
              className="input"
              value={form.ruston_pessoa_id}
              onChange={(e) => setForm({ ...form, ruston_pessoa_id: e.target.value })}
            >
              <option value="">— não vincular (usar carteira manual) —</option>
              {pessoasCadastro.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </div>
        )}

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
