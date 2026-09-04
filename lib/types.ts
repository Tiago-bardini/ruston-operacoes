"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

// ============================================================
// TIPOS
// ============================================================
type Pessoa = {
  id: string;
  nome: string;
  email: string | null;
  cargo: string;
  squad_id: string | null;
  foto_url: string | null;
  ativo: boolean;
  area_organograma: string | null; // 'gerencia' | 'comercial' | 'administrativo' | 'operacao'
  organograma_row: number;
  ordem_org: number;
  role_organograma: string | null;
};

type Squad = {
  id: string;
  nome: string;
  label: string | null;
  coordenador_id: string | null;
  ativo: boolean;
};

// ============================================================
// PÁGINA
// ============================================================
export default function OrganogramaPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, podeEditar } = useUsuarioPerfil();
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [squads, setSquads] = useState<Squad[]>([]);
  const [loading, setLoading] = useState(true);
  const [pessoaFoto, setPessoaFoto] = useState<Pessoa | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: ps }, { data: sq }] = await Promise.all([
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("ordem_org"),
      supabase.from("ruston_squads").select("*").eq("ativo", true).order("nome"),
    ]);
    setPessoas((ps as Pessoa[]) ?? []);
    setSquads((sq as Squad[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { if (!loadingPerfil) load(); /* eslint-disable-next-line */ }, [loadingPerfil]);

  // Filtra por área
  const gerente = useMemo(
    () => pessoas.find((p) => p.area_organograma === "gerencia"),
    [pessoas]
  );

  const comercial = useMemo(() => {
    return {
      coord: pessoas.find((p) => p.area_organograma === "comercial" && p.organograma_row === 0),
      membros: pessoas.filter((p) => p.area_organograma === "comercial" && p.organograma_row > 0),
    };
  }, [pessoas]);

  const administrativo = useMemo(() => {
    return {
      coord: gerente, // Coord ADM = Nicolas (mesmo do Gerente)
      membros: pessoas.filter((p) => p.area_organograma === "administrativo"),
    };
  }, [pessoas, gerente]);

  const squadsData = useMemo(() => {
    return squads.map((sq) => {
      const membrosSquad = pessoas.filter((p) => p.squad_id === sq.id);
      const coord = membrosSquad.find((p) => p.organograma_row === 0);
      const rows: Pessoa[][] = [];
      const maxRow = Math.max(0, ...membrosSquad.map((p) => p.organograma_row));
      for (let r = 1; r <= maxRow; r++) {
        rows.push(
          membrosSquad
            .filter((p) => p.organograma_row === r)
            .sort((a, b) => a.ordem_org - b.ordem_org)
        );
      }
      return { squad: sq, coord, rows };
    });
  }, [pessoas, squads]);

  if (loadingPerfil || loading) {
    return <p className="text-brand-muted">Carregando organograma...</p>;
  }

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">👥 Organograma</h1>
          <p className="text-sm text-brand-muted">
            Estrutura do time da Ruston. Edite pessoas em <Link href="/pessoas" className="text-brand hover:underline">/pessoas</Link>
          </p>
        </div>
        {podeEditar && (
          <Link href="/pessoas" className="btn-ghost text-xs">
            + Editar time
          </Link>
        )}
      </div>

      {/* GERENTE */}
      {gerente && (
        <div className="mb-6 flex justify-center">
          <PessoaCard
            pessoa={gerente}
            destaque
            podeEditar={podeEditar}
            onFoto={() => setPessoaFoto(gerente)}
          />
        </div>
      )}

      {/* Linha 2: COMERCIAL + ADMINISTRATIVO */}
      <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2">
        <SecaoCard title="💼 COMERCIAL" cor="border-blue-500/30">
          {comercial.coord && (
            <>
              <p className="mb-2 text-[10px] uppercase tracking-wide text-brand-muted">Coordenador</p>
              <PessoaCard
                pessoa={comercial.coord}
                small
                podeEditar={podeEditar}
                onFoto={() => setPessoaFoto(comercial.coord!)}
              />
              <div className="my-3 border-t border-white/5" />
            </>
          )}
          <p className="mb-2 text-[10px] uppercase tracking-wide text-brand-muted">Time</p>
          <div className="grid grid-cols-2 gap-2">
            {comercial.membros.map((p) => (
              <PessoaCard
                key={p.id}
                pessoa={p}
                small
                podeEditar={podeEditar}
                onFoto={() => setPessoaFoto(p)}
              />
            ))}
          </div>
        </SecaoCard>

        <SecaoCard title="📊 ADMINISTRATIVO" cor="border-emerald-500/30">
          {administrativo.coord && (
            <>
              <p className="mb-2 text-[10px] uppercase tracking-wide text-brand-muted">Coordenador (acumula)</p>
              <PessoaCard
                pessoa={administrativo.coord}
                small
                cargoOverride="Coordenador ADM"
                podeEditar={podeEditar}
                onFoto={() => setPessoaFoto(administrativo.coord!)}
              />
              <div className="my-3 border-t border-white/5" />
            </>
          )}
          <p className="mb-2 text-[10px] uppercase tracking-wide text-brand-muted">Time</p>
          <div className="grid grid-cols-2 gap-2">
            {administrativo.membros.map((p) => (
              <PessoaCard
                key={p.id}
                pessoa={p}
                small
                podeEditar={podeEditar}
                onFoto={() => setPessoaFoto(p)}
              />
            ))}
          </div>
        </SecaoCard>
      </div>

      {/* SQUADS */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {squadsData.map(({ squad, coord, rows }) => (
          <SecaoCard
            key={squad.id}
            title={`⚔️ SQUAD ${squad.nome}`}
            cor="border-amber-500/30"
            subtitle={squad.label ?? undefined}
          >
            {coord && (
              <>
                <p className="mb-2 text-[10px] uppercase tracking-wide text-brand-muted">Coordenador</p>
                <PessoaCard
                  pessoa={coord}
                  podeEditar={podeEditar}
                  onFoto={() => setPessoaFoto(coord)}
                />
                <div className="my-3 border-t border-white/5" />
              </>
            )}
            <p className="mb-2 text-[10px] uppercase tracking-wide text-brand-muted">
              Membros ({rows.reduce((a, b) => a + b.length, 0)})
            </p>
            <div className="space-y-2">
              {rows.map((row, i) => (
                <div key={i} className="grid grid-cols-3 gap-2">
                  {row.map((p) => (
                    <PessoaCard
                      key={p.id}
                      pessoa={p}
                      small
                      podeEditar={podeEditar}
                      onFoto={() => setPessoaFoto(p)}
                    />
                  ))}
                </div>
              ))}
            </div>
          </SecaoCard>
        ))}
      </div>

      {/* Modal de upload de foto */}
      {pessoaFoto && (
        <ModalUploadFoto
          pessoa={pessoaFoto}
          onFechar={() => setPessoaFoto(null)}
          onSalvo={() => {
            setPessoaFoto(null);
            load();
          }}
        />
      )}
    </div>
  );
}

// ============================================================
// SEÇÃO CARD (wrapper)
// ============================================================
function SecaoCard({
  title,
  subtitle,
  cor,
  children,
}: {
  title: string;
  subtitle?: string;
  cor: string;
  children: React.ReactNode;
}) {
  return (
    <div className={`card border ${cor}`}>
      <div className="mb-3 flex items-baseline gap-2">
        <h2 className="text-sm font-bold uppercase tracking-wide">{title}</h2>
        {subtitle && <span className="text-[10px] text-brand-muted">{subtitle}</span>}
      </div>
      {children}
    </div>
  );
}

// ============================================================
// PESSOA CARD
// ============================================================
function PessoaCard({
  pessoa,
  destaque,
  small,
  cargoOverride,
  podeEditar,
  onFoto,
}: {
  pessoa: Pessoa;
  destaque?: boolean;
  small?: boolean;
  cargoOverride?: string;
  podeEditar: boolean;
  onFoto: () => void;
}) {
  const cargo = cargoOverride ?? pessoa.role_organograma ?? pessoa.cargo;
  const iniciais = pessoa.nome
    .split(" ")
    .map((s) => s[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className={`rounded-lg border p-3 transition ${
        destaque
          ? "border-brand bg-brand/5 min-w-[220px]"
          : "border-white/10 bg-white/[0.02] hover:border-white/20"
      }`}
    >
      <div className="flex items-center gap-2">
        <button
          onClick={podeEditar ? onFoto : undefined}
          className={`relative flex-shrink-0 rounded-full overflow-hidden ${
            destaque ? "h-14 w-14" : small ? "h-8 w-8" : "h-10 w-10"
          } bg-gradient-to-br from-brand/60 to-brand/30 flex items-center justify-center ${
            podeEditar ? "cursor-pointer hover:ring-2 hover:ring-brand" : ""
          }`}
          title={podeEditar ? "Clica pra trocar foto" : ""}
        >
          {pessoa.foto_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pessoa.foto_url} alt={pessoa.nome} className="h-full w-full object-cover" />
          ) : (
            <span className={`font-bold text-white ${destaque ? "text-lg" : small ? "text-[10px]" : "text-xs"}`}>
              {iniciais}
            </span>
          )}
        </button>
        <div className="min-w-0 flex-1">
          <p className={`font-semibold truncate ${destaque ? "text-base" : small ? "text-xs" : "text-sm"}`}>
            {pessoa.nome}
          </p>
          <p className={`text-brand-muted truncate ${destaque ? "text-xs" : "text-[10px]"}`}>
            {cargo}
          </p>
        </div>
      </div>
    </div>
  );
}

