"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { carregarSemanasEE } from "@/components/clientes/TagSemanaEE";
import {
  TIPO_PESQUISA_LABEL, NOTA_ALERTA, nomePesquisa, formularioDe, corNota, comentariosDe,
  type Pesquisa, type TipoPesquisa,
} from "@/lib/pesquisas";

/* ============================== PESQUISAS DO CLIENTE ==============================
   Pilar 2 do Playbook NPS: pesquisa curta em cada entrega. Cada envio gera um link
   único (/p/<token>) com QR Code; a resposta cai aqui e no Radar de Churn. */

type ClienteLite = { id: string; nome: string; squad_id: string | null; squad_nome: string | null; account_nome: string | null };
type Status = "pendente" | "respondida" | "alerta";

const linkDe = (token: string) => `${typeof window !== "undefined" ? window.location.origin : ""}/p/${token}`;

const mensagemWhats = (p: { tipo: TipoPesquisa; semana_ee: number | null }, link: string) =>
  p.tipo === "checkin"
    ? `Pessoal, obrigado pelo check-in de hoje! Para deixarmos o próximo ainda melhor, deixem a avaliação de vocês, leva menos de 1 minuto: ${link}`
    : `Pessoal, obrigado pela reunião de hoje! Queremos saber o que vocês acharam da entrega (${nomePesquisa(p.tipo, p.semana_ee)}). Leva menos de 2 minutos: ${link}`;

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

