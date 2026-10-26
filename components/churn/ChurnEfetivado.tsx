"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteView } from "@/lib/types";
import { formatBRL, formatDate } from "@/lib/types";

export type PayloadSubirChurn = {
  data_churn: string;
  motivo_churn: string | null;
  data_subir_churn_sistema: string | null;
  link_debriefing_churn: string | null;
};

/** Efetiva o churn do cliente (sai da base ativa) e garante que ele conste na base
 *  de Solicitações de Churn — é ela que alimenta o % de churn mensal.
 *  - solicitacaoId: confirma essa solicitação
 *  - sem solicitacaoId: confirma a solicitação em aberto do cliente ou cria uma nova */
export async function efetivarChurn(
  supabase: SupabaseClient,
  cliente: ClienteView,
  payload: PayloadSubirChurn,
  solicitacaoId?: string,
) {
  const { error } = await supabase.from("ruston_clientes").update({
    churn_realizado: true,
    ativo: false,
    data_churn: payload.data_churn,
    motivo_churn: payload.motivo_churn,
    data_subir_churn_sistema: payload.data_subir_churn_sistema,
    link_debriefing_churn: payload.link_debriefing_churn,
    etapa: "cancelado",
  }).eq("id", cliente.id);
  if (error) return error;

  const agora = new Date().toISOString();
  let id = solicitacaoId;
  if (!id) {
    const { data: aberta } = await supabase.from("ruston_churn_solicitacoes")
      .select("id").eq("cliente_id", cliente.id).in("status", ["solicitado", "em_retencao"])
      .order("data_solicitacao", { ascending: false }).limit(1).maybeSingle();
    id = aberta?.id;
  }
  if (id) {
    const { error: e } = await supabase.from("ruston_churn_solicitacoes")
      .update({ status: "confirmado", updated_at: agora }).eq("id", id);
    return e;
  }
  const d = new Date(payload.data_churn + "T00:00:00");
  const { error: e } = await supabase.from("ruston_churn_solicitacoes").insert({
    cliente_id: cliente.id,
    data_solicitacao: payload.data_churn,
    ano: d.getFullYear(),
    mes: d.getMonth() + 1,
    mrr: Number(cliente.mrr) || 0,
    status: "confirmado",
    observacoes: payload.motivo_churn,
  });
  return e;
}

/** Cliente foi para "Em Retenção" na Carteira: abre a solicitação de churn com status
 *  Em retenção no mês de hoje (entra no Churn do mês). Não duplica se já houver uma em aberto. */
export async function abrirRetencao(supabase: SupabaseClient, cliente: { id: string; mrr: number | string | null }) {
  const { data: aberta } = await supabase.from("ruston_churn_solicitacoes")
    .select("id").eq("cliente_id", cliente.id).in("status", ["solicitado", "em_retencao"])
    .limit(1).maybeSingle();
  if (aberta) return null;
  const h = new Date();
  const { error } = await supabase.from("ruston_churn_solicitacoes").insert({
    cliente_id: cliente.id,
    data_solicitacao: `${h.getFullYear()}-${String(h.getMonth() + 1).padStart(2, "0")}-${String(h.getDate()).padStart(2, "0")}`,
    ano: h.getFullYear(),
    mes: h.getMonth() + 1,
    mrr: Number(cliente.mrr) || 0,
    status: "em_retencao",
    observacoes: "Movido para Em Retenção na Carteira",
  });
  return error;
}

/* ============================== CHURN LIST ============================== */

