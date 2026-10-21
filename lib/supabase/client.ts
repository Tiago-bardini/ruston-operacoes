import { createBrowserClient } from "@supabase/ssr";

export const EVENTO_ERRO_BANCO = "ruston:erro-banco";

// Toda gravação (insert/update/delete/upsert/rpc) que falhar dispara um evento que o
// <AvisoErro /> mostra na tela — assim nenhuma tela "salva" em silêncio quando dá erro.
async function fetchComAviso(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const ehGravacao = method !== "GET" && method !== "HEAD" && url.includes("/rest/v1/") && typeof window !== "undefined";
  let res: Response;
  try {
    res = await fetch(input, init);
  } catch (e) {
    if (ehGravacao) window.dispatchEvent(new CustomEvent(EVENTO_ERRO_BANCO, { detail: "Failed to fetch" }));
    throw e;
  }
  if (!res.ok && ehGravacao) {
    let msg = res.statusText || `HTTP ${res.status}`;
    try {
      const corpo = await res.clone().json();
      msg = corpo?.message ?? msg;
    } catch {}
    window.dispatchEvent(new CustomEvent(EVENTO_ERRO_BANCO, { detail: msg }));
  }
  return res;
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { fetch: fetchComAviso } }
  );
}
