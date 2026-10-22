// =====================================================================
// REUNIÕES DO GOOGLE MEET — identificação do cliente e análise
// =====================================================================
// O Apps Script (integracoes/google-apps-script/reunioes.gs) manda cada reunião
// que terminou com a transcrição. Aqui:
//   1) identificamos o cliente (nome no título ou domínio/e-mail já visto antes)
//   2) marcamos se é interna (só gente da casa)
//   3) a análise com IA roda depois (cron ou botão), para a importação ser rápida
// =====================================================================

import type { SupabaseClient } from "@supabase/supabase-js";
import { chamarClaude, colunasDaAnalise, promptReuniao, type AnaliseReuniao } from "@/lib/analiseIA";

// Domínios do time. REUNIOES_DOMINIOS_INTERNOS="v4company.com,rustonassessoria.com"
export function dominiosInternos(): string[] {
  return (process.env.REUNIOES_DOMINIOS_INTERNOS ?? "v4company.com,rustonassessoria.com")
    .split(",").map((d) => d.trim().toLowerCase()).filter(Boolean);
}

// E-mails pessoais não identificam empresa: para eles só vale o e-mail exato
const DOMINIOS_GENERICOS = new Set([
  "gmail.com", "googlemail.com", "hotmail.com", "outlook.com", "live.com", "yahoo.com",
  "yahoo.com.br", "icloud.com", "uol.com.br", "bol.com.br", "terra.com.br", "msn.com",
]);

export function normalizar(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, " ").trim();
}

const dominio = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

type ClienteBase = { id: string; nome: string };

/** Cliente cujo nome aparece no título (palavras inteiras). O nome mais longo ganha. */
export function clientePorTitulo(titulo: string, clientes: ClienteBase[]): ClienteBase | null {
  const t = ` ${normalizar(titulo)} `;
  let melhor: ClienteBase | null = null;
  let tamanho = 0;
  for (const c of clientes) {
    const n = normalizar(c.nome);
    if (n.length < 3) continue;
    if (t.includes(` ${n} `) && n.length > tamanho) { melhor = c; tamanho = n.length; }
  }
  return melhor;
}

/** Cliente de reuniões anteriores que tiveram o mesmo convidado externo
 *  (mesmo domínio de empresa, ou o mesmo e-mail se for gmail etc.). */
async function clientePorParticipantes(supabase: SupabaseClient, externos: string[]): Promise<string | null> {
  if (externos.length === 0) return null;
  const { data } = await supabase.from("ruston_reunioes_cliente")
    .select("cliente_id, participantes")
    .not("cliente_id", "is", null)
    .not("participantes", "is", null)
    .order("data_reuniao", { ascending: false })
    .limit(2000);

  const votos = new Map<string, number>();
  for (const r of data ?? []) {
    const anteriores: string[] = (r.participantes ?? []).map((e: string) => e.toLowerCase());
    const bate = externos.some((e) => {
      const d = dominio(e);
      return DOMINIOS_GENERICOS.has(d) ? anteriores.includes(e) : anteriores.some((a) => dominio(a) === d);
    });
    if (bate) votos.set(r.cliente_id, (votos.get(r.cliente_id) ?? 0) + 1);
  }
  let melhor: string | null = null;
  let max = 0;
  votos.forEach((v, id) => { if (v > max) { melhor = id; max = v; } });
  return melhor;
}

export type ReuniaoRecebida = {
  event_id: string;
  titulo: string;
  inicio: string;          // ISO
  fim?: string;            // ISO
  participantes: string[]; // e-mails
  transcricao: string;
};

export type ResultadoImport =
  | { status: "ja_existia" | "ignorada_interna_sem_cliente" | "transcricao_curta" }
  | { status: "importada"; reuniao_id: string; cliente: string | null; interna: boolean };

export async function importarReuniao(supabase: SupabaseClient, r: ReuniaoRecebida): Promise<ResultadoImport> {
  if (!r.transcricao || r.transcricao.trim().length < 200) return { status: "transcricao_curta" };

  const { data: existente } = await supabase.from("ruston_reunioes_cliente")
    .select("id").eq("google_event_id", r.event_id).maybeSingle();
  if (existente) return { status: "ja_existia" };

  const internos = dominiosInternos();
  const participantes = Array.from(new Set((r.participantes ?? []).map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"))));
  const externos = participantes.filter((e) => !internos.includes(dominio(e)));
  const interna = externos.length === 0;

  const { data: clientes } = await supabase.from("ruston_clientes")
    .select("id, nome").eq("ativo", true);
  const lista = (clientes ?? []) as ClienteBase[];

  let cliente = clientePorTitulo(r.titulo ?? "", lista);
  if (!cliente) {
    const id = await clientePorParticipantes(supabase, externos);
    cliente = lista.find((c) => c.id === id) ?? null;
  }

  // Reunião só do time e sem cliente no título (1:1, daily...): não é de cliente, não guarda
  if (interna && !cliente) return { status: "ignorada_interna_sem_cliente" };

  const inicio = new Date(r.inicio);
  const fim = r.fim ? new Date(r.fim) : null;
  // Data e hora no fuso de Brasília
  const local = new Date(inicio.getTime() - 3 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase.from("ruston_reunioes_cliente").insert({
    cliente_id: cliente?.id ?? null,
    google_event_id: r.event_id,
    origem: "google_meet",
    titulo: r.titulo,
    interna,
    participantes,
    tipo_reuniao: "periodica",
    data_reuniao: local.slice(0, 10),
    hora: local.slice(11, 16),
    duracao_minutos: fim ? Math.round((fim.getTime() - inicio.getTime()) / 60000) : null,
    presentes: participantes.join(", "),
    realizada: true,
    transcricao: r.transcricao.slice(0, 400000),
  }).select("id").single();

  if (error) throw new Error(error.message);
  return { status: "importada", reuniao_id: data.id, cliente: cliente?.nome ?? null, interna };
}

/** Roda a IA numa reunião já importada que tenha cliente e transcrição. */
export async function analisarReuniao(supabase: SupabaseClient, reuniaoId: string, anthropicKey: string) {
  const { data: r, error } = await supabase.from("ruston_reunioes_cliente")
    .select("id, titulo, interna, transcricao, cliente_id, ruston_clientes(nome)")
    .eq("id", reuniaoId).single();
  if (error || !r) throw new Error(error?.message ?? "reunião não encontrada");
  if (!r.cliente_id) throw new Error("reunião sem cliente vinculado");
  if (!r.transcricao) throw new Error("reunião sem transcrição");

  const nome = (r as any).ruston_clientes?.nome ?? "cliente";
  const { json, tokens_entrada, tokens_saida } = await chamarClaude(
    promptReuniao({ cliente: nome, titulo: r.titulo ?? undefined, interna: r.interna, transcricao: r.transcricao }),
    anthropicKey,
  );

  const { error: upErr } = await supabase.from("ruston_reunioes_cliente")
    .update(colunasDaAnalise(json as AnaliseReuniao, { tokens_entrada, tokens_saida }))
    .eq("id", reuniaoId);
  if (upErr) throw new Error(upErr.message);
}
