"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatBRL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import {
  avaliarRiscoChurn, carregarDadosRadar,
  type AvaliacaoRisco, type DadosClienteRadar, type FonteRisco, type NivelRisco,
} from "@/lib/radarChurn";

type Linha = DadosClienteRadar & { av: AvaliacaoRisco };

type Diagnostico = {
  diagnostico: { parecer?: string; causa_raiz?: string; acoes?: { acao: string; responsavel: string; prazo: string }[] };
  gerado_em: string;
  gerado_por: string | null;
  dados_ate: string | null;
};

const NIVEL: Record<NivelRisco, { label: string; texto: string; borda: string; fundo: string; barra: string }> = {
  critico: { label: "Crítico", texto: "text-red-300", borda: "border-red-500/40", fundo: "bg-red-500/10", barra: "bg-red-500" },
  atencao: { label: "Atenção", texto: "text-amber-300", borda: "border-amber-500/40", fundo: "bg-amber-500/10", barra: "bg-amber-500" },
  saudavel: { label: "Saudável", texto: "text-emerald-300", borda: "border-emerald-500/40", fundo: "bg-emerald-500/10", barra: "bg-emerald-500" },
  sem_dado: { label: "Sem dado", texto: "text-zinc-400", borda: "border-zinc-600/40", fundo: "bg-zinc-500/10", barra: "bg-zinc-600" },
};

const ORDEM: Record<NivelRisco, number> = { critico: 0, atencao: 1, saudavel: 2, sem_dado: 3 };

const FONTE_LABEL: Record<FonteRisco, string> = { fca: "FCA", whatsapp: "WhatsApp", reunioes: "Reuniões" };

