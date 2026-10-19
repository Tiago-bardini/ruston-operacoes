"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatBRL, formatDate } from "@/lib/types";
import {
  cargaPorPessoa, carregarDadosGerenciais, excecoes, heatmapApontamentos, horasPorCliente,
  linkTask, saudePorSquad,
  type DadosGerenciais, type EkyteTask, type Intervalo, type PessoaEkyte, type SquadEkyte,
} from "@/lib/ekyte/visaoGerencial";

type Props = {
  /** Todas as tasks carregadas (pessoas ativas), já filtradas pelo squad */
  tasks: EkyteTask[];
  /** Pessoas ativas, já filtradas pelo squad */
  pessoas: PessoaEkyte[];
  squads: SquadEkyte[];
  filtroSquad: string;
  intervalo: Intervalo;
  periodoLabel: string;
};

export default function VisaoGerencial({ tasks, pessoas, squads, filtroSquad, intervalo, periodoLabel }: Props) {
  const supabase = createClient();
  const [dados, setDados] = useState<DadosGerenciais | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const hoje = useMemo(() => new Date(), []);

  useEffect(() => {
    carregarDadosGerenciais(supabase, tasks).then(setDados).catch((e) => setErro(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tasks.length]);

  const pessoaIds = useMemo(() => new Set(pessoas.map((p) => p.id)), [pessoas]);
  const apontamentos = useMemo(
    () => (dados?.apontamentos ?? []).filter((a) => !filtroSquad || (a.pessoa_id && pessoaIds.has(a.pessoa_id))),
    [dados, filtroSquad, pessoaIds],
  );
  const clientes = useMemo(
    () => (dados?.clientes ?? []).filter((c) => !filtroSquad || c.squad_id === filtroSquad),
    [dados, filtroSquad],
  );

  const saude = useMemo(() => saudePorSquad(tasks, apontamentos, pessoas, squads, intervalo, hoje),
    [tasks, apontamentos, pessoas, squads, intervalo, hoje]);
  const heatmap = useMemo(() => heatmapApontamentos(apontamentos, pessoas, squads, hoje), [apontamentos, pessoas, squads, hoje]);
  const carga = useMemo(() => cargaPorPessoa(tasks, pessoas), [tasks, pessoas]);
  const exc = useMemo(() => excecoes(tasks, clientes, hoje), [tasks, clientes, hoje]);
  // MRR é mensal, então compara com as horas dos últimos 30 dias (independe do filtro de período)
  const ultimos30 = useMemo(() => ({ ini: new Date(hoje.getTime() - 30 * 86400000), fim: hoje }), [hoje]);
  const porCliente = useMemo(() => horasPorCliente(apontamentos, clientes, ultimos30), [apontamentos, clientes, ultimos30]);

  if (erro) return <div className="card p-4 text-sm text-red-300">✗ Erro ao carregar a visão gerencial: {erro}</div>;
  if (!dados) return <div className="card p-8 text-center text-sm text-brand-muted">Carregando visão gerencial...</div>;

  return (
    <div className="space-y-4">
      {dados.fonteHoras === "aproximada" && (
        <div className="card p-3 text-xs text-amber-300">
          ⚠ Horas aproximadas: os apontamentos diários do eKyte ainda não estão no banco. As horas abaixo usam o tempo
          total de cada task concluída, contado no dia da conclusão.
        </div>
      )}

      <BlocoSaude saude={saude} periodoLabel={periodoLabel} />
      <BlocoApontamentos heatmap={heatmap} />
      <div className="grid gap-4 xl:grid-cols-2">
        <BlocoCarga carga={carga} />
        <BlocoExcecoes exc={exc} />
      </div>
      <BlocoClientes linhas={porCliente} />
    </div>
  );
}

// ---------------------------------------------------------------------
// 1) Saúde por squad
// ---------------------------------------------------------------------

function BlocoSaude({ saude, periodoLabel }: { saude: ReturnType<typeof saudePorSquad>; periodoLabel: string }) {
  return (
    <section>
      <h3 className="mb-2 font-semibold">Saúde por squad <span className="text-xs font-normal text-brand-muted">— {periodoLabel}, comparado ao período anterior</span></h3>
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {saude.map((s) => (
          <div key={s.squad_id} className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <h4 className="font-semibold">{s.nome}</h4>
              <span className="badge bg-white/5 text-brand-muted">{s.pessoas} {s.pessoas === 1 ? "pessoa" : "pessoas"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Mini
                label={`Entregas no prazo (${s.concluidas})`}
                value={s.noPrazoPct === null ? "—" : `${s.noPrazoPct.toFixed(0)}%`}
                tone={s.noPrazoPct === null ? undefined : s.noPrazoPct >= 80 ? "good" : s.noPrazoPct >= 60 ? "warn" : "bad"}
                delta={s.noPrazoPct !== null && s.noPrazoPctAnterior !== null ? s.noPrazoPct - s.noPrazoPctAnterior : null}
                deltaSufixo="pp"
              />
              <Mini label="Horas apontadas" value={`${s.horas.toFixed(1)}h`} delta={s.horas - s.horasAnterior} deltaSufixo="h" />
              <Mini label="Atrasadas em aberto" value={s.atrasadasAbertas} tone={s.atrasadasAbertas > 0 ? "bad" : "good"} />
              <Mini
                label="Idade média do atraso"
                value={s.atrasadasAbertas ? `${s.idadeMediaAtrasadas.toFixed(0)}d` : "—"}
                tone={s.idadeMediaAtrasadas > 14 ? "bad" : s.idadeMediaAtrasadas > 7 ? "warn" : undefined}
              />
            </div>
          </div>
        ))}
        {saude.length === 0 && <div className="card p-8 text-center text-sm text-brand-muted">Nenhum squad com pessoas ativas.</div>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// 2) Apontamentos — heatmap pessoas × semanas (valores absolutos, sem meta)
// ---------------------------------------------------------------------

function BlocoApontamentos({ heatmap }: { heatmap: ReturnType<typeof heatmapApontamentos> }) {
  const { semanas, linhas } = heatmap;
  const max = Math.max(1, ...linhas.flatMap((l) => l.minutos));
  const semApontar = linhas.filter((l) => l.diasSemApontar === null || l.diasSemApontar >= 7).length;
  let squadAnterior = "";

  return (
    <section className="card overflow-x-auto p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="font-semibold">Apontamentos por semana</h3>
        <p className="text-xs text-brand-muted">
          Horas apontadas nas últimas 8 semanas (semana atual em andamento).{" "}
          {semApontar > 0 && <span className="text-red-300">{semApontar} {semApontar === 1 ? "pessoa" : "pessoas"} sem apontar há 7+ dias.</span>}
        </p>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
            <th className="px-2 py-2">Pessoa</th>
            {semanas.map((s, i) => (
              <th key={i} className="px-1 py-2 text-center font-normal normal-case">
                {i === semanas.length - 1 ? "Atual" : `${String(s.getDate()).padStart(2, "0")}/${String(s.getMonth() + 1).padStart(2, "0")}`}
              </th>
            ))}
            <th className="px-2 py-2 text-center">Total</th>
            <th className="px-2 py-2">Último apontamento</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const alerta = l.diasSemApontar === null || l.diasSemApontar >= 7;
            const total = l.minutos.reduce((a, b) => a + b, 0);
            const cabecalho = l.squad_nome !== squadAnterior;
            squadAnterior = l.squad_nome;
            return (
              <FragmentoLinha key={l.pessoa.id} cabecalho={cabecalho ? l.squad_nome : null} colunas={semanas.length + 3}>
                <tr className="border-b border-white/5 last:border-0">
                  <td className={`px-2 py-1.5 font-medium ${alerta ? "text-red-300" : ""}`}>
                    {l.pessoa.nome}
                    {l.pessoa.cargo && <span className="ml-1 text-[10px] text-brand-muted">{l.pessoa.cargo}</span>}
                  </td>
                  {l.minutos.map((m, i) => (
                    <td key={i} className="px-1 py-1.5 text-center">
                      <span
                        className="inline-block min-w-[3rem] rounded-sm px-1.5 py-0.5 text-xs"
                        style={{ backgroundColor: m ? `rgba(16, 185, 129, ${0.12 + 0.6 * (m / max)})` : "rgba(255,255,255,0.03)" }}
                      >
                        {m ? `${(m / 60).toFixed(1)}h` : "—"}
                      </span>
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-center text-xs font-semibold">{(total / 60).toFixed(1)}h</td>
                  <td className="px-2 py-1.5 text-xs">
                    {l.ultimoApontamento === null ? (
                      <span className="text-red-300">nenhum no período</span>
                    ) : (
                      <span className={alerta ? "text-red-300" : "text-brand-muted"}>
                        {formatDate(l.ultimoApontamento)} · {l.diasSemApontar === 0 ? "hoje" : `${l.diasSemApontar}d atrás`}
                      </span>
                    )}
                  </td>
                </tr>
              </FragmentoLinha>
            );
          })}
        </tbody>
      </table>
      {linhas.length === 0 && <p className="py-8 text-center text-sm text-brand-muted">Nenhuma pessoa ativa.</p>}
    </section>
  );
}

function FragmentoLinha({ cabecalho, colunas, children }: { cabecalho: string | null; colunas: number; children: React.ReactNode }) {
  return (
    <>
      {cabecalho && (
        <tr>
          <td colSpan={colunas} className="px-2 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-brand-muted">{cabecalho}</td>
        </tr>
      )}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------
// 3) Carga em aberto por pessoa
// ---------------------------------------------------------------------

function BlocoCarga({ carga }: { carga: ReturnType<typeof cargaPorPessoa> }) {
  const max = Math.max(1, ...carga.map((c) => c.horasRestantes));
  const media = carga.length ? carga.reduce((a, c) => a + c.horasRestantes, 0) / carga.length : 0;
  return (
    <section className="card p-4">
      <div className="mb-3">
        <h3 className="font-semibold">Carga em aberto</h3>
        <p className="text-xs text-brand-muted">
          Horas estimadas que faltam (estimado − apontado) nas tasks abertas. Média da unidade: <b className="text-white">{media.toFixed(1)}h</b>.
        </p>
      </div>
      <div className="max-h-[28rem] space-y-1.5 overflow-y-auto pr-1">
        {carga.map((c) => (
          <div key={c.pessoa.id} className="grid grid-cols-[10rem_1fr_6.5rem] items-center gap-2 text-sm">
            <span className="truncate" title={c.pessoa.nome}>{c.pessoa.nome}</span>
            <div className="relative h-4 rounded-sm bg-white/5">
              <div className="h-4 rounded-sm bg-brand/60" style={{ width: `${(c.horasRestantes / max) * 100}%` }} />
              <div className="absolute inset-y-0 border-l border-dashed border-white/40" style={{ left: `${(media / max) * 100}%` }} title="Média da unidade" />
            </div>
            <span className="text-right text-xs text-brand-muted">
              <b className="text-white">{c.horasRestantes.toFixed(1)}h</b> · {c.tasksAbertas} tasks
            </span>
          </div>
        ))}
        {carga.length === 0 && <p className="py-6 text-center text-sm text-brand-muted">Nenhuma pessoa ativa.</p>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------
// 4) Exceções — lista de ações
// ---------------------------------------------------------------------

function BlocoExcecoes({ exc }: { exc: ReturnType<typeof excecoes> }) {
  return (
    <section className="card p-4">
      <h3 className="mb-1 font-semibold">Exceções</h3>
      <p className="mb-3 text-xs text-brand-muted">O que pede ação agora. Clica pra abrir a lista.</p>
      <div className="space-y-2">
        <GrupoTasks titulo="Atrasadas há mais de 7 dias" tone="bad" tasks={exc.atrasadas7d} />
        <GrupoTasks titulo="Prorrogadas sem entrega" tone="warn" tasks={exc.prorrogadas} />
        <GrupoTasks titulo="Em aberto sem prazo" tone="warn" tasks={exc.semPrazo} />
        <GrupoTasks titulo="Em aberto sem estimativa" tone="muted" tasks={exc.semEstimativa} />
        <Grupo titulo="Clientes ativos sem task nova há 14 dias" tone="bad" qtd={exc.clientesSemTask.length}>
          {exc.clientesSemTask.map((c) => (
            <li key={c.id} className="flex justify-between gap-2 py-1">
              <span>{c.nome}</span>
              {c.mrr ? <span className="text-brand-muted">{formatBRL(c.mrr)}/mês</span> : null}
            </li>
          ))}
        </Grupo>
      </div>
    </section>
  );
}

const TONE_TEXT = { good: "text-emerald-300", bad: "text-red-300", warn: "text-amber-300", muted: "text-brand-muted" } as const;

function Grupo({ titulo, tone, qtd, children }: { titulo: string; tone: keyof typeof TONE_TEXT; qtd: number; children: React.ReactNode }) {
  return (
    <details className="rounded-md border border-white/5 bg-white/[0.02] px-3 py-2">
      <summary className="flex cursor-pointer list-none items-center justify-between text-sm">
        <span>{titulo}</span>
        <span className={`text-lg font-bold ${qtd ? TONE_TEXT[tone] : "text-emerald-300"}`}>{qtd}</span>
      </summary>
      {qtd > 0 && <ul className="mt-2 max-h-64 divide-y divide-white/5 overflow-y-auto text-xs">{children}</ul>}
    </details>
  );
}

function GrupoTasks({ titulo, tone, tasks }: { titulo: string; tone: keyof typeof TONE_TEXT; tasks: EkyteTask[] }) {
  return (
    <Grupo titulo={titulo} tone={tone} qtd={tasks.length}>
      {tasks.map((t) => (
        <li key={t.id} className="flex items-start justify-between gap-3 py-1">
          <a href={linkTask(t.id)} target="_blank" rel="noopener" className="hover:text-brand">
            {t.title}
            <span className="block text-[10px] text-brand-muted">
              {t.pessoa_nome ?? t.executor ?? "—"} · {t.cliente_nome ?? t.workspace ?? "—"}
            </span>
          </a>
          <span className="whitespace-nowrap text-brand-muted">{t.current_due_date ? formatDate(t.current_due_date.slice(0, 10)) : "sem prazo"}</span>
        </li>
      ))}
    </Grupo>
  );
}

// ---------------------------------------------------------------------
// 5) Horas por cliente × MRR
// ---------------------------------------------------------------------

function BlocoClientes({ linhas }: { linhas: ReturnType<typeof horasPorCliente> }) {
  const [ordem, setOrdem] = useState<"menor_rh" | "mais_horas" | "menos_horas">("menor_rh");
  const ordenadas = useMemo(() => {
    const l = [...linhas];
    if (ordem === "mais_horas") return l.sort((a, b) => b.horas - a.horas);
    if (ordem === "menos_horas") return l.sort((a, b) => a.horas - b.horas);
    // R$/h mais baixo primeiro (muita hora pra pouco MRR); sem hora vai pro fim
    return l.sort((a, b) => (a.reaisPorHora ?? Infinity) - (b.reaisPorHora ?? Infinity));
  }, [linhas, ordem]);
  const mediana = useMemo(() => {
    const v = linhas.map((l) => l.reaisPorHora).filter((x): x is number => x !== null).sort((a, b) => a - b);
    return v.length ? v[Math.floor(v.length / 2)] : null;
  }, [linhas]);

  return (
    <section className="card overflow-x-auto p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold">Horas por cliente × MRR</h3>
          <p className="text-xs text-brand-muted">
            Últimos 30 dias. R$/hora = MRR ÷ horas apontadas.
            {mediana !== null && <> Mediana da unidade: <b className="text-white">{formatBRL(mediana)}/h</b>.</>}
          </p>
        </div>
        <select className="input max-w-[16rem] py-1 text-xs" value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)}>
          <option value="menor_rh">Menor R$/hora primeiro</option>
          <option value="mais_horas">Mais horas primeiro</option>
          <option value="menos_horas">Menos horas primeiro</option>
        </select>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
            <th className="px-2 py-2">Cliente</th>
            <th className="px-2 py-2 text-right">MRR</th>
            <th className="px-2 py-2 text-right">Horas</th>
            <th className="px-2 py-2 text-right">R$/hora</th>
          </tr>
        </thead>
        <tbody>
          {ordenadas.map((l) => {
            const tone = l.reaisPorHora === null || mediana === null ? "" :
              l.reaisPorHora < mediana / 2 ? "text-red-300" : l.reaisPorHora > mediana * 2 ? "text-amber-300" : "";
            return (
              <tr key={l.cliente.id} className="border-b border-white/5 last:border-0">
                <td className="px-2 py-1.5">{l.cliente.nome}</td>
                <td className="px-2 py-1.5 text-right text-brand-muted">{l.cliente.mrr ? formatBRL(l.cliente.mrr) : "—"}</td>
                <td className={`px-2 py-1.5 text-right ${l.horas < 1 ? "text-red-300" : ""}`}>{l.horas.toFixed(1)}h</td>
                <td className={`px-2 py-1.5 text-right font-medium ${tone}`}>{l.reaisPorHora === null ? "—" : formatBRL(l.reaisPorHora)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {linhas.length === 0 && <p className="py-8 text-center text-sm text-brand-muted">Nenhum cliente ativo.</p>}
      <p className="mt-2 text-[10px] text-brand-muted">
        Vermelho: menos da metade da mediana de R$/hora (muita hora pra pouco MRR) ou menos de 1h no mês. Amarelo: mais que o dobro da mediana (pouca atenção).
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------

function Mini({ label, value, tone, delta, deltaSufixo }: {
  label: string; value: number | string; tone?: "good" | "bad" | "warn"; delta?: number | null; deltaSufixo?: string;
}) {
  const color = tone ? TONE_TEXT[tone] : "text-white";
  return (
    <div className="rounded-md border border-white/5 bg-white/5 p-2">
      <p className="text-[10px] text-brand-muted">{label}</p>
      <p className={`text-lg font-bold ${color}`}>
        {value}
        {delta !== undefined && delta !== null && Math.abs(delta) >= 0.05 && (
          <span className={`ml-1.5 text-xs font-medium ${delta > 0 ? "text-emerald-300" : "text-red-300"}`}>
            {delta > 0 ? "↑" : "↓"} {Math.abs(delta).toFixed(deltaSufixo === "pp" ? 0 : 1)}{deltaSufixo}
          </span>
        )}
      </p>
    </div>
  );
}
