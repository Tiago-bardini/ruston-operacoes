// =====================================================================
// MCP — servidor para o Claude (conector personalizado)
// Endereços (mesmo servidor):
//   https://ruston-operacoes.vercel.app/api/mcp/<token>   (token na URL)
//   https://ruston-operacoes.vercel.app/api/mcp           (Authorization: Bearer <token>)
// Protocolo MCP via "Streamable HTTP" sem estado: cada POST traz uma
// mensagem JSON-RPC e a resposta volta em JSON.
// =====================================================================

import { NextResponse } from "next/server";
import { autenticarMcp, type UsuarioMcp } from "@/lib/mcp/auth";
import { ferramentasDo } from "@/lib/mcp/tools";
import { PRAZO_EDICAO_DIAS } from "@/lib/mcp/envios";

const VERSOES = ["2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCOES =
  "Ruston Operações: sistema da operação (carteira de clientes, FCA, tratativas de churn, planejamento/ROI e pesquisas). Fale em português. " +
  "Use buscar_clientes quando não tiver certeza do nome do cliente. Nunca invente notas ou números: pergunte o que faltar. " +
  `Se o usuário disser que enviou algo errado, use listar_meus_envios para achar o envio e editar_envio, desfazer_envio ou excluir_envio para corrigir (prazo de ${PRAZO_EDICAO_DIAS} dias). ` +
  "Para churn: cadastrar_tratativa_churn abre uma tratativa, atualizar_tratativa_churn muda os dados, registrar_acompanhamento_churn anota o andamento e encerrar_tratativa_churn fecha com o resultado. " +
  "Antes de abrir uma tratativa nova, confira com ver_tratativas_churn se o cliente já tem uma em andamento. " +
  "Sempre mostre o antes e o depois e espere confirmação antes de gravar. Ferramentas com o parâmetro confirmar devolvem uma prévia quando chamadas sem ele: mostre a prévia e só chame com confirmar=true depois do OK do usuário.";

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
        serverInfo: { name: "ruston-operacoes", title: "Ruston Operações", version: "2.0.0" },
        instructions: INSTRUCOES + ` Usuário conectado: ${usuario.email} (${usuario.papel}${usuario.somenteLeitura ? ", acesso somente leitura" : ""}).`,
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
        // Erro de negócio volta como resultado, para a IA ler e explicar
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

/** Token do cabeçalho Authorization: Bearer tem prioridade; senão o da URL. */
export async function atenderMcp(req: Request, tokenDaUrl: string | null) {
  const auth = req.headers.get("authorization");
  const token = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : tokenDaUrl;

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
export const semFluxo = () => new NextResponse(null, { status: 405, headers: { Allow: "POST" } });
