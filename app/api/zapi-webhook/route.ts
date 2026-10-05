// =====================================================================
// Z-API WEBHOOK — recebe mensagens em tempo real
// =====================================================================
// A Z-API chama esse endpoint TODA vez que:
//   - Chega uma mensagem no WhatsApp conectado (incoming)
//   - Nós enviamos uma mensagem (outgoing, só se "Notificar enviadas" estiver ON na Z-API)
//   - Status da msg muda (entregue/lida)
//   - Conexão muda
// Esse endpoint só processa mensagens (type = "ReceivedCallback" ou similar).
// Insere no banco e tenta vincular conversa → cliente pelo número.
// =====================================================================

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 30;

type ZapiMessage = Record<string, any>;

function clean(num: any): string | null {
  if (!num) return null;
  const s = String(num).replace(/\D/g, "");
  return s.length >= 10 ? s : null;
}

// Extrai conteúdo da msg conforme o tipo (texto, imagem, áudio, etc.)
function extrairConteudo(m: ZapiMessage): { tipo: string; conteudo: string | null; media_url: string | null } {
  if (m.text?.message) return { tipo: "texto", conteudo: m.text.message, media_url: null };
  if (m.image?.caption || m.image?.imageUrl) return { tipo: "imagem", conteudo: m.image.caption ?? null, media_url: m.image.imageUrl ?? null };
  if (m.audio?.audioUrl) return { tipo: "audio", conteudo: null, media_url: m.audio.audioUrl ?? null };
  if (m.video?.videoUrl) return { tipo: "video", conteudo: m.video.caption ?? null, media_url: m.video.videoUrl ?? null };
  if (m.document?.documentUrl) return { tipo: "documento", conteudo: m.document.fileName ?? null, media_url: m.document.documentUrl ?? null };
  if (m.sticker?.stickerUrl) return { tipo: "sticker", conteudo: null, media_url: m.sticker.stickerUrl ?? null };
  if (m.location) return { tipo: "localizacao", conteudo: `${m.location.latitude},${m.location.longitude}`, media_url: null };
  return { tipo: "outro", conteudo: null, media_url: null };
}

export async function POST(req: Request) {
  const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const SB_SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!SB_URL || !SB_SERVICE) {
    return NextResponse.json({ error: "Supabase não configurado" }, { status: 500 });
  }

  const supabase = createClient(SB_URL, SB_SERVICE, { auth: { persistSession: false } });

  let payload: ZapiMessage = {};
  try { payload = await req.json(); } catch {
    return NextResponse.json({ ok: false, error: "payload inválido" }, { status: 400 });
  }

  // Z-API manda vários tipos de callback. Só processamos mensagem.
  // Tipos comuns: ReceivedCallback (recebeu), MessageStatusCallback (status), etc.
  const type = payload.type ?? payload.callbackType ?? null;
  const isMensagem = (
    type === "ReceivedCallback" ||
    type === "DeliveryCallback" ||
    (payload.messageId && (payload.phone || payload.chat))
  );

  // Se não for mensagem, ack rápido (status, conexão, etc.) — não processa
  if (!isMensagem) {
    return NextResponse.json({ ok: true, ignored: type ?? "sem_type" });
  }

  const messageId = payload.messageId ?? payload.id;
  const chatPhone = payload.phone ?? payload.chatPhone;
  const isGroup = payload.isGroup === true;
  const chat_id = isGroup ? (payload.chat ?? chatPhone) : chatPhone;
  const chatName = payload.chatName ?? payload.notifyName ?? payload.participantName;

  if (!chat_id) return NextResponse.json({ ok: false, error: "sem chat_id" }, { status: 400 });

  const { tipo, conteudo, media_url } = extrairConteudo(payload);
  const timestamp = payload.messageTimestamp ?? payload.momment ?? Math.floor(Date.now() / 1000);
  const enviada_em = new Date(timestamp * 1000).toISOString();
  const de_mim = payload.fromMe === true;

  const autor_numero = clean(isGroup ? (payload.participantPhone ?? payload.senderPhone) : (de_mim ? payload.connectedPhone : chatPhone));
  const autor_nome = payload.participantName ?? payload.senderName ?? chatName;

  try {
    // 1) UPSERT conversa (chat_id como chave)
    const { data: conv } = await supabase
      .from("ruston_whatsapp_conversas")
      .upsert({
        chat_id,
        tipo: isGroup ? "grupo" : "individual",
        nome: chatName,
        numero: isGroup ? null : clean(chatPhone),
        ultima_mensagem_em: enviada_em,
        atualizado_em: new Date().toISOString(),
      }, { onConflict: "chat_id" })
      .select("id")
      .single();

    const conversa_id = conv?.id;

    // Incrementa contador manualmente
    if (conversa_id) {
      await supabase.rpc("exec_sql_increment_conv_msgs", { p_conversa_id: conversa_id }).then(() => null).catch(() => null);
    }

    // 2) INSERT mensagem (ignora duplicata via message_id)
    if (conversa_id) {
      await supabase.from("ruston_whatsapp_mensagens").upsert({
        message_id: messageId,
        conversa_id,
        chat_id,
        tipo,
        conteudo,
        media_url,
        autor_numero,
        autor_nome,
        de_mim,
        enviada_em,
        payload_raw: payload,
      }, { onConflict: "message_id", ignoreDuplicates: true });
    }

    // 3) Tenta vincular conversa → cliente pelo número (match automático)
    //    Roda a função que criamos no SQL. Só mexe em conversas sem vínculo.
    if (!isGroup) {
      await supabase.rpc("fn_whatsapp_match_clientes").then(() => null).catch(() => null);
    }

    return NextResponse.json({ ok: true, conversa_id, chat_id });
  } catch (e: any) {
    console.error("[zapi-webhook] erro:", e);
    return NextResponse.json({ ok: false, error: String(e?.message ?? e) }, { status: 500 });
  }
}

// GET para teste rápido
export async function GET() {
  return NextResponse.json({ ok: true, msg: "Z-API webhook endpoint. Configure essa URL nos webhooks da Z-API." });
}