export default function PesquisasPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, isGerente, squadId } = useUsuarioPerfil();
  const [clientes, setClientes] = useState<ClienteLite[]>([]);
  const [semanas, setSemanas] = useState<Record<string, number>>({});
  const [pesquisas, setPesquisas] = useState<Pesquisa[]>([]);
  const [loading, setLoading] = useState(true);
  const [gerarAberto, setGerarAberto] = useState(false);
  const [clienteInicial, setClienteInicial] = useState("");
  const [qr, setQr] = useState<Pesquisa | null>(null);
  const [detalhe, setDetalhe] = useState<Pesquisa | null>(null);
  const [filtroSquad, setFiltroSquad] = useState("");
  const [filtroTipo, setFiltroTipo] = useState<TipoPesquisa | "">("");
  const [filtroStatus, setFiltroStatus] = useState<Status | "">("");
  const [busca, setBusca] = useState("");

  // /pesquisas?cliente=<id> abre o gerador já com o cliente (atalho do Radar de Churn)
  useEffect(() => {
    const c = new URLSearchParams(window.location.search).get("cliente");
    if (c) { setClienteInicial(c); setGerarAberto(true); }
  }, []);

  async function load() {
    setLoading(true);
    const desde = new Date(Date.now() - 180 * 86400000).toISOString();
    const [{ data: cs }, sem, { data: ps }] = await Promise.all([
      supabase.from("ruston_clientes_view").select("id, nome, squad_id, squad_nome, account_nome, ativo, churn_realizado")
        .eq("ativo", true).order("nome"),
      carregarSemanasEE(supabase),
      supabase.from("ruston_pesquisas").select("*").gte("criada_em", desde).order("criada_em", { ascending: false }),
    ]);
    setClientes(((cs ?? []) as (ClienteLite & { churn_realizado: boolean })[]).filter((c) => !c.churn_realizado));
    setSemanas(sem);
    setPesquisas(((ps ?? []) as Pesquisa[]).filter((p) => !p.cancelada));
    setLoading(false);
  }
  useEffect(() => { if (!loadingPerfil) load(); /* eslint-disable-next-line */ }, [loadingPerfil]);

  const clientePorId = useMemo(() => new Map(clientes.map((c) => [c.id, c])), [clientes]);
  // Coordenador/Investidor: só o próprio squad
  const meusClientes = useMemo(() => clientes.filter((c) => isGerente || !squadId || c.squad_id === squadId), [clientes, isGerente, squadId]);
  const squads = useMemo(() => Array.from(new Set(meusClientes.map((c) => c.squad_nome).filter(Boolean))).sort() as string[], [meusClientes]);

  const statusDe = (p: Pesquisa): Status => !p.respondida_em ? "pendente" : p.nota != null && p.nota < NOTA_ALERTA ? "alerta" : "respondida";

  const base = pesquisas.filter((p) => {
    const c = clientePorId.get(p.cliente_id);
    if (!c || !(isGerente || !squadId || c.squad_id === squadId)) return false;
    return (!filtroSquad || c.squad_nome === filtroSquad)
      && (!filtroTipo || p.tipo === filtroTipo)
      && (!busca.trim() || c.nome.toLowerCase().includes(busca.trim().toLowerCase()));
  });
  const visiveis = filtroStatus ? base.filter((p) => statusDe(p) === filtroStatus) : base;

  // Indicadores dos últimos 30 dias
  const ultimos30 = base.filter((p) => Date.now() - new Date(p.criada_em).getTime() <= 30 * 86400000);
  const respondidas30 = ultimos30.filter((p) => p.respondida_em);
  const comNota = respondidas30.filter((p) => p.nota != null);
  const notaMedia = comNota.length ? comNota.reduce((s, p) => s + Number(p.nota), 0) / comNota.length : null;
  const alertas = base.filter((p) => statusDe(p) === "alerta").length;
  const pendentes = base.filter((p) => statusDe(p) === "pendente").length;

  async function cancelar(p: Pesquisa) {
    if (!confirm("Cancelar esta pesquisa? O link deixa de funcionar.")) return;
    const { error } = await supabase.from("ruston_pesquisas").update({ cancelada: true }).eq("id", p.id);
    if (!error) setPesquisas((l) => l.filter((x) => x.id !== p.id));
  }

  if (loadingPerfil || loading) return <p className="text-brand-muted">Carregando pesquisas...</p>;

  return (
    <div className="max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">📝 Pesquisas do cliente</h1>
          <p className="text-sm text-brand-muted">
            Pesquisa curta em cada entrega (Pilar 2 do Playbook NPS). Nota abaixo de {NOTA_ALERTA} acende alerta no Radar de Churn.
          </p>
        </div>
        <button className="btn" onClick={() => { setClienteInicial(""); setGerarAberto(true); }}>+ Gerar pesquisa</button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Indicador label="Enviadas · 30 dias" valor={String(ultimos30.length)} />
        <Indicador label="Taxa de resposta · 30 dias" valor={ultimos30.length ? `${Math.round((respondidas30.length / ultimos30.length) * 100)}%` : "—"}
          sub={`${respondidas30.length} de ${ultimos30.length}`} />
        <Indicador label="Nota média · 30 dias" valor={notaMedia == null ? "—" : notaMedia.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
          sub="de 0 a 5" cor={corNota(notaMedia)} />
        <Indicador label="Aguardando resposta" valor={String(pendentes)} cor={pendentes ? "text-amber-300" : undefined}
          onClick={() => setFiltroStatus(filtroStatus === "pendente" ? "" : "pendente")} ativo={filtroStatus === "pendente"} />
        <Indicador label="Nota baixa (alerta)" valor={String(alertas)} cor={alertas ? "text-red-300" : undefined}
          onClick={() => setFiltroStatus(filtroStatus === "alerta" ? "" : "alerta")} ativo={filtroStatus === "alerta"} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[180px]" value={filtroSquad} onChange={(e) => setFiltroSquad(e.target.value)}>
          <option value="">Todos os squads</option>
          {squads.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-[220px]" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value as TipoPesquisa | "")}>
          <option value="">Todos os tipos</option>
          {(Object.keys(TIPO_PESQUISA_LABEL) as TipoPesquisa[]).map((t) => <option key={t} value={t}>{TIPO_PESQUISA_LABEL[t]}</option>)}
        </select>
        <select className="input max-w-[180px]" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as Status | "")}>
          <option value="">Todos os status</option>
          <option value="pendente">Aguardando resposta</option>
          <option value="respondida">Respondida</option>
          <option value="alerta">Nota baixa</option>
        </select>
        <input className="input max-w-xs" placeholder="Buscar cliente..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        <span className="ml-auto text-sm text-brand-muted">{visiveis.length} pesquisas · últimos 6 meses</span>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
              <th className="px-4 py-3">Cliente</th>
              <th className="px-4 py-3">Pesquisa</th>
              <th className="px-4 py-3">Enviada</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Nota</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {visiveis.map((p) => {
              const c = clientePorId.get(p.cliente_id);
              const st = statusDe(p);
              return (
                <tr key={p.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3">
                    <p className="font-medium">{c?.nome ?? "—"}</p>
                    <p className="text-[10px] text-brand-muted">{[c?.squad_nome, c?.account_nome && `GP ${c.account_nome}`].filter(Boolean).join(" · ")}</p>
                  </td>
                  <td className="px-4 py-3">{nomePesquisa(p.tipo, p.semana_ee)}</td>
                  <td className="px-4 py-3 text-xs text-brand-muted">
                    {dataHora(p.criada_em)}
                    {p.enviada_por && <p className="text-[10px]">{p.enviada_por}</p>}
                  </td>
                  <td className="px-4 py-3">
                    {st === "pendente" && <span className="badge border-amber-500/40 text-amber-300">Aguardando</span>}
                    {st === "respondida" && <span className="badge border-emerald-500/40 text-emerald-300">Respondida</span>}
                    {st === "alerta" && <span className="badge border-red-500/40 bg-red-500/10 text-red-300">⚠ Nota baixa</span>}
                    {p.respondida_em && <p className="mt-0.5 text-[10px] text-brand-muted">{dataHora(p.respondida_em)}</p>}
                  </td>
                  <td className={`px-4 py-3 text-lg font-bold ${corNota(p.nota)}`}>
                    {p.nota == null ? "—" : Number(p.nota).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex justify-end gap-3 text-xs">
                      {p.respondida_em
                        ? <button className="text-brand hover:underline" onClick={() => setDetalhe(p)}>Ver respostas</button>
                        : <>
                            <button className="text-brand hover:underline" onClick={() => setQr(p)}>QR / link</button>
                            <button className="text-brand-muted hover:text-red-300" onClick={() => cancelar(p)}>Cancelar</button>
                          </>}
                    </div>
                  </td>
                </tr>
              );
            })}
            {visiveis.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-brand-muted">Nenhuma pesquisa nesse filtro. Clique em &ldquo;Gerar pesquisa&rdquo; para enviar a primeira.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {gerarAberto && (
        <ModalGerar
          clientes={meusClientes}
          semanas={semanas}
          clienteInicial={clienteInicial}
          onFechar={() => setGerarAberto(false)}
          onGerada={(p) => { setPesquisas((l) => [p, ...l]); setGerarAberto(false); setQr(p); }}
        />
      )}
      {qr && <ModalQr p={qr} cliente={clientePorId.get(qr.cliente_id)?.nome ?? ""} onFechar={() => setQr(null)} />}
      {detalhe && <ModalRespostas p={detalhe} cliente={clientePorId.get(detalhe.cliente_id)?.nome ?? ""} onFechar={() => setDetalhe(null)} />}
    </div>
  );
}