export function ChurnList({ clientes, onMarkarSubiu, onReativar }: {
  clientes: ClienteView[];
  onMarkarSubiu: (id: string) => void;
  onReativar: (id: string) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  return (
    <div className="card overflow-x-auto p-0">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
            <th className="px-4 py-3">Cliente</th>
            <th className="px-4 py-3">Data Churn</th>
            <th className="px-4 py-3">GP</th>
            <th className="px-4 py-3">Squad</th>
            <th className="px-4 py-3">MRR perdido</th>
            <th className="px-4 py-3">Motivo</th>
            <th className="px-4 py-3">Debriefing</th>
            <th className="px-4 py-3">Subir no sistema</th>
            <th className="px-4 py-3"></th>
          </tr>
        </thead>
        <tbody>
          {clientes.length === 0 && (
            <tr><td colSpan={9} className="px-4 py-12 text-center text-brand-muted">
              Nenhum churn efetivado. Confirme uma solicitação na aba "Solicitações" ou use "Subir Churn" na edição do cliente.
            </td></tr>
          )}
          {clientes.map((c) => {
            const dataSubir = c.data_subir_churn_sistema;
            const pendente = !c.subiu_no_sistema && dataSubir != null && dataSubir <= hoje;
            return (
              <tr key={c.id} className="border-b border-white/5 last:border-0">
                <td className="px-4 py-3 font-medium">{c.nome}</td>
                <td className="px-4 py-3 text-brand-muted">{formatDate(c.data_churn)}</td>
                <td className="px-4 py-3 text-brand-muted">{c.account_nome ?? "—"}</td>
                <td className="px-4 py-3 text-brand-muted">{c.squad_nome ?? "—"}</td>
                <td className="px-4 py-3 font-medium text-red-300">{formatBRL(c.mrr)}</td>
                <td className="px-4 py-3 text-xs text-brand-muted line-clamp-2">{c.motivo_churn ?? "—"}</td>
                <td className="px-4 py-3">
                  {c.link_debriefing_churn ? (
                    <a
                      href={c.link_debriefing_churn}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-brand hover:text-emerald-300 underline underline-offset-2"
                    >📄 abrir</a>
                  ) : (
                    <span className="text-xs text-brand-muted">—</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  {c.subiu_no_sistema ? (
                    <span className="badge bg-emerald-500/15 text-emerald-300 border-emerald-500/30">✓ Subiu</span>
                  ) : dataSubir ? (
                    <div className="flex items-center gap-2">
                      <span className={`text-xs ${pendente ? "text-purple-300 font-semibold" : "text-brand-muted"}`}>
                        {formatDate(dataSubir)}{pendente ? " · pendente!" : ""}
                      </span>
                      <button
                        className="text-[10px] text-emerald-300 hover:text-emerald-400"
                        onClick={() => onMarkarSubiu(c.id)}
                      >marcar como subiu</button>
                    </div>
                  ) : (
                    <span className="text-xs text-brand-muted">sem data</span>
                  )}
                </td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => onReativar(c.id)} className="text-xs text-brand hover:text-red-400">
                    reativar
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ============================== MODAL SUBIR CHURN ============================== */

export function ModalSubirChurn({ cliente, dataInicial, motivoInicial, onFechar, onConfirmar }: {
  cliente: ClienteView;
  dataInicial?: string;
  motivoInicial?: string;
  onFechar: () => void;
  onConfirmar: (payload: PayloadSubirChurn) => void;
}) {
  const hoje = new Date().toISOString().slice(0, 10);
  const diasFuturos = (n: number) => {
    const d = new Date();
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };
  const [dataChurn, setDataChurn] = useState(dataInicial ?? hoje);
  const [motivo, setMotivo] = useState(motivoInicial ?? "");
  const [dataSubir, setDataSubir] = useState(diasFuturos(7));
  const [linkDebriefing, setLinkDebriefing] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}>
      <div className="w-full max-w-md rounded-xl bg-brand-panel p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h3 className="text-lg font-bold text-purple-300">⚠ Subir Churn</h3>
          <p className="mt-1 text-sm text-brand-muted">
            Cliente: <strong className="text-white">{cliente.nome}</strong>
          </p>
          <p className="text-xs text-brand-muted">
            MRR perdido: {formatBRL(cliente.mrr)}
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Data do churn</label>
            <input type="date" className="input" value={dataChurn}
              onChange={(e) => setDataChurn(e.target.value)} />
          </div>
          <div>
            <label className="label">Motivo (opcional)</label>
            <textarea className="input" rows={3} value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: sem verba, insatisfeito com resultado, mudou de agência..." />
          </div>
          <div>
            <label className="label">Data pra subir no CRM externo (opcional)</label>
            <input type="date" className="input" value={dataSubir}
              onChange={(e) => setDataSubir(e.target.value)} />
            <p className="mt-1 text-[10px] text-brand-muted">
              Sistema vai lembrar quando essa data chegar
            </p>
          </div>
          <div>
            <label className="label">Link do debriefing (opcional)</label>
            <input type="url" className="input" value={linkDebriefing}
              onChange={(e) => setLinkDebriefing(e.target.value)}
              placeholder="https://docs.google.com/..." />
            <p className="mt-1 text-[10px] text-brand-muted">
              Documento do debriefing feito pelo Coordenador junto com o GP
            </p>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            className="btn bg-purple-600 hover:bg-purple-700 border-purple-500"
            onClick={() => onConfirmar({
              data_churn: dataChurn,
              motivo_churn: motivo || null,
              data_subir_churn_sistema: dataSubir || null,
              link_debriefing_churn: linkDebriefing.trim() || null,
            })}
          >Confirmar Churn</button>
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
