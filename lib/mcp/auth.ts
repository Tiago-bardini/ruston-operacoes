// =====================================================================
// MCP — quem está chamando
// O token pessoal (gerado em /conexao-ia) vira uma sessão REAL da pessoa no
// Supabase. Assim valem as mesmas regras do painel (RLS) e o Log de alterações
// grava o e-mail dela, e não "sistema".
// =====================================================================

import { createHash, randomBytes } from "crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type PapelMcp = "gerente" | "coordenador" | "gestor";

export type UsuarioMcp = {
  email: string;
  papel: PapelMcp;
  squadId: string | null;       // null = vê todos os squads
  supabase: SupabaseClient;     // cliente autenticado COMO a pessoa
};

const SB_URL = () => process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SB_ANON = () => process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export function servico(): SupabaseClient {
  return createClient(SB_URL(), process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

export function novoToken(): string {
  return "rst_" + randomBytes(24).toString("base64url");
}

/** Cargos de Pessoas que podem usar o MCP mesmo com perfil "investidor". */
const CARGOS_LIBERADOS = ["gestor_projetos", "coordenador", "gerente"];

/** Confere se o e-mail pode usar o MCP e com qual papel. */
export async function papelDoEmail(sb: SupabaseClient, email: string): Promise<{ papel: PapelMcp; squadId: string | null } | null> {
  const { data } = await sb.from("ruston_usuario_perfil")
    .select("perfil, ativo, squad_id, pessoa:ruston_pessoas(cargo, squad_id)")
    .ilike("email", email).maybeSingle();
  if (!data || data.ativo === false) return null;
  const pessoa = (data as any).pessoa as { cargo?: string; squad_id?: string | null } | null;
  if (data.perfil === "gerente") return { papel: "gerente", squadId: null };
  if (data.perfil === "coordenador") return { papel: "coordenador", squadId: data.squad_id ?? pessoa?.squad_id ?? null };
  if (pessoa?.cargo && CARGOS_LIBERADOS.includes(pessoa.cargo)) {
    return { papel: "gestor", squadId: data.squad_id ?? pessoa.squad_id ?? null };
  }
  return null;
}

// Sessões por e-mail, reaproveitadas enquanto a instância estiver quente
const sessoes = new Map<string, { access: string; expira: number }>();

async function tokenDeAcesso(sb: SupabaseClient, email: string): Promise<string> {
  const cache = sessoes.get(email);
  if (cache && cache.expira - Date.now() > 5 * 60_000) return cache.access;

  const { data: link, error: e1 } = await sb.auth.admin.generateLink({ type: "magiclink", email });
  if (e1 || !link?.properties?.hashed_token) {
    throw new Error(`Não consegui abrir a sessão de ${email}. Entre no sistema com esse e-mail ao menos uma vez e gere o token de novo. (${e1?.message ?? "sem link"})`);
  }

  const anon = createClient(SB_URL(), SB_ANON(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: v, error: e2 } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: link.properties.hashed_token });
  if (e2 || !v.session) throw new Error("Não consegui abrir a sessão: " + (e2?.message ?? "sem sessão"));

  sessoes.set(email, { access: v.session.access_token, expira: (v.session.expires_at ?? 0) * 1000 });
  return v.session.access_token;
}

/** Token do conector → usuário autenticado. Lança erro com mensagem amigável. */
export async function autenticarMcp(token: string | null): Promise<UsuarioMcp> {
  if (!token) throw new Error("Token ausente. Gere o seu em Conexão IA, no sistema.");
  const sb = servico();
  const { data: t } = await sb.from("ruston_mcp_tokens")
    .select("id, email, revogado_em").eq("token_hash", hashToken(token)).maybeSingle();
  if (!t || t.revogado_em) throw new Error("Token inválido ou revogado. Gere outro em Conexão IA.");

  const acesso = await papelDoEmail(sb, t.email);
  if (!acesso) throw new Error("Seu usuário não tem acesso ao MCP (só Gerente, Coordenador e Gestor de Projetos).");

  sb.from("ruston_mcp_tokens").update({ ultimo_uso_em: new Date().toISOString() }).eq("id", t.id).then(() => {});

  const access = await tokenDeAcesso(sb, t.email.toLowerCase());
  const supabase = createClient(SB_URL(), SB_ANON(), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${access}` } },
  });
  return { email: t.email.toLowerCase(), ...acesso, supabase };
}
