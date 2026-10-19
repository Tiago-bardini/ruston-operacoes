// =====================================================================
// WHATSAPP ALERTAS CHECK — detecta e dispara alertas via Z-API
// =====================================================================
// Chamado via Vercel Cron (ver vercel.json):
//   - a cada 15min: check SLA 30min
//   - 17h de dia útil: check grupo mudo + Ruston mudo
//
// Query params:
//   ?tipo=sla_30min    → só verifica SLA
//   ?tipo=silencio     → verifica grupo_mudo + ruston_mudo
//   ?tipo=todos        → verifica os 3 (default)
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

const Z_URL = "https://api.z-api.io";
const GRUPO_NOTIFICACOES = process.env.ZAPI_GRUPO_NOTIFICACOES ?? "120363428129920467-group";

async function zapiEnviarTexto(phone: string, message: string): Promise<{ok: boolean; erro?: string}> {
  const inst = process.env.ZAPI_INSTANCE_ID;
  const tok = process.env.ZAPI_TOKEN;
  const client = process.env.ZAPI_CLIENT_TOKEN;
  if (!inst || !tok || !client) return { ok: false, erro: "Z-API não configurada" };
  if (!phone) return { ok: false, erro: "sem telefone" };

  try {
    const url = `${Z_URL}/instances/${inst}/token/${tok}/send-text`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Client-Token": client },
      body: JSON.stringify({ phone, message }),
    });
    if (!res.ok) {
      const t = await res.text();
      return { ok: false, erro: `Z-API ${res.status}: ${t}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, erro: String(e?.message ?? e) };
  }
}

function diaUtil(): boolean {
  const d = new Date().getDay();
  return d >= 1 && d <= 5; // segunda a sexta
}

export async function POST(req: Request) {
  return GET(req);
}

export async function GET(req: Request) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SB_URL || !SB_SERVICE) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  }

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  const url = new URL(req.url);
  const tipo = url.searchParams.get("tipo") ?? "todos";

  // Função helper pra despachar alerta no grupo "Notificações Clientes"
  async function despachar(opts: {
    tipo: string;
    conversa_id: string;
    cliente_id: string;
    cliente_nome: string;
    coordenador_id: string | null;
    mensagem_id?: string | null;
    detalhes: string;
    mensagem_texto: string;
  }) {
    // Busca nome do coordenador pra mencionar no alerta
    let coordNome = "Não definido";
    if (opts.coordenador_id) {
      const { data: coord } = await supabase
        .from("ruston_pessoas")
        .select("nome")
        .eq("id", opts.coordenador_id)
        .single();
      if (coord?.nome) coordNome = coord.nome as string;
    }

    // Monta mensagem com nome do coordenador responsável
    const msgComCoord = `${opts.mensagem_texto}\n\nCoordenador responsável: *${coordNome}*`;

    // Envia pro grupo centralizado de notificações
    const resultado = await zapiEnviarTexto(GRUPO_NOTIFICACOES, msgComCoord);

    // Registra o alerta pra não repetir
    await supabase.from("ruston_whatsapp_alertas").insert({
      tipo: opts.tipo,
      conversa_id: opts.conversa_id,
      cliente_id: opts.cliente_id,
      mensagem_id: opts.mensagem_id ?? null,
      detalhes: opts.detalhes,
      enviado_para_coord_whatsapp: coordNome,
      enviado_para_gerente_whatsapp: GRUPO_NOTIFICACOES,
      envio_sucesso: resultado.ok,
      envio_erro: resultado.erro ?? null,
    });
  }

  const stats = { sla_30min: 0, grupo_mudo: 0, ruston_mudo: 0 };

  // ================ CHECK 1: SLA 30 MIN ================
  if (tipo === "todos" || tipo === "sla_30min") {
    const { data: items } = await supabase.rpc("fn_wa_detectar_sla_30min");
    for (const it of (items ?? []) as any[]) {
      await despachar({
        tipo: "sla_30min",
        conversa_id: it.conversa_id,
        cliente_id: it.cliente_id,
        cliente_nome: it.cliente_nome,
        coordenador_id: it.coordenador_id,
        mensagem_id: it.mensagem_id,
        detalhes: `Cliente ${it.cliente_nome} aguardando resposta há ${it.minutos_sem_resposta} min`,
        mensagem_texto:
`⏰ *Alerta Ruston — Resposta pendente*

Cliente: *${it.cliente_nome}*
Tempo sem resposta: *${it.minutos_sem_resposta} min*

Entra no WhatsApp e responde o cliente. Depois disso o alerta some.`,
      });
      stats.sla_30min++;
    }
  }

  // ================ CHECK 2 e 3: só em dia útil ================
  if (diaUtil() && (tipo === "todos" || tipo === "silencio")) {
    // Grupo mudo (ninguém falou nada hoje)
    const { data: mudos } = await supabase.rpc("fn_wa_detectar_grupo_mudo");
    for (const it of (mudos ?? []) as any[]) {
      await despachar({
        tipo: "grupo_mudo",
        conversa_id: it.conversa_id,
        cliente_id: it.cliente_id,
        cliente_nome: it.cliente_nome,
        coordenador_id: it.coordenador_id,
        detalhes: `Grupo ${it.cliente_nome} sem mensagens hoje`,
        mensagem_texto:
`🔕 *Alerta Ruston — Grupo em silêncio*

Cliente: *${it.cliente_nome}*
Nenhuma mensagem no grupo hoje (nem do cliente, nem da Ruston).

Entra no grupo e dá uma mexida — pode ser sinal de desengajamento.`,
      });
      stats.grupo_mudo++;
    }

    // Ruston mudo (cliente falou, Ruston não respondeu)
    const { data: nossoSilencio } = await supabase.rpc("fn_wa_detectar_ruston_mudo");
    for (const it of (nossoSilencio ?? []) as any[]) {
      await despachar({
        tipo: "ruston_mudo",
        conversa_id: it.conversa_id,
        cliente_id: it.cliente_id,
        cliente_nome: it.cliente_nome,
        coordenador_id: it.coordenador_id,
        detalhes: `Cliente ${it.cliente_nome} mandou ${it.qtd_msgs_cliente} msgs hoje, Ruston não respondeu`,
        mensagem_texto:
`🚫 *Alerta Ruston — Nós ficamos quietos*

Cliente: *${it.cliente_nome}*
Cliente mandou *${it.qtd_msgs_cliente} msgs* hoje mas ninguém da Ruston respondeu.

Vai lá e responde — tá queimando a relação.`,
      });
      stats.ruston_mudo++;
    }
  }

  return NextResponse.json({ ok: true, stats });
}