export default function RadarChurn() {
  const supabase = createClient();
  const { loading: loadingPerfil, isGerente, squadId } = useUsuarioPerfil();
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [diags, setDiags] = useState<Record<string, Diagnostico>>({});
  const [loading, setLoading] = useState(true);
  const [nivel, setNivel] = useState<NivelRisco | "">("");
  const [squad, setSquad] = useState("");
  const [gp, setGp] = useState("");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState<string | null>(null);

  useEffect(() => {
    if (loadingPerfil) return;
    (async () => {
      setLoading(true);
      const [dados, { data: dg }] = await Promise.all([
        carregarDadosRadar(supabase),
        supabase.from("ruston_diagnostico_churn").select("cliente_id, diagnostico, gerado_em, gerado_por, dados_ate"),
      ]);
      setLinhas(
        dados
          // Coordenador/Investidor só vê o próprio squad
          .filter((d) => isGerente || !squadId || d.cliente.squad_id === squadId)
          .map((d) => ({ ...d, av: avaliarRiscoChurn(d) }))
          .sort((a, b) => ORDEM[a.av.nivel] - ORDEM[b.av.nivel] || b.av.risco - a.av.risco || (Number(b.cliente.mrr) || 0) - (Number(a.cliente.mrr) || 0))
      );
      setDiags(Object.fromEntries(((dg ?? []) as (Diagnostico & { cliente_id: string })[]).map((x) => [x.cliente_id, x])));
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, [loadingPerfil]);

  const squads = useMemo(() => Array.from(new Set(linhas.map((l) => l.cliente.squad_nome).filter(Boolean))) as string[], [linhas]);
  const gps = useMemo(() => Array.from(new Set(linhas.map((l) => l.cliente.account_nome).filter(Boolean))).sort() as string[], [linhas]);

  const base = linhas.filter((l) =>
    (!squad || l.cliente.squad_nome === squad) &&
    (!gp || l.cliente.account_nome === gp) &&
    (!busca.trim() || l.cliente.nome.toLowerCase().includes(busca.trim().toLowerCase()))
  );
  const visiveis = nivel ? base.filter((l) => l.av.nivel === nivel) : base;
  const resumo = (n: NivelRisco) => {
    const ls = base.filter((l) => l.av.nivel === n);
    return { qtd: ls.length, mrr: ls.reduce((s, l) => s + (Number(l.cliente.mrr) || 0), 0) };
  };
  const criticos = resumo("critico");
  const atencao = resumo("atencao");
  const mrrTotal = base.reduce((s, l) => s + (Number(l.cliente.mrr) || 0), 0);

  if (loadingPerfil || loading) return <p className="text-brand-muted">Calculando risco de churn...</p>;

  return (
    <div className="max-w-[1600px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Radar de Churn</h1>
          <p className="text-sm text-brand-muted">FCA + Radar WhatsApp + Reuniões num risco de 0 a 100, com o motivo de cada alerta</p>
        </div>
        <div className="text-right">
          <p className="text-[10px] uppercase tracking-wide text-brand-muted">MRR em risco (crítico + atenção)</p>
          <p className="text-2xl font-bold text-red-300">{formatBRL(criticos.mrr + atencao.mrr)}</p>
          <p className="text-[11px] text-brand-muted">
            {mrrTotal ? `${Math.round(((criticos.mrr + atencao.mrr) / mrrTotal) * 100)}% do MRR da carteira` : ""}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {(["critico", "atencao", "saudavel", "sem_dado"] as NivelRisco[]).map((n) => {
          const r = resumo(n);
          const cfg = NIVEL[n];
          return (
            <button key={n} onClick={() => setNivel(nivel === n ? "" : n)}
              className={`card p-4 text-left transition ${nivel === n ? `${cfg.borda} ${cfg.fundo}` : "hover:bg-white/[0.03]"}`}>
              <p className="text-[10px] uppercase tracking-wide text-brand-muted">{cfg.label}</p>
              <p className={`mt-1 text-2xl font-bold ${cfg.texto}`}>{r.qtd}</p>
              <p className="text-[11px] text-brand-muted">{formatBRL(r.mrr)} de MRR</p>
            </button>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select className="input max-w-[180px]" value={squad} onChange={(e) => setSquad(e.target.value)}>
          <option value="">Todos os squads</option>
          {squads.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className="input max-w-[200px]" value={gp} onChange={(e) => setGp(e.target.value)}>
          <option value="">Todos os GPs</option>
          {gps.map((g) => <option key={g} value={g}>{g}</option>)}
        </select>
        <input className="input max-w-xs" placeholder="Buscar cliente..." value={busca} onChange={(e) => setBusca(e.target.value)} />
        {nivel && <button className="text-xs text-brand-muted hover:text-white" onClick={() => setNivel("")}>Limpar filtro</button>}
        <span className="ml-auto text-sm text-brand-muted">{visiveis.length} clientes · maior risco primeiro</span>
      </div>

      <div className="space-y-2">
        {visiveis.map((l) => (
          <CardCliente key={l.cliente.id} l={l} aberto={aberto === l.cliente.id}
            onToggle={() => setAberto(aberto === l.cliente.id ? null : l.cliente.id)}
            diag={diags[l.cliente.id]}
            onDiag={(d) => setDiags((s) => ({ ...s, [l.cliente.id]: d }))} />
        ))}
        {visiveis.length === 0 && <div className="card text-center text-brand-muted">Nenhum cliente nesse filtro.</div>}
      </div>

      <p className="text-[11px] text-brand-muted">
        Cada fonte soma até 35 pontos (FCA: nota e queda · WhatsApp: risco, concorrência, reclamação, silêncio · Reuniões: risco,
        concorrência, insatisfação, cadência). Duas fontes em alerta somam +10 e três somam +15. Crítico: 50+ ou uma fonte no máximo · Atenção: 25+.
      </p>
    </div>
  );
}

function CardCliente({ l, aberto, onToggle, diag, onDiag }: {
  l: Linha;
  aberto: boolean;
  onToggle: () => void;
  diag?: Diagnostico;
  onDiag: (d: Diagnostico) => void;
}) {
  const { av, cliente } = l;
  const cfg = NIVEL[av.nivel];
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const desatualizado = !!diag && (diag.dados_ate ?? "") < (av.ultimoDado ?? "");

  async function gerar() {
    setGerando(true);
    setErro(null);
    try {
      const res = await fetch("/api/diagnostico-churn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cliente_id: cliente.id }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Falha ao gerar");
      onDiag(j);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Falha ao gerar");
    }
    setGerando(false);
  }

  return (
    <div className={`card ${av.nivel === "critico" ? "border-red-500/30" : ""}`} style={{ padding: 0 }}>
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-4 p-4 text-left">
        <div className={`flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-full border ${cfg.borda} ${cfg.fundo}`}>
          <span className={`text-base font-bold leading-none ${cfg.texto}`}>{av.risco}</span>
        </div>
        <div className="min-w-[180px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold">{cliente.nome}</p>
            <span className={`badge text-[10px] ${cfg.borda} ${cfg.fundo} ${cfg.texto}`}>{cfg.label}</span>
            {av.fontesEmAlerta.length >= 2 && (
              <span className="badge border-red-500/30 bg-red-500/10 text-[10px] text-red-300">
                {av.fontesEmAlerta.length} fontes em alerta
              </span>
            )}
          </div>
          <p className="mt-0.5 text-[11px] text-brand-muted">
            {formatBRL(cliente.mrr)}/mês
            {cliente.squad_nome && ` · ${cliente.squad_nome}`}
            {cliente.account_nome && ` · GP ${cliente.account_nome}`}
          </p>
          {av.sinais.length > 0 && !aberto && (
            <p className="mt-1.5 line-clamp-1 text-xs text-gray-300">
              {av.sinais[0].grave ? "🔴" : "🟡"} {av.sinais[0].texto}
              {av.sinais.length > 1 && <span className="text-brand-muted"> · +{av.sinais.length - 1} sinais</span>}
            </p>
          )}
        </div>
        <div className="flex shrink-0 gap-1.5">
          {(Object.keys(FONTE_LABEL) as FonteRisco[]).map((f) => (
            <ChipFonte key={f} label={FONTE_LABEL[f]} pontos={av.porFonte[f]} />
          ))}
        </div>
        <span className="text-xs text-brand-muted">{aberto ? "▾" : "▸"}</span>
      </button>

      {aberto && (
        <div className="grid grid-cols-1 gap-4 border-t border-white/5 p-4 lg:grid-cols-3">
          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-brand-muted">Por que está em risco</p>
            {av.sinais.length === 0 && <p className="text-xs text-brand-muted">Nenhum sinal de risco nas 3 fontes.</p>}
            <ul className="space-y-1.5">
              {av.sinais.map((s, i) => (
                <li key={i} className="flex gap-2 text-xs">
                  <span>{s.grave ? "🔴" : "🟡"}</span>
                  <span className="flex-1">
                    <span className="text-brand-muted">{FONTE_LABEL[s.fonte]} · </span>{s.texto}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-brand-muted">Plano de ação já sugerido</p>
            {av.acoes.length === 0 && <p className="text-xs text-brand-muted">Sem ações sugeridas nas últimas análises.</p>}
            <ul className="space-y-2">
              {av.acoes.map((a, i) => (
                <li key={i} className="rounded-lg border border-white/5 bg-black/20 p-2 text-xs">
                  <p className="font-medium">
                    <span className={a.prioridade === "alta" ? "text-red-300" : a.prioridade === "media" ? "text-amber-300" : "text-brand-muted"}>●</span>{" "}
                    {a.sugestao}
                  </p>
                  <p className="mt-0.5 text-[10px] text-brand-muted">{a.responsavel}{a.prazo && ` · ${a.prazo}`} · {a.origem}</p>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted">Diagnóstico IA</p>
              {(!diag || desatualizado) && (
                <button className="btn px-3 py-1 text-xs" onClick={gerar} disabled={gerando}>
                  {gerando ? "Gerando..." : diag ? "Atualizar" : "✨ Gerar diagnóstico"}
                </button>
              )}
            </div>
            {erro && <p className="mb-2 text-xs text-red-300">{erro}</p>}
            {!diag && !gerando && (
              <p className="text-xs text-brand-muted">
                A IA lê o resumo das 3 fontes e escreve um parecer curto. Fica salvo e só gera de novo quando chegar dado novo.
              </p>
            )}
            {diag && (
              <div className="space-y-2 text-xs">
                {desatualizado && <p className="text-[10px] text-amber-300">Chegou dado novo depois deste diagnóstico.</p>}
                {diag.diagnostico.parecer && <p className="text-gray-200">{diag.diagnostico.parecer}</p>}
                {diag.diagnostico.causa_raiz && (
                  <p><span className="text-brand-muted">Causa raiz: </span>{diag.diagnostico.causa_raiz}</p>
                )}
                {!!diag.diagnostico.acoes?.length && (
                  <ol className="list-decimal space-y-1 pl-4">
                    {diag.diagnostico.acoes.map((a, i) => (
                      <li key={i}>{a.acao} <span className="text-brand-muted">({a.responsavel}{a.prazo && ` · ${a.prazo}`})</span></li>
                    ))}
                  </ol>
                )}
                <p className="text-[10px] text-brand-muted">
                  Gerado em {new Date(diag.gerado_em).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" })}
                  {diag.gerado_por && ` por ${diag.gerado_por}`}
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChipFonte({ label, pontos }: { label: string; pontos: number | null }) {
  const cor = pontos == null ? "border-white/5 text-zinc-500"
    : pontos >= 15 ? "border-red-500/40 bg-red-500/10 text-red-300"
    : pontos > 0 ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
    : "border-emerald-500/30 bg-emerald-500/10 text-emerald-300";
  return (
    <span className={`rounded-md border px-2 py-1 text-[10px] font-medium ${cor}`} title={pontos == null ? "Sem dado" : `${pontos} pontos de risco`}>
      {label}{pontos == null ? " —" : ""}
    </span>
  );
}
