// Radar de Churn: junta FCA + Radar WhatsApp + Reuniões num risco de 0 a 100,
// com os sinais que acenderam o alerta escritos em português. Usa só o que já
// está salvo (sem chamar IA) — a tela e a rota de diagnóstico usam o mesmo cálculo.
import type { SupabaseClient } from "@supabase/supabase-js";

export type FonteRisco = "fca" | "whatsapp" | "reunioes";
export type NivelRisco = "critico" | "atencao" | "saudavel" | "sem_dado";

export interface SinalRisco {
  fonte: FonteRisco;
  texto: string;
  pontos: number;
  grave: boolean;
}

export interface AcaoSugerida {
  ponto: string;
  sugestao: string;
  responsavel: string;
  prioridade: "alta" | "media" | "baixa";
  prazo: string;
  origem: string; // "WhatsApp" | "Reunião 14/10"
}

type Recl = { houve?: boolean; motivos?: string[] } | null;
type Conc = { mencionou?: boolean; detalhe?: string } | null;
type Res = { avaliacao?: string; detalhe?: string } | null;
type Plano = Omit<AcaoSugerida, "origem">[] | null;

export interface DadosClienteRadar {
  cliente: {
    id: string; nome: string; etapa: string; mrr: number | null;
    squad_id: string | null; squad_nome: string | null; account_nome: string | null;
  };
  fcas: { nota_final: number | null; data_referencia: string; fato: string | null; causa: string | null }[]; // mais recente primeiro
  whatsapp: {
    risco_churn: string | null; sentimento: string | null; dias_sem_contato: number | null;
    resumo_curto: string | null; sinais_churn: string[] | null; analise_em: string | null;
    extra: { estresse?: string; reclamacao?: Recl; concorrencia?: Conc; resultado_percebido?: Res; plano_acao?: Plano } | null;
  }[];
  reunioes: {
    data_reuniao: string; risco_churn: string | null; sentimento: string | null; estresse: string | null;
    resumo: string | null; recl: Recl; conc: Conc; res: Res; plano: Plano;
  }[]; // analisadas, mais recente primeiro
  cadencia: { dias_sem_reuniao: number; cadencia_dias: number; ultima_reuniao: string | null } | null;
}

export interface AvaliacaoRisco {
  risco: number;
  nivel: NivelRisco;
  porFonte: Record<FonteRisco, number | null>; // null = fonte sem dado
  fontesEmAlerta: FonteRisco[];
  sinais: SinalRisco[];
  acoes: AcaoSugerida[];
  ultimoDado: string | null; // data do dado mais novo usado (cache do diagnóstico)
}

const MAX_FONTE = 35;
const ALERTA_FONTE = 15;