/* ============================== Componentes ============================== */

function Indicador({ label, valor, sub, cor, onClick, ativo }: {
  label: string; valor: string; sub?: string; cor?: string; onClick?: () => void; ativo?: boolean;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag onClick={onClick} className={`card p-4 text-left ${onClick ? "transition hover:bg-white/[0.03]" : ""} ${ativo ? "border-brand/50 bg-brand/10" : ""}`}>
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${cor ?? ""}`}>{valor}</p>
      {sub && <p className="text-[11px] text-brand-muted">{sub}</p>}
    </Tag>
  );
}

function Modal({ titulo, onFechar, children, largo }: { titulo: string; onFechar: () => void; children: React.ReactNode; largo?: boolean }) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center" onClick={onFechar}>
      <div className={`card w-full ${largo ? "max-w-3xl" : "max-w-lg"}`} onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between gap-4">
          <h2 className="text-lg font-bold">{titulo}</h2>
          <button className="text-brand-muted hover:text-white" onClick={onFechar}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function BotaoCopiar({ texto, label }: { texto: string; label: string }) {
  const [ok, setOk] = useState(false);
  return (
    <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={async () => {
      try { await navigator.clipboard.writeText(texto); setOk(true); setTimeout(() => setOk(false), 1500); } catch { /* sem clipboard */ }
    }}>{ok ? "✓ Copiado" : label}</button>
  );
}

function ModalGerar({ clientes, semanas, clienteInicial, onFechar, onGerada }: {
  clientes: ClienteLite[];
  semanas: Record<string, number>;
  clienteInicial: string;
  onFechar: () => void;
  onGerada: (p: Pesquisa) => void;
}) {
  const supabase = createClient();
  const [clienteId, setClienteId] = useState(clienteInicial);
  const [tipo, setTipo] = useState<TipoPesquisa>(clienteInicial && semanas[clienteInicial] ? "ee" : "checkin");
  const [semana, setSemana] = useState<number>(semanas[clienteInicial] ?? 1);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  function escolherCliente(id: string) {
    setClienteId(id);
    // Cliente em E.E: já sugere a pesquisa da semana em que ele está
    if (semanas[id]) { setTipo("ee"); setSemana(semanas[id]); }
  }

  async function gerar() {
    if (!clienteId) { setErro("Escolha o cliente."); return; }
    setSalvando(true);
    setErro(null);
    const { data, error } = await supabase.from("ruston_pesquisas")
      .insert({ cliente_id: clienteId, tipo, semana_ee: tipo === "ee" ? semana : null })
      .select().single();
    setSalvando(false);
    if (error || !data) { setErro(error?.message ?? "Não foi possível gerar a pesquisa."); return; }
    onGerada(data as Pesquisa);
  }

  const f = formularioDe(tipo, tipo === "ee" ? semana : null);

  return (
    <Modal titulo="Gerar pesquisa" onFechar={onFechar}>
      <div className="space-y-4">
        <div>
          <label className="label">Cliente</label>
          <select className="input" value={clienteId} onChange={(e) => escolherCliente(e.target.value)}>
            <option value="">Escolha o cliente...</option>
            {clientes.map((c) => <option key={c.id} value={c.id}>{c.nome}{semanas[c.id] ? ` · E.E S${semanas[c.id]}` : ""}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Tipo de pesquisa</label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TIPO_PESQUISA_LABEL) as TipoPesquisa[]).map((t) => (
              <button key={t} type="button" onClick={() => setTipo(t)}
                className={`rounded-lg border px-2 py-2 text-xs font-medium transition ${tipo === t ? "border-brand bg-brand/15 text-white" : "border-white/10 text-brand-muted hover:text-gray-200"}`}>
                {TIPO_PESQUISA_LABEL[t]}
              </button>
            ))}
          </div>
        </div>
        {tipo === "ee" && (
          <div>
            <label className="label">Semana da E.E</label>
            <div className="grid grid-cols-5 gap-2">
              {[1, 2, 3, 4, 5].map((s) => (
                <button key={s} type="button" onClick={() => setSemana(s)}
                  className={`rounded-lg border py-2 text-xs font-bold transition ${semana === s ? "border-sky-400 bg-sky-500/15 text-sky-200" : "border-white/10 text-brand-muted hover:text-gray-200"}`}>
                  S{s}{s === 5 && <span className="block text-[9px] font-normal">final</span>}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs text-gray-300">
          <p className="mb-1 font-semibold text-gray-100">{f.titulo} · {f.perguntas.length} perguntas</p>
          <ul className="list-disc space-y-0.5 pl-4">
            {f.perguntas.map((q) => <li key={q.id}>{q.texto}</li>)}
          </ul>
        </div>
        {erro && <p className="text-xs text-red-300">{erro}</p>}
        <div className="flex gap-2">
          <button className="btn flex-1" onClick={gerar} disabled={salvando}>{salvando ? "Gerando..." : "Gerar link e QR Code"}</button>
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </Modal>
  );
}

function ModalQr({ p, cliente, onFechar }: { p: Pesquisa; cliente: string; onFechar: () => void }) {
  const link = linkDe(p.token);
  const [img, setImg] = useState("");
  const [telaCheia, setTelaCheia] = useState(false);
  useEffect(() => {
    QRCode.toDataURL(link, { width: 640, margin: 1 }).then(setImg).catch(() => setImg(""));
  }, [link]);

  if (telaCheia) {
    // Para mostrar na reunião: QR grande em tela cheia
    return (
      <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-white p-6 text-center text-black" onClick={() => setTelaCheia(false)}>
        <p className="text-2xl font-bold">Sua opinião em menos de 2 minutos</p>
        {img && <img src={img} alt="QR Code da pesquisa" className="h-[60vh] max-h-[640px] w-auto" />}
        <p className="text-lg">{cliente} · {nomePesquisa(p.tipo, p.semana_ee)}</p>
        <p className="text-xs text-gray-500">Clique para fechar</p>
      </div>
    );
  }

  return (
    <Modal titulo="Pesquisa pronta para enviar" onFechar={onFechar}>
      <div className="space-y-4">
        <p className="text-sm text-gray-300"><b>{cliente}</b> · {nomePesquisa(p.tipo, p.semana_ee)}</p>
        <div className="flex flex-col items-center gap-3 rounded-lg bg-white p-4">
          {img ? <img src={img} alt="QR Code da pesquisa" className="h-56 w-56" /> : <div className="h-56 w-56" />}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn flex-1" onClick={() => setTelaCheia(true)}>📺 Mostrar QR na reunião</button>
          {img && <a className="btn-ghost" href={img} download={`pesquisa-${cliente || p.token}.png`}>Baixar QR</a>}
        </div>
        <div>
          <label className="label">Link</label>
          <div className="flex gap-2">
            <input className="input" readOnly value={link} onFocus={(e) => e.target.select()} />
            <BotaoCopiar texto={link} label="Copiar" />
          </div>
        </div>
        <div>
          <label className="label">Mensagem para o grupo do WhatsApp</label>
          <p className="rounded-lg border border-white/5 bg-black/20 p-3 text-sm text-gray-300">{mensagemWhats(p, link)}</p>
          <div className="mt-2"><BotaoCopiar texto={mensagemWhats(p, link)} label="Copiar mensagem" /></div>
        </div>
        <p className="text-[11px] text-brand-muted">Link único desta pesquisa. Se o cliente não responder, reenvie o mesmo link (grupo → privado → coordenador).</p>
      </div>
    </Modal>
  );
}

function ModalRespostas({ p, cliente, onFechar }: { p: Pesquisa; cliente: string; onFechar: () => void }) {
  const f = formularioDe(p.tipo, p.semana_ee);
  const r = p.respostas ?? {};
  return (
    <Modal titulo={`${cliente} · ${nomePesquisa(p.tipo, p.semana_ee)}`} onFechar={onFechar} largo>
      <div className="mb-4 flex flex-wrap items-center gap-4 text-sm">
        <span>Nota: <b className={`text-xl ${corNota(p.nota)}`}>{p.nota == null ? "—" : Number(p.nota).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}</b> <span className="text-brand-muted">/ 5</span></span>
        {p.respondida_em && <span className="text-brand-muted">Respondida em {dataHora(p.respondida_em)}</span>}
      </div>
      <ol className="space-y-3">
        {f.perguntas.filter((q) => r[q.id] != null && r[q.id] !== "").map((q) => {
          const v = r[q.id];
          return (
            <li key={q.id} className="rounded-lg border border-white/5 bg-black/20 p-3">
              <p className="text-xs text-brand-muted">{q.texto}</p>
              <p className="mt-1 whitespace-pre-wrap text-sm font-medium">
                {Array.isArray(v) ? v.join(" · ") : q.tipo === "escala" && q.escala?.labels?.[v as number] ? `${v} · ${q.escala.labels[v as number]}` : String(v)}
              </p>
            </li>
          );
        })}
      </ol>
      {comentariosDe(p).length > 0 && (
        <p className="mt-4 text-[11px] text-brand-muted">💡 Leia as respostas abertas procurando necessidades fora do escopo: elas podem virar projeto novo (Monetização).</p>
      )}
    </Modal>
  );
}