// ============================================================
// MODAL DE UPLOAD DE FOTO
// ============================================================
function ModalUploadFoto({
  pessoa,
  onFechar,
  onSalvo,
}: {
  pessoa: Pessoa;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const supabase = createClient();
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(pessoa.foto_url);
  const [arquivo, setArquivo] = useState<File | null>(null);

  function selecionar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setArquivo(file);
    const reader = new FileReader();
    reader.onload = (ev) => setPreview(ev.target?.result as string);
    reader.readAsDataURL(file);
  }

  async function salvar() {
    if (!arquivo) {
      alert("Selecione uma foto primeiro");
      return;
    }
    setUploading(true);

    // Nome do arquivo: pessoa_id + extensão
    const ext = arquivo.name.split(".").pop() ?? "jpg";
    const path = `${pessoa.id}.${ext}`;

    // Upload no bucket 'fotos-pessoas'
    const { error: uploadError } = await supabase.storage
      .from("fotos-pessoas")
      .upload(path, arquivo, { upsert: true, contentType: arquivo.type });

    if (uploadError) {
      alert("Erro no upload: " + uploadError.message);
      setUploading(false);
      return;
    }

    // Pega URL pública
    const { data: urlData } = supabase.storage.from("fotos-pessoas").getPublicUrl(path);
    const publicUrl = urlData.publicUrl + `?t=${Date.now()}`; // força reload cache

    // Salva no ruston_pessoas
    const { error: updateError } = await supabase
      .from("ruston_pessoas")
      .update({ foto_url: publicUrl })
      .eq("id", pessoa.id);

    if (updateError) {
      alert("Erro ao salvar URL: " + updateError.message);
      setUploading(false);
      return;
    }

    setUploading(false);
    onSalvo();
  }

  async function remover() {
    if (!confirm("Remover foto?")) return;
    setUploading(true);
    await supabase.from("ruston_pessoas").update({ foto_url: null }).eq("id", pessoa.id);
    setUploading(false);
    onSalvo();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}
    >
      <div
        className="w-full max-w-md rounded-lg border border-white/10 bg-brand-panel p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-semibold">Foto — {pessoa.nome}</h3>
            <p className="text-xs text-brand-muted">
              {pessoa.role_organograma ?? pessoa.cargo}
            </p>
          </div>
          <button onClick={onFechar} className="text-brand-muted hover:text-white">✕</button>
        </div>

        <div className="mb-4 flex justify-center">
          <div className="h-40 w-40 rounded-full overflow-hidden bg-gradient-to-br from-brand/60 to-brand/30 flex items-center justify-center border-2 border-white/10">
            {preview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={preview} alt="preview" className="h-full w-full object-cover" />
            ) : (
              <span className="text-4xl font-bold text-white/60">
                {pessoa.nome.split(" ").map((s) => s[0]).slice(0, 2).join("").toUpperCase()}
              </span>
            )}
          </div>
        </div>

        <div className="mb-4">
          <label className="btn w-full cursor-pointer text-center block">
            📸 Escolher foto
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={selecionar}
            />
          </label>
          <p className="mt-2 text-[10px] text-brand-muted text-center">
            JPG, PNG ou WEBP · Recomendado 300×300 (quadrada)
          </p>
        </div>

        <div className="flex justify-between gap-2">
          {pessoa.foto_url && (
            <button
              className="text-xs text-red-300 hover:text-red-400"
              onClick={remover}
              disabled={uploading}
            >
              Remover foto atual
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button className="btn-ghost" onClick={onFechar} disabled={uploading}>
              Cancelar
            </button>
            <button className="btn" onClick={salvar} disabled={uploading || !arquivo}>
              {uploading ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