const dataBR = (iso: string) => {
  const [, m, d] = iso.slice(0, 10).split("-");
  return `${d}/${m}`;
};
const nota = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function avaliarRiscoChurn(d: DadosClienteRadar): AvaliacaoRisco {
  const sinais: SinalRisco[] = [];
  const add = (fonte: FonteRisco, pontos: number, texto: string, grave = pontos >= 15) =>
    sinais.push({ fonte, pontos, texto, grave });

  // ---------- FCA ----------
  let fca: number | null = null;
  const fcas = d.fcas.filter((f) => f.nota_final != null);
  if (fcas.length) {
    fca = 0;
    const atual = fcas[0].nota_final!;
    if (atual < 6) { fca += 25; add("fca", 25, `FCA vermelho: nota ${nota(atual)} (${dataBR(fcas[0].data_referencia)})`); }
    else if (atual < 8) { fca += 10; add("fca", 10, `FCA amarelo: nota ${nota(atual)}`); }
    const anteriores = fcas.slice(1, 4).map((f) => f.nota_final!);
    if (anteriores.length) {
      const media = anteriores.reduce((s, n) => s + n, 0) / anteriores.length;
      const queda = media - atual;
      if (queda >= 1.5) { fca += 10; add("fca", 10, `FCA caiu de ${nota(media)} para ${nota(atual)} nas últimas semanas`, true); }
      else if (queda >= 0.8) { fca += 5; add("fca", 5, `FCA em queda: de ${nota(media)} para ${nota(atual)}`); }
    }
    const dias = (Date.now() - new Date(fcas[0].data_referencia + "T12:00:00").getTime()) / 86400000;
    if (dias > 21) { fca += 3; add("fca", 3, `FCA desatualizado (último em ${dataBR(fcas[0].data_referencia)})`); }
    fca = Math.min(MAX_FONTE, fca);
  }

  // ---------- WhatsApp (pior conversa do cliente) ----------
  let wa: number | null = null;
  if (d.whatsapp.length) {
    wa = 0;
    const ordem = { alto: 3, medio: 2, baixo: 1 } as Record<string, number>;
    const pior = [...d.whatsapp].sort((a, b) => (ordem[b.risco_churn ?? ""] ?? 0) - (ordem[a.risco_churn ?? ""] ?? 0))[0];
    const ex = pior.extra ?? {};
    if (pior.risco_churn === "alto") { wa += 20; add("whatsapp", 20, `WhatsApp com risco de churn ALTO${pior.sinais_churn?.[0] ? `: ${pior.sinais_churn[0]}` : ""}`); }
    else if (pior.risco_churn === "medio") { wa += 8; add("whatsapp", 8, `WhatsApp com risco de churn médio${pior.sinais_churn?.[0] ? `: ${pior.sinais_churn[0]}` : ""}`); }
    if (ex.concorrencia?.mencionou) { wa += 8; add("whatsapp", 8, `Mencionou concorrência no WhatsApp${ex.concorrencia.detalhe ? `: ${ex.concorrencia.detalhe}` : ""}`, true); }
    if (pior.sentimento === "negativo") { wa += 6; add("whatsapp", 6, "Sentimento negativo nas conversas"); }
    if (ex.reclamacao?.houve) { wa += 6; add("whatsapp", 6, `Reclamação no WhatsApp${ex.reclamacao.motivos?.[0] ? `: ${ex.reclamacao.motivos[0]}` : ""}`); }
    if (ex.resultado_percebido?.avaliacao === "insatisfeito") { wa += 6; add("whatsapp", 6, `Insatisfeito com o resultado${ex.resultado_percebido.detalhe ? `: ${ex.resultado_percebido.detalhe}` : ""}`); }
    if (ex.estresse === "alto") { wa += 5; add("whatsapp", 5, "Cliente estressado no WhatsApp"); }
    const dias = Math.min(...d.whatsapp.map((w) => w.dias_sem_contato ?? Infinity));
    if (isFinite(dias)) {
      if (dias > 14) { wa += 8; add("whatsapp", 8, `${dias} dias sem conversa no WhatsApp`); }
      else if (dias > 7) { wa += 4; add("whatsapp", 4, `${dias} dias sem conversa no WhatsApp`); }
    }
    wa = Math.min(MAX_FONTE, wa);
  }

  // ---------- Reuniões ----------
  let re: number | null = null;
  if (d.reunioes.length || d.cadencia) {
    re = 0;
    const ult = d.reunioes[0];
    if (ult) {
      const quando = `reunião de ${dataBR(ult.data_reuniao)}`;
      if (ult.risco_churn === "alto") { re += 20; add("reunioes", 20, `Risco de churn ALTO na ${quando}`); }
      else if (ult.risco_churn === "medio") { re += 8; add("reunioes", 8, `Risco de churn médio na ${quando}`); }
      if (ult.res?.avaliacao === "insatisfeito") { re += 6; add("reunioes", 6, `Insatisfeito com o resultado na ${quando}${ult.res.detalhe ? `: ${ult.res.detalhe}` : ""}`); }
      if (ult.recl?.houve) { re += 5; add("reunioes", 5, `Reclamou na ${quando}${ult.recl.motivos?.[0] ? `: ${ult.recl.motivos[0]}` : ""}`); }
      if (ult.estresse === "alto") { re += 5; add("reunioes", 5, `Cliente estressado na ${quando}`); }
    }
    const comConc = d.reunioes.slice(0, 3).find((r) => r.conc?.mencionou);
    if (comConc) { re += 8; add("reunioes", 8, `Falou em concorrente na reunião de ${dataBR(comConc.data_reuniao)}${comConc.conc?.detalhe ? `: ${comConc.conc.detalhe}` : ""}`, true); }
    const c = d.cadencia;
    if (c) {
      // Muitos clientes ainda não têm reunião no sistema: conta pouco pra não virar ruído
      if (!c.ultima_reuniao) { re += 3; add("reunioes", 3, "Nenhuma reunião registrada no sistema"); }
      else if (c.dias_sem_reuniao >= c.cadencia_dias * 1.5) { re += 8; add("reunioes", 8, `${c.dias_sem_reuniao} dias sem reunião (cadência de ${c.cadencia_dias})`); }
      else if (c.dias_sem_reuniao >= c.cadencia_dias) { re += 4; add("reunioes", 4, `Reunião atrasada: ${c.dias_sem_reuniao} dias (cadência de ${c.cadencia_dias})`); }
    }
    re = Math.min(MAX_FONTE, re);
  }

  // ---------- Junta ----------
  const porFonte = { fca, whatsapp: wa, reunioes: re };
  const fontesEmAlerta = (Object.keys(porFonte) as FonteRisco[]).filter((f) => (porFonte[f] ?? 0) >= ALERTA_FONTE);
  // Duas ou três fontes apontando risco ao mesmo tempo = sinal mais confiável
  const bonus = fontesEmAlerta.length >= 3 ? 15 : fontesEmAlerta.length === 2 ? 10 : 0;
  const temDado = fca != null || wa != null || re != null;
  const risco = Math.min(100, (fca ?? 0) + (wa ?? 0) + (re ?? 0) + bonus);
  // Crítico também quando uma fonte sozinha bate no teto (ex.: FCA 3 em queda, reunião com risco alto)
  const fonteNoTeto = Object.values(porFonte).some((p) => (p ?? 0) >= 30);
  const nivel: NivelRisco = !temDado ? "sem_dado"
    : risco >= 50 || fonteNoTeto ? "critico" : risco >= 25 ? "atencao" : "saudavel";

  // Ações que a IA já sugeriu (WhatsApp e últimas reuniões), prioridade alta primeiro
  const acoes: AcaoSugerida[] = [];
  d.whatsapp.forEach((w) => (w.extra?.plano_acao ?? []).forEach((a) => acoes.push({ ...a, origem: "WhatsApp" })));
  d.reunioes.slice(0, 2).forEach((r) => (r.plano ?? []).forEach((a) => acoes.push({ ...a, origem: `Reunião ${dataBR(r.data_reuniao)}` })));
  const peso = { alta: 0, media: 1, baixa: 2 };
  acoes.sort((a, b) => (peso[a.prioridade] ?? 3) - (peso[b.prioridade] ?? 3));

  const datas = [
    d.fcas[0]?.data_referencia, d.reunioes[0]?.data_reuniao,
    ...d.whatsapp.map((w) => w.analise_em ?? undefined),
  ].filter((x): x is string => !!x).sort();

  return {
    risco, nivel, porFonte, fontesEmAlerta,
    sinais: sinais.sort((a, b) => b.pontos - a.pontos),
    acoes: acoes.slice(0, 5),
    ultimoDado: datas.pop() ?? null,
  };
}

