// =====================================================================
// eKyte — dados e cálculos da aba "Visão Gerencial"
// =====================================================================
// Horas apontadas vêm de ruston_ekyte_apontamentos_dashboard (apontamentos
// reais por dia, migration 20261019120000_ekyte_visao_gerencial.sql).
// Se a view ainda não existir no banco, cai num FALLBACK aproximado:
// actual_time da task (tempo TOTAL dela) atribuído ao dia da conclusão.
// =====================================================================

import type { SupabaseClient } from "@supabase/supabase-js";

export type EkyteTask = {
  id: number;
  title: string | null;
  executor: string | null;
  executor_email: string | null;
  executor_id: string | null;
  workspace: string | null;
  project: string | null;
  phase: string | null;
  current_due_date: string | null;
  original_due_date: string | null;
  resolved_date: string | null;
  creation_date: string | null;
  actual_time: number | null;
  estimated_time: number | null;
  esta_atrasada: boolean;
  foi_prorrogada: boolean;
  cliente_nome: string | null;
  pessoa_nome: string | null;
  pessoa_id: string | null;
  cliente_id: string | null;
  pessoa_ativa: boolean | null;
};

export type PessoaEkyte = { id: string; nome: string; cargo: string | null; squad_id: string | null; ativo: boolean };
export type SquadEkyte = { id: string; nome: string };
export type ClienteEkyte = { id: string; nome: string; mrr: number | null; squad_id: string | null };

/** Um apontamento (ou, no fallback, uma task concluída) já ligado a pessoa/cliente */
export type Apontamento = { data: string; minutos: number; pessoa_id: string | null; cliente_id: string | null };

export type DadosGerenciais = {
  apontamentos: Apontamento[];
  clientes: ClienteEkyte[];
  /** "real" = apontamentos do eKyte; "aproximada" = fallback com actual_time */
  fonteHoras: "real" | "aproximada";
};

const DIA = 86400000;

export function linkTask(id: number): string {
  return `https://app.ekyte.com/#/tasks/list/${id}/edit`;
}

