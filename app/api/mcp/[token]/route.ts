// MCP com o token na URL: /api/mcp/<token>. A lógica está em lib/mcp/server.ts.
import { atenderMcp, semFluxo } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export const POST = (req: Request, { params }: { params: { token: string } }) => atenderMcp(req, params.token);
export const GET = semFluxo;
export const DELETE = semFluxo;
