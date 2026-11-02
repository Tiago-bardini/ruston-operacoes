import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { calcularNota, formularioDe, perguntaVisivel, validarRespostas, type TipoPesquisa } from "@/lib/pesquisas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rota pública: o cliente responde sem login pelo link /p/<token>.
// O token é a única chave; a rota só lê/grava a pesquisa daquele token.

function sb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

const tokenValido = (t: string) => /^[a-f0-9]{8,32}$/.test(t);

async function carregar(token: string) {
  const supabase = sb();
  if (!supabase) return { erro: "Serviço indisponível", status: 500 } as const;
  if (!tokenValido(token)) return { erro: "Pesquisa não encontrada", status: 404 } as const;
  const { data } = await supabase.from("ruston_pesquisas")
    .select("id, cliente_id, tipo, semana_ee, respondida_em, cancelada")
    .eq("token", token).maybeSingle();
  if (!data || data.cancelada) return { erro: "Pesquisa não encontrada", status: 404 } as const;
  return { supabase, pesquisa: data } as const;
}

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const r = await carregar(params.token);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: r.status });
  const { supabase, pesquisa } = r;
  const { data: cliente } = await supabase.from("ruston_clientes").select("nome").eq("id", pesquisa.cliente_id).maybeSingle();
  return NextResponse.json({
    cliente: cliente?.nome ?? "",
    respondida: !!pesquisa.respondida_em,
    formulario: formularioDe(pesquisa.tipo as TipoPesquisa, pesquisa.semana_ee),
  });
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const r = await carregar(params.token);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: r.status });
  const { supabase, pesquisa } = r;
  if (pesquisa.respondida_em) return NextResponse.json({ error: "Esta pesquisa já foi respondida. Obrigado!" }, { status: 409 });

  const body = await req.json().catch(() => null);
  const enviadas = body?.respostas;
  if (!enviadas || typeof enviadas !== "object" || Array.isArray(enviadas)) {
    return NextResponse.json({ error: "Respostas inválidas" }, { status: 400 });
  }
  const f = formularioDe(pesquisa.tipo as TipoPesquisa, pesquisa.semana_ee);
  // Só guarda o que é pergunta deste formulário (e visível)
  const respostas: Record<string, unknown> = {};
  for (const p of f.perguntas) {
    if (p.id in enviadas && perguntaVisivel(p, enviadas)) respostas[p.id] = enviadas[p.id];
  }
  const erro = validarRespostas(f, respostas);
  if (erro) return NextResponse.json({ error: erro }, { status: 400 });

  const { data, error } = await supabase.from("ruston_pesquisas")
    .update({ respostas, nota: calcularNota(f, respostas), respondida_em: new Date().toISOString() })
    .eq("id", pesquisa.id).is("respondida_em", null)
    .select("id");
  if (error) return NextResponse.json({ error: "Não foi possível salvar, tente de novo" }, { status: 500 });
  if (!data?.length) return NextResponse.json({ error: "Esta pesquisa já foi respondida. Obrigado!" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
