// MCP com o token no cabeçalho: Authorization: Bearer <token>. A lógica está em lib/mcp/server.ts.
import { atenderMcp, semFluxo } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = (req: Request) => atenderMcp(req, null);
export const GET = semFluxo;
export const DELETE = semFluxo;
