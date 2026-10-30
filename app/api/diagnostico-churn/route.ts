import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createClient as createClientUsuario } from "@/lib/supabase/server";
import { avaliarRiscoChurn, carregarDadosRadar } from "@/lib/radarChurn";

export const runtime = "nodejs";
export const maxDuration = 60;

// Econômico de propósito: modelo pequeno, resposta curta e a IA lê só um resumo
// do que já foi analisado (sinais + resumos), nunca transcrição nem mensagens.
// Se o modelo novo não estiver liberado na conta, cai pro Haiku anterior
const MODELOS = ["claude-haiku-5-5", "claude-haiku-4-5"];
const MAX_TOKENS = 700;

const corta = (s: string | null | undefined, n: number) => (s ? (s.length > n ? s.slice(0, n) + "…" : s) : "");

export async function POST(req: Request) {
  const sbUsuario = createClientUsuario();
  const { data: { user } } = await sbUsuario.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });

  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase nao configurado" }, { status: 500 });
  if (!ANTHROPIC_KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY nao configurada" }, { status: 500 });

  const { cliente_id, forcar } = await req.json().catch(() => ({}));
  if (!cliente_id) return NextResponse.json({ error: "cliente_id obrigatorio" }, { status: 400 });

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });
  const [dados] = await carregarDadosRadar(supabase, cliente_id);
  if (!dados) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });
  const av = avaliarRiscoChurn(dados);

  // Cache: sem dado novo desde o último diagnóstico, devolve o salvo (custo zero)
  const { data: salvo } = await supabase.from("ruston_diagnostico_churn").select("*").eq("cliente_id", cliente_id).maybeSingle();
  if (salvo && !forcar && (salvo.dados_ate ?? "") >= (av.ultimoDado ?? "")) {
    return NextResponse.json({ ...salvo, cache: true });
  }

  const d = dados;
  const linhas = [
    `Cliente: ${d.cliente.nome} | MRR R$ ${Number(d.cliente.mrr ?? 0).toFixed(0)} | etapa ${d.cliente.etapa}`,
    `Risco calculado: ${av.risco}/100 (${av.nivel})`,
    `Sinais:`,
    ...av.sinais.slice(0, 8).map((s) => `- [${s.fonte}] ${corta(s.texto, 160)}`),
  ];
  const fca = d.fcas.find((f) => f.fato || f.causa);
  if (fca) linhas.push(`Último FCA (${fca.data_referencia}): fato: ${corta(fca.fato, 250)} | causa: ${corta(fca.causa, 200)}`);
  d.whatsapp.filter((w) => w.resumo_curto).slice(0, 2).forEach((w) => linhas.push(`WhatsApp: ${corta(w.resumo_curto, 300)}`));
  d.reunioes.filter((r) => r.resumo).slice(0, 2).forEach((r) => linhas.push(`Reunião ${r.data_reuniao}: ${corta(r.resumo, 300)}`));
  // O que o time já fez: a IA não deve sugerir de novo o que já foi tentado
  const { data: tratativas } = await supabase
    .from("ruston_tratativas_churn")
    .select("data_acao, tipo, descricao, resultado, proximo_passo")
    .eq("cliente_id", cliente_id)
    .order("data_acao", { ascending: false })
    .limit(5);
  if (tratativas?.length) {
    linhas.push(`Tratativas já realizadas pelo time (mais recente primeiro):`);
    tratativas.forEach((t) => linhas.push(
      `- ${t.data_acao} [${t.tipo}, resultado: ${t.resultado}] ${corta(t.descricao, 200)}${t.proximo_passo ? ` | próximo passo: ${corta(t.proximo_passo, 100)}` : ""}`
    ));
  }
  if (av.acoes.length) {
    linhas.push(`Ações já sugeridas:`);
    av.acoes.slice(0, 4).forEach((a) => linhas.push(`- ${corta(a.ponto, 80)} → ${corta(a.sugestao, 120)}`));
  }

  const prompt = `Você é o head de Customer Success da agência Ruston (V4 Company). Com base nos dados abaixo, diga em português direto por que este cliente pode cancelar e o que fazer.

${linhas.join("\n")}

Responda APENAS um JSON válido:
{"parecer":"2 a 3 frases sobre a situação real do cliente","causa_raiz":"1 frase","acoes":[{"acao":"passo concreto","responsavel":"account | gestor de tráfego | coordenador | gerente","prazo":"ex.: 48h"}]}
Máximo 3 ações, específicas deste cliente, sem repetir texto genérico. Não repita o que já está nas tratativas realizadas: se uma tratativa ficou "sem_efeito", proponha outro caminho; se está "em_andamento", diga o que falta para concluir.`;

  let res: Response | null = null;
  let modelo = MODELOS[0];
  for (modelo of MODELOS) {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: modelo, max_tokens: MAX_TOKENS, temperature: 0.2, messages: [{ role: "user", content: prompt }] }),
    });
    if (res.status !== 404) break;
  }
  if (!res) return NextResponse.json({ error: "IA indisponível" }, { status: 502 });
  if (!res.ok) return NextResponse.json({ error: `IA erro ${res.status}: ${(await res.text()).slice(0, 300)}` }, { status: 502 });
  const out = await res.json();
  const texto: string = out.content?.[0]?.text ?? "";
  let diagnostico: unknown;
  try {
    diagnostico = JSON.parse(texto.replace(/^```json\s*/i, "").replace(/\s*```\s*$/, "").trim());
  } catch {
    return NextResponse.json({ error: "A IA não devolveu um JSON válido, tente de novo" }, { status: 502 });
  }

  const registro = {
    cliente_id,
    diagnostico,
    risco: av.risco,
    dados_ate: av.ultimoDado,
    gerado_por: user.email ?? null,
    modelo,
    tokens_entrada: out.usage?.input_tokens ?? 0,
    tokens_saida: out.usage?.output_tokens ?? 0,
    gerado_em: new Date().toISOString(),
  };
  const { error } = await supabase.from("ruston_diagnostico_churn").upsert(registro, { onConflict: "cliente_id" });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ...registro, cache: false });
}
