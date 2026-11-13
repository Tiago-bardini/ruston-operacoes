import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { exigirPerfil } from "@/lib/apiAuth";
import { MODELO_LLM } from "@/lib/analiseIA";
import { FERRAMENTA_PARECER, htmlParaTexto, montarReunioes, promptConferencia, type ParecerEE, type ReuniaoContexto } from "@/lib/conferenciaEE";

export const runtime = "nodejs";
export const maxDuration = 300;

const BUCKET = "ee-conferencias";
const IMAGENS: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" };

/** Conferência de E.E: Gerente, Coordenador e Gestor de Projetos. Recebe o caminho do arquivo já enviado ao Storage. */
export async function POST(req: Request) {
  const negado = await exigirPerfil(["gerente", "coordenador", "gestor_projetos"]);
  if (negado) return negado;

  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const KEY = process.env.ANTHROPIC_API_KEY;
  if (!SB_URL || !SB_SERVICE) return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  if (!KEY) return NextResponse.json({ error: "ANTHROPIC_API_KEY não configurada" }, { status: 500 });
  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  const body = await req.json().catch(() => ({}));
  const clienteId = String(body.cliente_id ?? "");
  const semana = Number(body.semana);
  const arquivoPath = String(body.arquivo_path ?? "");
  const arquivoNome = String(body.arquivo_nome ?? "");
  const observacao = String(body.observacao ?? "");
  const criadoPor = body.criado_por ? String(body.criado_por) : null;
  if (!clienteId || !(semana >= 1 && semana <= 5) || !arquivoPath) {
    return NextResponse.json({ error: "Informe cliente, semana e arquivo" }, { status: 400 });
  }

  // 1) Contexto: cliente, padrão da semana, reuniões e planejamento
  const [{ data: cliente }, { data: padrao }, { data: reunioes }, { data: plan }, { data: pes }] = await Promise.all([
    supabase.from("ruston_clientes").select("nome").eq("id", clienteId).maybeSingle(),
    supabase.from("ruston_ee_padroes").select("texto").eq("semana", semana).maybeSingle(),
    supabase.from("ruston_reunioes_cliente")
      .select("data_reuniao, titulo, transcricao, resumo, decisoes, proximos_passos")
      .eq("cliente_id", clienteId).eq("interna", false)
      .order("data_reuniao", { ascending: true }),
    supabase.from("ruston_cliente_planejamento").select("ponto_equilibrio, forecast").eq("cliente_id", clienteId).maybeSingle(),
    supabase.from("ruston_cliente_pe_mensal").select("ano, mes, dados").eq("cliente_id", clienteId)
      .order("ano", { ascending: false }).order("mes", { ascending: false }).limit(2),
  ]);
  if (!cliente) return NextResponse.json({ error: "Cliente não encontrado" }, { status: 404 });

  const reunioesCtx = (reunioes ?? []) as ReuniaoContexto[];
  const planejamento = [
    plan && Object.keys(plan.ponto_equilibrio ?? {}).length > 0 && `Ponto de equilíbrio: ${JSON.stringify(plan.ponto_equilibrio)}`,
    plan && Object.keys(plan.forecast ?? {}).length > 0 && `Forecast: ${JSON.stringify(plan.forecast)}`,
    ...(pes ?? []).map((p: any) => `PE ${String(p.mes).padStart(2, "0")}/${p.ano}: ${JSON.stringify(p.dados)}`),
  ].filter(Boolean).join("\n").slice(0, 10_000);

  // 2) Material: PDF e imagem vão como anexo (a IA vê os slides); HTML e texto vão como texto
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(arquivoPath);
  if (dlErr || !blob) return NextResponse.json({ error: `Não consegui ler o arquivo: ${dlErr?.message ?? "vazio"}` }, { status: 400 });
  const ext = (arquivoNome.split(".").pop() ?? "").toLowerCase();
  const buf = Buffer.from(await blob.arrayBuffer());

  const anexos: any[] = [];
  let materialTexto: string | undefined;
  if (ext === "pdf") {
    anexos.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") } });
  } else if (IMAGENS[ext]) {
    anexos.push({ type: "image", source: { type: "base64", media_type: IMAGENS[ext], data: buf.toString("base64") } });
  } else if (ext === "html" || ext === "htm") {
    materialTexto = htmlParaTexto(buf.toString("utf8")).slice(0, 150_000);
  } else if (ext === "txt" || ext === "md") {
    materialTexto = buf.toString("utf8").slice(0, 150_000);
  } else {
    return NextResponse.json({ error: "Formato não suportado. Exporte a apresentação em PDF (PowerPoint/Canva/Google Slides: Arquivo → Baixar → PDF)." }, { status: 400 });
  }

  const prompt = promptConferencia({
    cliente: cliente.nome, semana, padrao: padrao?.texto ?? "",
    reunioes: montarReunioes(reunioesCtx), planejamento, observacao, materialTexto,
  });

  // 3) IA
  // Resposta por ferramenta (tool use): a IA preenche um objeto estruturado, sem risco de JSON quebrado
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: MODELO_LLM,
      max_tokens: 16000,
      temperature: 0.2,
      tools: [FERRAMENTA_PARECER],
      tool_choice: { type: "tool", name: FERRAMENTA_PARECER.name },
      messages: [{ role: "user", content: [...anexos, { type: "text", text: prompt + "\n\nEntregue o parecer chamando a ferramenta registrar_parecer (não responda em texto)." }] }],
    }),
  });
  if (!res.ok) return NextResponse.json({ error: `IA erro ${res.status}: ${(await res.text()).slice(0, 400)}` }, { status: 500 });
  const data = await res.json();
  const parecer = data.content?.find((c: any) => c.type === "tool_use")?.input as ParecerEE | undefined;
  // Às vezes a IA devolve uma lista como texto JSON; converte para lista (senão a tela quebra ao abrir o parecer)
  if (parecer) for (const k of ["ajustes", "coerencia", "checklist", "criterios", "pontos_fortes", "perguntas_cliente"]) {
    const v = (parecer as any)[k];
    if (typeof v === "string") { try { (parecer as any)[k] = JSON.parse(v); } catch { (parecer as any)[k] = []; } }
    if (!Array.isArray((parecer as any)[k])) (parecer as any)[k] = [];
  }
  if (!parecer || !parecer.veredito) {
    console.error("[conferencia-ee] resposta sem parecer:", data.stop_reason, JSON.stringify(data.content ?? []).slice(0, 1500));
    const motivo = data.stop_reason === "max_tokens" ? "o parecer ficou maior que o limite" : "a resposta veio sem o parecer";
    return NextResponse.json({ error: `A IA não concluiu (${motivo}). Tente de novo.` }, { status: 500 });
  }

  // 4) Guarda o parecer no histórico do cliente
  const { data: salvo, error: insErr } = await supabase.from("ruston_ee_conferencias").insert({
    cliente_id: clienteId, semana, arquivo_nome: arquivoNome, arquivo_path: arquivoPath, observacao: observacao || null,
    veredito: parecer.veredito, nota: parecer.nota_geral, parecer, reunioes_usadas: reunioesCtx.length,
    modelo: MODELO_LLM, tokens_entrada: data.usage?.input_tokens ?? null, tokens_saida: data.usage?.output_tokens ?? null,
    criado_por: criadoPor,
  }).select("*").single();
  if (insErr) return NextResponse.json({ error: `Parecer gerado, mas não salvou: ${insErr.message}`, parecer }, { status: 500 });

  return NextResponse.json({ ok: true, conferencia: salvo });
}