/** Carrega as 3 fontes já agrupadas por cliente. Serve pro navegador e pra rota da API. */
export async function carregarDadosRadar(supabase: SupabaseClient, clienteId?: string): Promise<DadosClienteRadar[]> {
  const desde = new Date(Date.now() - 120 * 86400000).toISOString().slice(0, 10);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const so = (q: any) => (clienteId ? q.eq("cliente_id", clienteId) : q);

  let qCli = supabase.from("ruston_clientes_view")
    .select("id, nome, etapa, mrr, squad_id, squad_nome, account_nome, ativo, churn_realizado")
    .eq("ativo", true);
  if (clienteId) qCli = qCli.eq("id", clienteId);

  const [{ data: cs }, { data: fs }, { data: ws }, { data: ex }, { data: rs }, { data: st }] = await Promise.all([
    qCli,
    so(supabase.from("ruston_fca_view").select("cliente_id, nota_final, data_referencia, fato, causa")
      .gte("data_referencia", desde)).order("data_referencia", { ascending: false }),
    so(supabase.from("ruston_whatsapp_radar_view")
      .select("conversa_id, cliente_id, risco_churn, sentimento, dias_sem_contato, resumo_curto, sinais_churn, analise_em")
      .not("cliente_id", "is", null)).limit(5000),
    so(supabase.from("ruston_whatsapp_analises").select("conversa_id, analise_extra")
      .not("analise_extra", "is", null).gte("criado_em", desde))
      .order("criado_em", { ascending: false }).limit(3000),
    // Só os pedaços da análise da IA que o radar usa (não traz a transcrição)
    so(supabase.from("ruston_reunioes_cliente")
      .select("cliente_id, data_reuniao, risco_churn, sentimento, estresse, resumo, recl:analise_ia->reclamacao, conc:analise_ia->concorrencia, res:analise_ia->resultado_percebido, plano:analise_ia->plano_acao")
      .not("cliente_id", "is", null).not("analisado_em", "is", null).gte("data_reuniao", desde))
      .order("data_reuniao", { ascending: false }).limit(3000),
    so(supabase.from("ruston_reunioes_status").select("cliente_id, dias_sem_reuniao, cadencia_dias, ultima_reuniao")),
  ]);

  const extraPorConversa: Record<string, DadosClienteRadar["whatsapp"][number]["extra"]> = {};
  for (const e of (ex ?? []) as { conversa_id: string; analise_extra: any }[]) {
    if (!extraPorConversa[e.conversa_id]) extraPorConversa[e.conversa_id] = e.analise_extra;
  }
  const agrupar = <T extends { cliente_id: string }>(rows: T[] | null) => {
    const m: Record<string, T[]> = {};
    (rows ?? []).forEach((r) => (m[r.cliente_id] ??= []).push(r));
    return m;
  };
  const fcaMap = agrupar(fs as any[]);
  const waMap = agrupar(ws as any[]);
  const reMap = agrupar(rs as any[]);
  const stMap = Object.fromEntries(((st ?? []) as any[]).map((s) => [s.cliente_id, s]));

  return ((cs ?? []) as any[])
    .filter((c) => !c.churn_realizado && c.etapa !== "cancelado" && c.etapa !== "suspenso")
    .map((c) => ({
      cliente: c,
      fcas: fcaMap[c.id] ?? [],
      whatsapp: (waMap[c.id] ?? []).map((w: any) => ({ ...w, extra: extraPorConversa[w.conversa_id] ?? null })),
      reunioes: reMap[c.id] ?? [],
      cadencia: stMap[c.id] ?? null,
    }));
}
