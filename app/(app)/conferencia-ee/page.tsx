"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { semanaNoTitulo } from "@/lib/analiseIA";
import { SEMANAS_CONFERENCIA, nomeSemana, type Gravidade, type ParecerEE, type Veredito } from "@/lib/conferenciaEE";
import { textoDoDocx } from "@/lib/docxTexto";

type Cliente = { id: string; nome: string; etapa: string | null; tag_contrato: string | null };
type Reuniao = { id: string; data_reuniao: string; titulo: string | null; origem: string | null; interna: boolean; transcricao: string | null; resumo: string | null };
type Conferencia = {
  id: string; cliente_id: string; semana: number; arquivo_nome: string | null; veredito: Veredito | null;
  nota: number | null; parecer: ParecerEE | null; reunioes_usadas: number | null; criado_por: string | null; created_at: string;
};

const VEREDITO: Record<Veredito, { label: string; cor: string }> = {
  apresentar: { label: "Pode apresentar", cor: "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" },
  ajustar: { label: "Ajustar antes de apresentar", cor: "border-amber-500/40 bg-amber-500/15 text-amber-300" },
  refazer: { label: "Refazer", cor: "border-red-500/40 bg-red-500/15 text-red-300" },
};
const COR_GRAV: Record<Gravidade, string> = {
  alta: "border-red-500/30 bg-red-500/10 text-red-300",
  media: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  baixa: "border-white/10 bg-white/5 text-gray-300",
};
/** Semanas citadas no nome do arquivo ("Semana_4", "S5", "Semanas 1 e 2"). */
function semanasNoArquivo(nome: string): number[] {
  const t = " " + nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\.[a-z0-9]+$/, "").replace(/[_\-.()\[\]|]+/g, " ") + " ";
  const achadas = new Set<number>();
  for (const m of Array.from(t.matchAll(/ (?:s|sem|semana|semanas) ?([1-5])((?: ?(?:e|,|a) ?[1-5])*)(?![0-9])/g))) {
    achadas.add(Number(m[1]));
    for (const n of (m[2] ?? "").match(/[1-5]/g) ?? []) achadas.add(Number(n));
  }
  return Array.from(achadas).sort();
}
const ehEE = (c: Cliente) => c.etapa === "estruturacao_estrategica" || (c.tag_contrato ?? "").startsWith("ee");

