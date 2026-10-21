import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

// Proteção das rotas /api — o middleware não passa por elas, então cada rota
// chama o guard que faz sentido pra ela. Retorna uma resposta de erro, ou null se liberado.

/** Rotas chamadas pelo painel (navegador): exige usuário logado. */
export async function exigirUsuario(): Promise<NextResponse | null> {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Não autenticado" }, { status: 401 });
  return null;
}

/** Rotas de cron (GitHub Actions / Vercel Cron): exige header
 *  `Authorization: Bearer <CRON_SECRET>`. A Vercel Cron envia esse header sozinha
 *  quando a env CRON_SECRET existe. Enquanto CRON_SECRET não estiver configurada,
 *  libera (pra não derrubar os crons antes de cadastrar o segredo). */
export function exigirCron(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.warn("[apiAuth] CRON_SECRET não configurada — rota de cron sem proteção");
    return null;
  }
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return null;
}

/** Webhook da Z-API: exige ?token=<ZAPI_WEBHOOK_TOKEN> na URL cadastrada na Z-API.
 *  Enquanto ZAPI_WEBHOOK_TOKEN não estiver configurada, libera. */
export function exigirTokenWebhook(req: Request): NextResponse | null {
  const token = process.env.ZAPI_WEBHOOK_TOKEN;
  if (!token) {
    console.warn("[apiAuth] ZAPI_WEBHOOK_TOKEN não configurada — webhook sem proteção");
    return null;
  }
  if (new URL(req.url).searchParams.get("token") !== token) {
    return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
  }
  return null;
}
