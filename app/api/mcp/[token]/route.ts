// =====================================================================
// MCP — servidor para o Claude (conector personalizado)
// Endereço: https://ruston-operacoes.vercel.app/api/mcp/<token pessoal>
// Protocolo MCP via "Streamable HTTP" sem estado: cada POST traz uma
// mensagem JSON-RPC e a resposta volta em JSON.
// =====================================================================

import { NextResponse } from "next/server";
import { autenticarMcp, type UsuarioMcp } from "@/lib/mcp/auth";
import { ferramentasDo } from "@/lib/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCOES =
  "Ruston Operações: sistema da operação (carteira de clientes, FCA, tratativas de churn, planejamento/ROI e pesquisas). " +
  "Fale em português. Antes de qualquer ferramenta que grava (cadastrar_*, salvar_*), mostre ao usuário o resumo do que será gravado e espere ele confirmar. " +
  "Use buscar_clientes quando não tiver certeza do nome do cliente. Nunca invente notas ou números: pergunte o que faltar.";

type Rpc = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: any };

const resposta = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const erro = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

async function tratar(msg: Rpc, usuario: UsuarioMcp) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize": {
      const pedida = params?.protocolVersion;
      return resposta(id, {
        protocolVersion: VERSOES.includes(pedida) ? pedida : VERSOES[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "ruston-operacoes", title: "Ruston Operações", version: "1.0.0" },
        instructions: INSTRUCOES + ` Usuário conectado: ${usuario.email} (${usuario.papel}).`,
      });
    }
    case "ping":
      return resposta(id, {});
    case "tools/list":
      return resposta(id, {
        tools: ferramentasDo(usuario).map(({ name, title, description, inputSchema, annotations }) =>
          ({ name, title, description, inputSchema, annotations })),
      });
    case "tools/call": {
      const f = ferramentasDo(usuario).find((t) => t.name === params?.name);
      if (!f) return erro(id, -32602, `Ferramenta desconhecida ou sem permissão: ${params?.name}`);
      try {
        const out = await f.run(usuario, params?.arguments ?? {});
        return resposta(id, { content: [{ type: "text", text: JSON.stringify(out, null, 2) }], isError: false });
      } catch (e: any) {
        // Erro de negócio volta como resultado, para a IA ler e corrigir
        return resposta(id, { content: [{ type: "text", text: `Erro: ${e?.message ?? e}` }], isError: true });
      }
    }
    case "resources/list":
      return resposta(id, { resources: [] });
    case "prompts/list":
      return resposta(id, { prompts: [] });
    default:
      return erro(id, -32601, `Método não suportado: ${method}`);
  }
}

export async function POST(req: Request, { params }: { params: { token: string } }) {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7) : params.token;

  let usuario: UsuarioMcp;
  try {
    usuario = await autenticarMcp(token);
  } catch (e: any) {
    return NextResponse.json(erro(null, -32001, e?.message ?? "Não autorizado"), { status: 401 });
  }

  let body: Rpc | Rpc[];
  try { body = await req.json(); } catch { return NextResponse.json(erro(null, -32700, "JSON inválido"), { status: 400 }); }

  const lista = Array.isArray(body) ? body : [body];
  const respostas = [];
  for (const m of lista) {
    if (m?.id === undefined || m.id === null) continue; // notificação: não responde
    respostas.push(await tratar(m, usuario));
  }
  if (respostas.length === 0) return new NextResponse(null, { status: 202 });
  return NextResponse.json(Array.isArray(body) ? respostas : respostas[0]);
}

// Sem fluxo de eventos do servidor (modo sem estado)
export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}

export async function DELETE() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
}