export default function ConferenciaEEPage() {
  const supabase = createClient();
  const { email, isGerente } = useUsuarioPerfil();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [clienteId, setClienteId] = useState("");
  const [semana, setSemana] = useState(3);
  const [reunioes, setReunioes] = useState<Reuniao[]>([]);
  const [conferencias, setConferencias] = useState<Conferencia[]>([]);
  const [padroes, setPadroes] = useState<Record<number, string>>({});
  const [editandoPadrao, setEditandoPadrao] = useState(false);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [observacao, setObservacao] = useState("");
  const [rodando, setRodando] = useState(false);
  const [progresso, setProgresso] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<Conferencia | null>(null);
  const [novaReuniao, setNovaReuniao] = useState(false);

  useEffect(() => {
    (async () => {
      const [{ data: cs }, { data: ps }] = await Promise.all([
        supabase.from("ruston_clientes").select("id, nome, etapa, tag_contrato").eq("ativo", true).order("nome"),
        supabase.from("ruston_ee_padroes").select("semana, texto"),
      ]);
      const lista = (cs ?? []) as Cliente[];
      // Clientes em E.E primeiro
      setClientes([...lista.filter(ehEE), ...lista.filter((c) => !ehEE(c))]);
      setPadroes(Object.fromEntries(((ps ?? []) as { semana: number; texto: string }[]).map((p) => [p.semana, p.texto])));
    })();
    // eslint-disable-next-line
  }, []);

  async function carregarCliente(id: string) {
    if (!id) { setReunioes([]); setConferencias([]); return; }
    const [{ data: rs }, { data: cf }] = await Promise.all([
      supabase.from("ruston_reunioes_cliente")
        .select("id, data_reuniao, titulo, origem, interna, transcricao, resumo")
        .eq("cliente_id", id).order("data_reuniao", { ascending: true }),
      supabase.from("ruston_ee_conferencias").select("*").eq("cliente_id", id).order("created_at", { ascending: false }),
    ]);
    setReunioes((rs ?? []) as Reuniao[]);
    setConferencias((cf ?? []) as Conferencia[]);
  }

  useEffect(() => { setAberta(null); carregarCliente(clienteId); /* eslint-disable-next-line */ }, [clienteId]);

  const cliente = clientes.find((c) => c.id === clienteId);
  const reunioesCliente = reunioes.filter((r) => !r.interna);
  const semanasComReuniao = useMemo(() => new Set(reunioesCliente.map((r) => semanaNoTitulo(r.titulo)).filter(Boolean) as number[]), [reunioesCliente]);
  // Semanas anteriores à conferida sem reunião registrada (kickoff conta como semana 1)
  const semanasFaltando = Array.from({ length: semana - 1 }, (_, i) => i + 1).filter((s) => !semanasComReuniao.has(s)
    && !(s === 1 && reunioesCliente.some((r) => /kick|boas.?vindas/i.test(r.titulo ?? ""))));

  async function salvarPadrao() {
    const { error } = await supabase.from("ruston_ee_padroes").upsert({ semana, texto: padroes[semana] ?? "", updated_by: email, updated_at: new Date().toISOString() });
    if (error) { setErro(error.message); return; }
    setEditandoPadrao(false);
  }

  const semanasArquivo = arquivo ? semanasNoArquivo(arquivo.name) : [];
  const semanaDivergente = semanasArquivo.length > 0 && !semanasArquivo.includes(semana);

  async function conferir() {
    if (!clienteId || !arquivo) return;
    if (semanaDivergente && !confirm(`O nome do arquivo indica Semana ${semanasArquivo.join(" e ")}, mas você vai conferir como Semana ${semana}.

A IA vai avaliar pelo padrão da Semana ${semana} e a nota pode sair baixa só por isso. Continuar mesmo assim?`)) return;
    setRodando(true); setErro(null); setAberta(null);
    try {
      setProgresso("Enviando o arquivo...");
      const seguro = arquivo.name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "_");
      const path = `${clienteId}/s${semana}-${Date.now()}-${seguro}`;
      const { error: upErr } = await supabase.storage.from("ee-conferencias").upload(path, arquivo, { contentType: arquivo.type || undefined });
      if (upErr) throw new Error(`Falha ao enviar o arquivo: ${upErr.message}`);

      setProgresso(`A IA está conferindo a apresentação e cruzando com ${reunioesCliente.length} reunião(ões) do cliente. Leva de 1 a 3 minutos...`);
      const res = await fetch("/api/conferencia-ee", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: clienteId, semana, arquivo_path: path, arquivo_nome: arquivo.name, observacao, criado_por: email }),
      });
      const data = await res.json().catch(() => ({ error: `Erro ${res.status}` }));
      if (!res.ok) throw new Error(data.error ?? `Erro ${res.status}`);
      setAberta(data.conferencia as Conferencia);
      setArquivo(null); setObservacao("");
      carregarCliente(clienteId);
    } catch (e: any) {
      setErro(String(e?.message ?? e));
    } finally {
      setRodando(false); setProgresso("");
    }
  }


  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">🔎 Conferência de E.E</h1>
        <p className="text-sm text-brand-muted">
          Suba o material da semana antes de apresentar. A IA confere a qualidade da entrega e se ela bate com o que o cliente falou nas reuniões anteriores.
        </p>
      </div>

      <div className="card grid grid-cols-1 gap-3 md:grid-cols-[2fr_1fr]">
        <div>
          <label className="label">Cliente</label>
          <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Selecione...</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{ehEE(c) ? "🧭 " : ""}{c.nome}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Semana conferida</label>
          <select className="input" value={semana} onChange={(e) => setSemana(Number(e.target.value))}>
            {SEMANAS_CONFERENCIA.map((s) => <option key={s.semana} value={s.semana}>Semana {s.semana} · {s.nome}</option>)}
          </select>
        </div>
      </div>

      {clienteId && (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1fr_1.4fr]">
          {/* Contexto do cliente */}
          <div className="space-y-4">
            <div className="card">
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">Reuniões que a IA vai usar ({reunioesCliente.length})</p>
                <button className="btn-ghost text-xs" onClick={() => setNovaReuniao(true)}>+ Adicionar reunião</button>
              </div>
              {semanasFaltando.length > 0 && (
                <p className="mb-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                  Não achei reunião da{semanasFaltando.length > 1 ? "s" : ""} semana{semanasFaltando.length > 1 ? "s" : ""} {semanasFaltando.join(", ")}.
                  Se aconteceu, adicione a transcrição para a conferência ficar completa.
                </p>
              )}
              <div className="max-h-72 space-y-1 overflow-y-auto">
                {reunioesCliente.length === 0 && <p className="text-xs text-brand-muted">Nenhuma reunião registrada para este cliente.</p>}
                {reunioesCliente.map((r) => {
                  const s = semanaNoTitulo(r.titulo);
                  const tem = !!(r.transcricao || r.resumo);
                  return (
                    <div key={r.id} className="flex items-center justify-between gap-2 rounded border border-white/5 px-2 py-1.5 text-xs">
                      <div className="min-w-0">
                        <p className="truncate">{r.titulo ?? "Reunião"}</p>
                        <p className="text-[10px] text-brand-muted">{formatDate(r.data_reuniao)}{r.origem === "manual" ? " · adicionada à mão" : ""}</p>
                      </div>
                      <div className="flex shrink-0 gap-1">
                        {s && <span className="badge border-white/10 bg-white/5">S{s}</span>}
                        <span className={`badge ${tem ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-300" : "border-red-500/30 bg-red-500/10 text-red-300"}`}>
                          {r.transcricao ? "transcrição" : r.resumo ? "resumo" : "sem conteúdo"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="card">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-semibold">Padrão da Semana {semana} · {nomeSemana(semana)}</p>
                {isGerente && !editandoPadrao && <button className="btn-ghost text-xs" onClick={() => setEditandoPadrao(true)}>{padroes[semana] ? "Editar" : "Colar POP"}</button>}
              </div>
              {editandoPadrao ? (
                <>
                  <textarea className="input min-h-[180px] text-xs" placeholder="Cole aqui o POP / manual V4 desta semana. A IA usa como régua principal."
                    value={padroes[semana] ?? ""} onChange={(e) => setPadroes({ ...padroes, [semana]: e.target.value })} />
                  <div className="mt-2 flex justify-end gap-2">
                    <button className="btn-ghost text-xs" onClick={() => setEditandoPadrao(false)}>Cancelar</button>
                    <button className="btn text-xs" onClick={salvarPadrao}>Salvar padrão</button>
                  </div>
                </>
              ) : (
                <>
                  <ul className="space-y-0.5 text-[11px] text-brand-muted">
                    {SEMANAS_CONFERENCIA.find((s) => s.semana === semana)!.checklist.map((c) => <li key={c}>• {c}</li>)}
                  </ul>
                  <p className={`mt-2 text-[11px] ${padroes[semana] ? "text-emerald-300" : "text-amber-300"}`}>
                    {padroes[semana] ? "POP da V4 cadastrado: a IA usa ele como régua principal." : "Sem POP cadastrado: a IA usa o checklist acima."}
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Conferir */}
          <div className="space-y-4">
            <div className="card">
              <p className="mb-2 text-sm font-semibold">Material para conferir</p>
              <input type="file" accept=".pdf,.html,.htm,.png,.jpg,.jpeg,.webp,.txt,.md" className="input"
                disabled={rodando} onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} />
              <p className="mt-1 text-[10px] text-brand-muted">PDF é o melhor formato (a IA vê os slides). PowerPoint, Canva e Google Slides: Arquivo → Baixar → PDF. Também aceita HTML e imagem.</p>
              {semanaDivergente && (
                <div className="mt-2 flex flex-wrap items-center gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-300">
                  <span>O arquivo parece ser da Semana {semanasArquivo.join(" e ")}, e você escolheu a Semana {semana}.</span>
                  {semanasArquivo.length === 1 && (
                    <button type="button" className="underline" onClick={() => setSemana(semanasArquivo[0])}>Trocar para Semana {semanasArquivo[0]}</button>
                  )}
                </div>
              )}
              <label className="label mt-3">Observação para a IA (opcional)</label>
              <textarea className="input min-h-[60px] text-sm" disabled={rodando} value={observacao}
                placeholder="Ex.: o cliente mudou a meta na última reunião; foque na verba sugerida"
                onChange={(e) => setObservacao(e.target.value)} />
              <div className="mt-3 flex items-center justify-end gap-3">
                {progresso && <p className="text-xs text-sky-300">{progresso}</p>}
                <button className="btn" disabled={!arquivo || rodando} onClick={conferir}>
                  {rodando ? "Conferindo..." : `Conferir Semana ${semana}`}
                </button>
              </div>
              {erro && <p className="mt-2 text-xs text-red-300">{erro}</p>}
            </div>

            {aberta?.parecer && <Parecer c={aberta} />}

            {conferencias.length > 0 && (
              <div className="card">
                <p className="mb-2 text-sm font-semibold">Histórico de conferências · {cliente?.nome}</p>
                <div className="space-y-1">
                  {conferencias.map((c) => (
                    <button key={c.id} onClick={() => setAberta(c)}
                      className={`flex w-full items-center justify-between gap-2 rounded border px-2 py-1.5 text-left text-xs hover:bg-white/5 ${aberta?.id === c.id ? "border-brand/50" : "border-white/5"}`}>
                      <span className="min-w-0 truncate">S{c.semana} · {nomeSemana(c.semana)} · {c.arquivo_nome}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className="text-brand-muted">{formatDate(c.created_at.slice(0, 10))}</span>
                        {c.veredito && <span className={`badge ${VEREDITO[c.veredito].cor}`}>{c.nota ?? "—"}/10</span>}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {novaReuniao && cliente && (
        <ModalReuniao cliente={cliente} semanaInicial={semanasFaltando[0] ?? Math.max(1, semana - 1)}
          onFechar={() => setNovaReuniao(false)}
          onSalvo={() => { setNovaReuniao(false); carregarCliente(cliente.id); }} />
      )}
    </div>
  );
}

/** Garante lista mesmo em pareceres antigos salvos com a lista como texto. */
function lista<T>(v: unknown): T[] {
  if (Array.isArray(v)) return v as T[];
  if (typeof v === "string") { try { const x = JSON.parse(v); return Array.isArray(x) ? x : []; } catch { return []; } }
  return [];
}

function Parecer({ c }: { c: Conferencia }) {
  const bruto = c.parecer!;
  const p = {
    ...bruto,
    ajustes: lista<ParecerEE["ajustes"][number]>(bruto.ajustes),
    coerencia: lista<ParecerEE["coerencia"][number]>(bruto.coerencia),
    checklist: lista<ParecerEE["checklist"][number]>(bruto.checklist),
    criterios: lista<ParecerEE["criterios"][number]>(bruto.criterios),
    pontos_fortes: lista<string>(bruto.pontos_fortes),
    perguntas_cliente: lista<string>(bruto.perguntas_cliente),
  };
  const v = VEREDITO[p.veredito] ?? VEREDITO.ajustar;
  const div = (p.coerencia ?? []).filter((x) => x.tipo !== "alinhado");
  const alinhados = (p.coerencia ?? []).filter((x) => x.tipo === "alinhado");
  const corStatus = { ok: "text-emerald-300", parcial: "text-amber-300", faltando: "text-red-300" } as const;
  const iconeStatus = { ok: "✓", parcial: "◐", faltando: "✗" } as const;

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex flex-wrap items-center gap-3">
          <span className={`badge text-sm ${v.cor}`}>{v.label}</span>
          <span className="text-3xl font-bold tabular-nums">{p.nota_geral}<span className="text-base text-brand-muted">/10</span></span>
          <span className="text-xs text-brand-muted">Semana {c.semana} · {nomeSemana(c.semana)} · {c.reunioes_usadas ?? 0} reunião(ões) cruzada(s)</span>
        </div>
        <p className="mt-2 text-sm">{p.resumo}</p>
        {p.limitacoes && <p className="mt-2 text-[11px] text-amber-300">Limitação: {p.limitacoes}</p>}
      </div>

      {(p.ajustes ?? []).length > 0 && (
        <div className="card">
          <p className="mb-2 text-sm font-semibold">Ajustes antes de apresentar</p>
          <div className="space-y-1.5">
            {p.ajustes.map((a, i) => (
              <div key={i} className="flex gap-2 text-sm">
                <span className={`badge h-fit shrink-0 ${COR_GRAV[a.prioridade] ?? COR_GRAV.baixa}`}>{a.prioridade}</span>
                <p><b className="text-gray-200">{a.slide}</b>{a.slide ? ": " : ""}{a.ajuste}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card">
        <p className="mb-2 text-sm font-semibold">Coerência com o que o cliente falou</p>
        {div.length === 0 && <p className="text-xs text-emerald-300">Nenhuma divergência encontrada com as reuniões.</p>}
        <div className="space-y-2">
          {div.map((x, i) => (
            <div key={i} className={`rounded-lg border p-2.5 text-xs ${COR_GRAV[x.gravidade] ?? COR_GRAV.baixa}`}>
              <p className="font-semibold">{x.tipo === "divergencia" ? "Divergência" : "Cliente falou e o material ignora"} · {x.gravidade}{x.slide ? ` · ${x.slide}` : ""}</p>
              {x.apresentacao && <p className="mt-1 text-gray-200"><span className="text-brand-muted">Material: </span>{x.apresentacao}</p>}
              {x.cliente_disse && <p className="mt-1 italic text-gray-200">“{x.cliente_disse}”</p>}
              {x.fonte && <p className="mt-0.5 text-[10px] text-brand-muted">{x.fonte}</p>}
            </div>
          ))}
        </div>
        {alinhados.length > 0 && (
          <div className="mt-3 border-t border-white/5 pt-2">
            <p className="mb-1 text-[11px] font-semibold text-emerald-300">Alinhado com o cliente</p>
            {alinhados.map((x, i) => <p key={i} className="text-[11px] text-brand-muted">✓ {x.apresentacao}{x.fonte ? ` (${x.fonte})` : ""}</p>)}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="card">
          <p className="mb-2 text-sm font-semibold">Checklist da semana</p>
          <div className="space-y-1.5">
            {(p.checklist ?? []).map((it, i) => (
              <div key={i} className="text-xs">
                <p><span className={`font-bold ${corStatus[it.status] ?? ""}`}>{iconeStatus[it.status] ?? "•"}</span> {it.item}{it.slides ? <span className="text-brand-muted"> · {it.slides}</span> : null}</p>
                {it.comentario && <p className="ml-4 text-[11px] text-brand-muted">{it.comentario}</p>}
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <p className="mb-2 text-sm font-semibold">Critérios</p>
          <div className="space-y-1.5">
            {(p.criterios ?? []).map((cr, i) => (
              <div key={i} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <p>{cr.criterio}</p>
                  <span className={`font-bold tabular-nums ${cr.nota >= 8 ? "text-emerald-300" : cr.nota >= 6 ? "text-amber-300" : "text-red-300"}`}>{cr.nota}</span>
                </div>
                {cr.comentario && <p className="text-[11px] text-brand-muted">{cr.comentario}</p>}
              </div>
            ))}
          </div>
        </div>
      </div>

      {((p.pontos_fortes ?? []).length > 0 || (p.perguntas_cliente ?? []).length > 0) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {(p.pontos_fortes ?? []).length > 0 && (
            <div className="card">
              <p className="mb-2 text-sm font-semibold text-emerald-300">Pontos fortes</p>
              {p.pontos_fortes.map((x, i) => <p key={i} className="text-xs text-gray-300">• {x}</p>)}
            </div>
          )}
          {(p.perguntas_cliente ?? []).length > 0 && (
            <div className="card">
              <p className="mb-2 text-sm font-semibold text-sky-300">Perguntas para fazer ao cliente</p>
              {p.perguntas_cliente.map((x, i) => <p key={i} className="text-xs text-gray-300">• {x}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ModalReuniao({ cliente, semanaInicial, onFechar, onSalvo }: {
  cliente: Cliente; semanaInicial: number; onFechar: () => void; onSalvo: () => void;
}) {
  const supabase = createClient();
  const [semana, setSemana] = useState(semanaInicial);
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [titulo, setTitulo] = useState(`EE Semana ${semanaInicial} | ${cliente.nome}`);
  const [texto, setTexto] = useState("");
  const [lendo, setLendo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function lerArquivo(f: File | undefined) {
    if (!f) return;
    setLendo(true); setErro(null);
    try {
      const t = f.name.toLowerCase().endsWith(".docx") ? await textoDoDocx(f) : await f.text();
      setTexto(t);
    } catch (e: any) {
      setErro(`Não consegui ler o arquivo: ${e?.message ?? e}. Abra e cole o texto.`);
    } finally { setLendo(false); }
  }

  async function salvar() {
    if (texto.trim().length < 100) { setErro("Cole a transcrição ou as anotações da reunião (mínimo de 100 caracteres)."); return; }
    setSalvando(true);
    const { error } = await supabase.from("ruston_reunioes_cliente").insert({
      cliente_id: cliente.id, data_reuniao: data, titulo: titulo.trim(), transcricao: texto.trim(),
      origem: "manual", realizada: true, interna: false,
    });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    onSalvo();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onFechar}>
      <div className="card w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-lg font-bold">Adicionar reunião · {cliente.nome}</p>
        <p className="mb-3 text-xs text-brand-muted">Para reuniões que não vieram da agenda. Ela fica salva no histórico do cliente e entra nas próximas conferências.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Semana da E.E</label>
            <select className="input" value={semana} onChange={(e) => {
              const s = Number(e.target.value); setSemana(s);
              setTitulo(s ? `EE Semana ${s} | ${cliente.nome}` : `Reunião | ${cliente.nome}`);
            }}>
              {SEMANAS_CONFERENCIA.map((s) => <option key={s.semana} value={s.semana}>S{s.semana} · {s.nome}</option>)}
              <option value={0}>Outra reunião</option>
            </select>
          </div>
          <div>
            <label className="label">Data</label>
            <input type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} />
          </div>
          <div>
            <label className="label">Arquivo (.docx do Gemini ou .txt)</label>
            <input type="file" accept=".docx,.txt,.md" className="input" onChange={(e) => lerArquivo(e.target.files?.[0])} />
          </div>
        </div>
        <label className="label mt-3">Título</label>
        <input className="input" value={titulo} onChange={(e) => setTitulo(e.target.value)} />
        <label className="label mt-3">Transcrição ou anotações {lendo && <span className="text-sky-300">lendo arquivo...</span>}</label>
        <textarea className="input min-h-[220px] text-xs" value={texto} onChange={(e) => setTexto(e.target.value)}
          placeholder="Cole aqui a transcrição ou as anotações do Gemini" />
        <p className="mt-1 text-[10px] text-brand-muted">{texto.length.toLocaleString("pt-BR")} caracteres</p>
        {erro && <p className="mt-2 text-xs text-red-300">{erro}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost text-xs" onClick={onFechar}>Cancelar</button>
          <button className="btn" disabled={salvando || lendo} onClick={salvar}>{salvando ? "Salvando..." : "Salvar reunião"}</button>
        </div>
      </div>
    </div>
  );
}
