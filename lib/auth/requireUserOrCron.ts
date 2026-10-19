import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export type Disparo = { via: "cron" } | { via: "usuario"; email: string | null };

/** true se a requisição traz "Authorization: Bearer <CRON_SECRET>" (Vercel Cron / GitHub Actions) */
export function isCron(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Protege rotas de /api (o middleware não cobre /api).
 * Aceita o CRON_SECRET ou um usuário logado no Supabase (sessão via cookie).
 * Retorna o disparo ou uma resposta 401 pronta pra devolver.
 */
export async function requireUserOrCron(req: Request): Promise<Disparo | NextResponse> {
  if (isCron(req)) return { via: "cron" };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) return { via: "usuario", email: user.email ?? null };

  return NextResponse.json({ error: "Não autorizado" }, { status: 401 });
}
