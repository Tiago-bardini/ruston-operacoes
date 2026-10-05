"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatBRL } from "@/lib/types";

type Conversa = {
  conversa_id: string;
  chat_id: string;
  conv_tipo: string;
  conv_nome: string | null;
  numero: string | null;
  ultima_mensagem_em: string | null;
  qtd_mensagens: number;
  cliente_id: string | null;
  cliente_nome: string | null;
  squad_id: string | null;
  mrr: number | null;
  temperatura: string | null;
  sentimento: string | null;
  risco_churn: string | null;
  oportunidade_upsell: string | null;
  resumo_curto: string | null;
  sinais_churn: string[] | null;
  sinais_upsell: string[] | null;
  dias_sem_contato: number | null;
  analise_em: string | null;
};

type Tab = "radar" | "churn" | "upsell" | "silencio" | "sem_vinculo";

const DIAS_ALERTA_SILENCIO = 5;

export default function RadarWhatsappPage() {
  const supabase = createClient();
  const [conversas, setConversas] = useState<Conversa[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>("radar");
  const [busca, setBusca] = useState("");

  async function carregar() {
    setLoading(true);
    const { data } = await supabase.from("ruston_whatsapp_radar_view").select("*").limit(5000);
    setConversas((data as Conversa[]) ?? []);
    setLoading(false);
  }

  useEffect(() => { carregar(); }, []);

  const filtradas = useMemo(() => {
    const term = busca.toLowerCase().trim();
    return conversas.filter((c) => {
      if (!term) return true;
      return (
        c.cliente_nome?.toLowerCase().includes(term) ||
        c.conv_nome?.toLowerCase().includes(term) ||
        c.numero?.includes(term)
      );
    });
  }, [conversas, busca]);

  const emChurn = useMemo(() => filtradas.filter((c) => c.risco_churn === "alto" || c.risco_churn === "medio"), [filtradas]);
  const emUpsell = useMemo(() => filtradas.filter((c) => c.oportunidade_upsell === "clara" || c.oportunidade_upsell === "possivel"), [filtradas]);
  const emSilencio = useMemo(() =>
    filtradas.filter((c) => c.cliente_id && (c.dias_sem_contato ?? 0) >= DIAS_ALERTA_SILENCIO), [filtradas]);
  const semVinculo = useMemo(() => filtradas.filter((c) => !c.cliente_id), [filtradas]);

  const stats = useMemo(() => ({
    total_conversas: conversas.length,
    com_cliente_vinculado: conversas.filter((c) => c.cliente_id).length,
    em_silencio: emSilencio.length,
    risco_alto: conversas.filter((c) => c.risco_churn === "alto").length,
    upsell_claro: conversas.filter((c) => c.oportunidade_upsell === "clara").length,
  }), [conversas, emSilencio]);

  const semZapi = conversas.length === 0 && !loading;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">📱 Radar WhatsApp</h1>
          <p className="text-sm text-brand-muted">
            Monitora conversas com clientes. Detecta risco de churn, oportunidades de upsell e silêncio prolongado.
          </p>
        </div>
        <input
          className="input w-64"
          placeholder="🔍 Buscar cliente, nome, número..."
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
      </div>

      {/* Setup pendente */}
      {semZapi && (
        <div className="card border border-amber-500/30 bg-amber-500/10 p-4">
          <p className="font-semibold text-amber-300">⚠ Z-API ainda não configurada</p>
          <p className="mt-1 text-sm text-brand-muted">
            Pra começar a receber conversas aqui, você precisa criar uma conta Z-API e configurar o webhook.
            O passo a passo está nessa conversa com o Claude. Qualquer dúvida, só chamar.
          </p>
          <ol className="mt-3 ml-5 list-decimal text-xs text-brand-muted space-y-1">
            <li>Criar conta em z-api.io e gerar uma instância</li>
            <li>Fornecer Instance ID + Token + Client Token pro Claude</li>
            <li>Claude configura o webhook pra `/api/zapi-webhook`</li>
            <li>Conectar seu WhatsApp Business via QR Code no painel Z-API</li>
            <li>Mensagens começam a aparecer aqui em tempo real</li>
          </ol>
        </div>
      )}

      {/* STATS */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card label="Conversas" value={stats.total_conversas} />
        <Card label="Com cliente vinculado" value={stats.com_cliente_vinculado} tone="good" />
        <Card label={`Em silêncio ≥ ${DIAS_ALERTA_SILENCIO}d`} value={stats.em_silencio} tone={stats.em_silencio > 0 ? "warn" : "good"} />
        <Card label="🔴 Risco alto churn" value={stats.risco_alto} tone="bad" />
        <Card label="🟢 Upsell claro" value={stats.upsell_claro} tone="good" />
      </div>

      {/* TABS */}
      <div className="flex gap-2 border-b border-white/10 pb-2 text-sm overflow-x-auto">
        <TabBtn ativo={tab === "radar"} onClick={() => setTab("radar")}>📡 Radar ({filtradas.length})</TabBtn>
        <TabBtn ativo={tab === "churn"} onClick={() => setTab("churn")}>🔴 Risco Churn ({emChurn.length})</TabBtn>
        <TabBtn ativo={tab === "upsell"} onClick={() => setTab("upsell")}>🟢 Upsell ({emUpsell.length})</TabBtn>
        <TabBtn ativo={tab === "silencio"} onClick={() => setTab("silencio")}>🔕 Silêncio ({emSilencio.length})</TabBtn>
        <TabBtn ativo={tab === "sem_vinculo"} onClick={() => setTab("sem_vinculo")}>🔗 Sem cliente ({semVinculo.length})</TabBtn>
      </div>

      <div className="card p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/10 text-left text-xs uppercase text-brand-muted">
              <th className="px-3 py-2">Cliente / Conversa</th>
              <th className="px-3 py-2">Última msg</th>
              <th className="px-3 py-2 text-center">Dias silêncio</th>
              <th className="px-3 py-2 text-center">Temp.</th>
              <th className="px-3 py-2 text-center">Churn</th>
              <th className="px-3 py-2 text-center">Upsell</th>
              <th className="px-3 py-2">Resumo IA</th>
              <th className="px-3 py-2 text-right">MRR</th>
            </tr>
          </thead>
          <tbody>
            {(() => {
              const lista =
                tab === "churn" ? emChurn :
                tab === "upsell" ? emUpsell :
                tab === "silencio" ? emSilencio :
                tab === "sem_vinculo" ? semVinculo :
                filtradas;
              if (lista.length === 0) return (
                <tr><td colSpan={8} className="px-3 py-12 text-center text-brand-muted">
                  {semZapi ? "Nenhuma conversa ainda. Configure Z-API primeiro." : "Nenhuma conversa nesse filtro."}
                </td></tr>
              );
              return lista
                .sort((a, b) => (b.ultima_mensagem_em ?? "").localeCompare(a.ultima_mensagem_em ?? ""))
                .slice(0, 500)
                .map((c) => (
                  <tr key={c.conversa_id} className="border-b border-white/5 last:border-0">
                    <td className="px-3 py-2">
                      <div className="font-medium">{c.cliente_nome ?? c.conv_nome ?? "—"}</div>
                      <div className="text-[10px] text-brand-muted">
                        {c.conv_tipo === "grupo" ? "👥 grupo " : "👤 "}· {c.numero ?? c.chat_id}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-xs text-brand-muted">
                      {c.ultima_mensagem_em ? new Date(c.ultima_mensagem_em).toLocaleString("pt-BR") : "—"}
                    </td>
                    <td className="px-3 py-2 text-center">
                      <SilencioBadge dias={c.dias_sem_contato ?? 0} />
                    </td>
                    <td className="px-3 py-2 text-center"><TempBadge v={c.temperatura} /></td>
                    <td className="px-3 py-2 text-center"><ChurnBadge v={c.risco_churn} /></td>
                    <td className="px-3 py-2 text-center"><UpsellBadge v={c.oportunidade_upsell} /></td>
                    <td className="px-3 py-2 text-xs max-w-md">
                      {c.resumo_curto ?? <span className="text-brand-muted italic">sem análise</span>}
                      {c.sinais_churn && c.sinais_churn.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.sinais_churn.slice(0, 3).map((s, i) => (
                            <span key={i} className="rounded bg-red-500/15 text-red-300 text-[9px] px-1.5 py-0.5">{s}</span>
                          ))}
                        </div>
                      )}
                      {c.sinais_upsell && c.sinais_upsell.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                          {c.sinais_upsell.slice(0, 3).map((s, i) => (
                            <span key={i} className="rounded bg-emerald-500/15 text-emerald-300 text-[9px] px-1.5 py-0.5">{s}</span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs">
                      {c.mrr ? formatBRL(c.mrr) : <span className="text-brand-muted">—</span>}
                    </td>
                  </tr>
                ));
            })()}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "bad" | "warn" }) {
  const color = tone === "good" ? "text-emerald-300" : tone === "bad" ? "text-red-300" : tone === "warn" ? "text-amber-300" : "text-white";
  return (
    <div className="card p-3">
      <p className="text-xs text-brand-muted">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function TabBtn({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: any }) {
  return (
    <button onClick={onClick} className={`rounded-md px-3 py-1 text-sm whitespace-nowrap transition ${ativo ? "bg-brand/20 text-brand" : "text-brand-muted hover:bg-white/5 hover:text-white"}`}>
      {children}
    </button>
  );
}

function TempBadge({ v }: { v: string | null }) {
  if (!v) return <span className="text-brand-muted">—</span>;
  const cfg = v === "quente" ? "bg-red-500/15 text-red-300" : v === "morna" ? "bg-amber-500/15 text-amber-300" : "bg-blue-500/15 text-blue-300";
  const emoji = v === "quente" ? "🔥" : v === "morna" ? "☀" : "❄";
  return <span className={`rounded px-2 py-0.5 text-xs ${cfg}`}>{emoji} {v}</span>;
}

function ChurnBadge({ v }: { v: string | null }) {
  if (!v || v === "baixo") return <span className="text-emerald-300 text-xs">✓</span>;
  const cfg = v === "alto" ? "bg-red-500/20 text-red-300" : "bg-amber-500/20 text-amber-300";
  return <span className={`rounded px-2 py-0.5 text-xs font-bold ${cfg}`}>{v}</span>;
}

function UpsellBadge({ v }: { v: string | null }) {
  if (!v || v === "nenhuma") return <span className="text-brand-muted">—</span>;
  const cfg = v === "clara" ? "bg-emerald-500/20 text-emerald-300" : "bg-amber-500/20 text-amber-300";
  return <span className={`rounded px-2 py-0.5 text-xs font-bold ${cfg}`}>{v}</span>;
}

function SilencioBadge({ dias }: { dias: number }) {
  if (dias <= 2) return <span className="text-emerald-300 text-xs">{dias}d</span>;
  if (dias <= 4) return <span className="text-amber-300 text-xs">{dias}d</span>;
  return <span className="text-red-300 text-xs font-bold">{dias}d ⚠</span>;
}