/** "YYYY-MM-DD" no fuso local */
export function diaIso(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Segunda-feira (00:00 local) da semana que contém a data */
export function segundaDaSemana(d: Date): Date {
  const s = new Date(d);
  s.setHours(0, 0, 0, 0);
  s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
  return s;
}

export function diasEntre(a: Date, b: Date): number {
  return Math.floor((b.getTime() - a.getTime()) / DIA);
}

function apontamentosFallback(tasks: EkyteTask[]): Apontamento[] {
  return tasks
    .filter((t) => t.resolved_date && (t.actual_time ?? 0) > 0)
    .map((t) => ({
      data: t.resolved_date!.slice(0, 10),
      minutos: t.actual_time ?? 0,
      pessoa_id: t.pessoa_id,
      cliente_id: t.cliente_id,
    }));
}

/** Tabela/view inexistente (Postgres 42P01 ou cache de schema do PostgREST) */
function relacaoInexistente(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === "42P01" || error.code === "PGRST205" || /does not exist|schema cache/i.test(error.message ?? "");
}

export async function carregarDadosGerenciais(supabase: SupabaseClient, tasks: EkyteTask[]): Promise<DadosGerenciais> {
  const desde = diaIso(new Date(Date.now() - 120 * DIA));
  const [{ data: ap, error }, { data: cl }] = await Promise.all([
    supabase.from("ruston_ekyte_apontamentos_dashboard")
      .select("data,minutos,pessoa_id,cliente_id")
      .gte("data", desde)
      .limit(100000),
    supabase.from("ruston_clientes").select("id,nome,mrr,squad_id").eq("ativo", true).order("nome"),
  ]);

  const clientes = (cl as ClienteEkyte[] | null) ?? [];
  if (error && relacaoInexistente(error)) {
    return { apontamentos: apontamentosFallback(tasks), clientes, fonteHoras: "aproximada" };
  }
  if (error) throw new Error(error.message);
  return { apontamentos: (ap as Apontamento[] | null) ?? [], clientes, fonteHoras: "real" };
}

// ---------------------------------------------------------------------
// Cálculos
// ---------------------------------------------------------------------

export type Intervalo = { ini: Date; fim: Date };

/** Mesmo tamanho de janela, imediatamente antes */
export function intervaloAnterior({ ini, fim }: Intervalo): Intervalo {
  const dur = fim.getTime() - ini.getTime();
  return { ini: new Date(ini.getTime() - dur - 1), fim: new Date(ini.getTime() - 1) };
}

function dentro(iso: string | null, { ini, fim }: Intervalo): boolean {
  if (!iso) return false;
  const d = new Date(iso.length === 10 ? iso + "T12:00:00" : iso);
  return d >= ini && d <= fim;
}

export function minutosNoIntervalo(aps: Apontamento[], intervalo: Intervalo, filtro?: (a: Apontamento) => boolean): number {
  return aps.reduce((acc, a) => (dentro(a.data, intervalo) && (!filtro || filtro(a)) ? acc + a.minutos : acc), 0);
}

export type SaudeSquad = {
  squad_id: string;
  nome: string;
  pessoas: number;
  concluidas: number;
  noPrazoPct: number | null;
  noPrazoPctAnterior: number | null;
  atrasadasAbertas: number;
  idadeMediaAtrasadas: number;
  horas: number;
  horasAnterior: number;
};

function pctNoPrazo(tasks: EkyteTask[], intervalo: Intervalo): { concluidas: number; pct: number | null } {
  const concl = tasks.filter((t) => dentro(t.resolved_date, intervalo));
  const comPrazo = concl.filter((t) => t.current_due_date);
  const noPrazo = comPrazo.filter((t) => t.resolved_date!.slice(0, 10) <= t.current_due_date!.slice(0, 10));
  return { concluidas: concl.length, pct: comPrazo.length ? (noPrazo.length / comPrazo.length) * 100 : null };
}

export function saudePorSquad(
  tasks: EkyteTask[], aps: Apontamento[], pessoas: PessoaEkyte[], squads: SquadEkyte[],
  intervalo: Intervalo, hoje: Date,
): SaudeSquad[] {
  const anterior = intervaloAnterior(intervalo);
  const grupos = [...squads.map((s) => ({ id: s.id, nome: s.nome })), { id: "sem_squad", nome: "Sem squad" }];

  return grupos.map((g) => {
    const ids = new Set(pessoas.filter((p) => (p.squad_id ?? "sem_squad") === g.id).map((p) => p.id));
    const ts = tasks.filter((t) => t.pessoa_id && ids.has(t.pessoa_id));
    const atual = pctNoPrazo(ts, intervalo);
    const ant = pctNoPrazo(ts, anterior);
    const atrasadas = ts.filter((t) => t.esta_atrasada && !t.resolved_date && t.current_due_date);
    const idade = atrasadas.length
      ? atrasadas.reduce((acc, t) => acc + diasEntre(new Date(t.current_due_date!), hoje), 0) / atrasadas.length
      : 0;
    const daSquad = (a: Apontamento) => !!a.pessoa_id && ids.has(a.pessoa_id);
    return {
      squad_id: g.id,
      nome: g.nome,
      pessoas: ids.size,
      concluidas: atual.concluidas,
      noPrazoPct: atual.pct,
      noPrazoPctAnterior: ant.pct,
      atrasadasAbertas: atrasadas.length,
      idadeMediaAtrasadas: idade,
      horas: minutosNoIntervalo(aps, intervalo, daSquad) / 60,
      horasAnterior: minutosNoIntervalo(aps, anterior, daSquad) / 60,
    };
  }).filter((s) => s.pessoas > 0);
}

export type LinhaHeatmap = {
  pessoa: PessoaEkyte;
  squad_nome: string;
  /** minutos por semana, na ordem de `semanas` (mais antiga → atual) */
  minutos: number[];
  ultimoApontamento: string | null;
  diasSemApontar: number | null;
};

export function heatmapApontamentos(
  aps: Apontamento[], pessoas: PessoaEkyte[], squads: SquadEkyte[], hoje: Date, nSemanas = 8,
): { semanas: Date[]; linhas: LinhaHeatmap[] } {
  const atual = segundaDaSemana(hoje);
  const semanas = Array.from({ length: nSemanas }, (_, i) => new Date(atual.getTime() - (nSemanas - 1 - i) * 7 * DIA));
  const idxSemana = new Map(semanas.map((s, i) => [diaIso(s), i]));
  const squadNome = new Map(squads.map((s) => [s.id, s.nome]));

  const porPessoa = new Map<string, { minutos: number[]; ultimo: string | null }>();
  pessoas.forEach((p) => porPessoa.set(p.id, { minutos: Array(nSemanas).fill(0), ultimo: null }));
  aps.forEach((a) => {
    if (!a.pessoa_id || !a.minutos) return;
    const reg = porPessoa.get(a.pessoa_id);
    if (!reg) return;
    const dia = a.data.slice(0, 10);
    if (!reg.ultimo || dia > reg.ultimo) reg.ultimo = dia;
    const i = idxSemana.get(diaIso(segundaDaSemana(new Date(dia + "T12:00:00"))));
    if (i !== undefined) reg.minutos[i] += a.minutos;
  });

  const linhas = pessoas.map((p) => {
    const reg = porPessoa.get(p.id)!;
    return {
      pessoa: p,
      squad_nome: (p.squad_id && squadNome.get(p.squad_id)) || "Sem squad",
      minutos: reg.minutos,
      ultimoApontamento: reg.ultimo,
      diasSemApontar: reg.ultimo ? diasEntre(new Date(reg.ultimo + "T12:00:00"), hoje) : null,
    };
  });
  // Agrupa por squad ("Sem squad" por último) e ordena por nome dentro do grupo
  const ordemSquad = (n: string) => (n === "Sem squad" ? "￿" : n);
  linhas.sort((a, b) => ordemSquad(a.squad_nome).localeCompare(ordemSquad(b.squad_nome)) || a.pessoa.nome.localeCompare(b.pessoa.nome));
  return { semanas, linhas };
}

export type LinhaCarga = { pessoa: PessoaEkyte; horasRestantes: number; tasksAbertas: number };

export function cargaPorPessoa(tasks: EkyteTask[], pessoas: PessoaEkyte[]): LinhaCarga[] {
  const map = new Map(pessoas.map((p) => [p.id, { pessoa: p, horasRestantes: 0, tasksAbertas: 0 }]));
  tasks.forEach((t) => {
    if (t.resolved_date || !t.pessoa_id) return;
    const l = map.get(t.pessoa_id);
    if (!l) return;
    l.tasksAbertas += 1;
    l.horasRestantes += Math.max(0, (t.estimated_time ?? 0) - (t.actual_time ?? 0)) / 60;
  });
  return Array.from(map.values()).sort((a, b) => b.horasRestantes - a.horasRestantes || b.tasksAbertas - a.tasksAbertas);
}

export type Excecoes = {
  atrasadas7d: EkyteTask[];
  prorrogadas: EkyteTask[];
  semPrazo: EkyteTask[];
  semEstimativa: EkyteTask[];
  clientesSemTask: ClienteEkyte[];
};

export function excecoes(tasks: EkyteTask[], clientes: ClienteEkyte[], hoje: Date): Excecoes {
  const abertas = tasks.filter((t) => !t.resolved_date);
  const limite7 = new Date(hoje.getTime() - 7 * DIA);
  const limite14 = new Date(hoje.getTime() - 14 * DIA);
  const clientesComTaskRecente = new Set(
    tasks.filter((t) => t.cliente_id && t.creation_date && new Date(t.creation_date) >= limite14).map((t) => t.cliente_id),
  );
  const porPrazo = (a: EkyteTask, b: EkyteTask) => (a.current_due_date ?? "").localeCompare(b.current_due_date ?? "");
  return {
    atrasadas7d: abertas.filter((t) => t.current_due_date && new Date(t.current_due_date) < limite7).sort(porPrazo),
    prorrogadas: abertas.filter((t) => t.foi_prorrogada).sort(porPrazo),
    semPrazo: abertas.filter((t) => !t.current_due_date),
    semEstimativa: abertas.filter((t) => !t.estimated_time),
    clientesSemTask: clientes.filter((c) => !clientesComTaskRecente.has(c.id)),
  };
}

export type LinhaCliente = { cliente: ClienteEkyte; horas: number; reaisPorHora: number | null };

export function horasPorCliente(aps: Apontamento[], clientes: ClienteEkyte[], intervalo: Intervalo): LinhaCliente[] {
  const min = new Map<string, number>();
  aps.forEach((a) => {
    if (a.cliente_id && dentro(a.data, intervalo)) min.set(a.cliente_id, (min.get(a.cliente_id) ?? 0) + a.minutos);
  });
  return clientes.map((c) => {
    const horas = (min.get(c.id) ?? 0) / 60;
    return { cliente: c, horas, reaisPorHora: horas > 0 && c.mrr ? c.mrr / horas : null };
  });
}
