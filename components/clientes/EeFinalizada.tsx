"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ClienteView, EeFinalizada, EtapaCliente, Pessoa, Squad } from "@/lib/types";
import { formatBRL, ETAPA_LABEL } from "@/lib/types";

export type PayloadEeFinalizada = {
  data_finalizacao: string;
  motivo: string | null;
  observacoes: string | null;
};

/** Dá baixa na E.E: o cliente sai da carteira do GP (ativo = false) sem virar churn
 *  (churn_realizado continua false e nada entra em Solicitações de Churn).
 *  O registro fica no histórico de Clientes › E.E Finalizada. */
export async function finalizarEE(
  supabase: SupabaseClient,
  cliente: ClienteView,
  payload: PayloadEeFinalizada,
) {
  const { data: { user } } = await supabase.auth.getUser();
  const { error } = await supabase.from("ruston_ee_finalizadas").insert({
    cliente_id: cliente.id,
    cliente_nome: cliente.nome,
    data_finalizacao: payload.data_finalizacao,
    motivo: payload.motivo,
    observacoes: payload.observacoes,
    mrr: Number(cliente.mrr) || 0,
    fee: cliente.fee != null ? Number(cliente.fee) : null,
    gp_id: cliente.account_id,
    gp_nome: cliente.account_nome,
    coordenador_nome: cliente.coordenador_nome,
    squad_id: cliente.squad_id,
    squad_nome: cliente.squad_nome,
    registrado_por: user?.email ?? null,
  });
  // Sem o histórico gravado, o cliente não sai da carteira
  if (error) return error;
  const { error: e } = await supabase.from("ruston_clientes").update({ ativo: false }).eq("id", cliente.id);
  return e;
}

export type PayloadReativarEE = {
  account_id: string | null;
  squad_id: string | null;
  etapa: EtapaCliente;
  mrr: number;
};

/** O cliente fechou a assessoria depois: volta para a carteira no GP escolhido
 *  e o registro fica marcado como reativado. */
export async function reativarEE(supabase: SupabaseClient, registroId: string, clienteId: string, payload: PayloadReativarEE) {
  const { error } = await supabase.from("ruston_clientes").update({ ativo: true, ...payload }).eq("id", clienteId);
  if (error) return error;
  const { error: e } = await supabase.from("ruston_ee_finalizadas")
    .update({ reativado_em: new Date().toISOString() }).eq("id", registroId);
  return e;
}

export function ModalEeFinalizada({ cliente, onFechar, onConfirmar }: {
  cliente: ClienteView;
  onFechar: () => void;
  onConfirmar: (payload: PayloadEeFinalizada) => void;
}) {
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [motivo, setMotivo] = useState("");
  const [observacoes, setObservacoes] = useState("");

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}>
      <div className="w-full max-w-md rounded-xl bg-brand-panel p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h3 className="text-lg font-bold text-sky-300">🧭 E.E Finalizada</h3>
          <p className="mt-1 text-sm text-brand-muted">
            Cliente: <strong className="text-white">{cliente.nome}</strong>
          </p>
          <p className="text-xs text-brand-muted">
            {cliente.account_nome ? `GP ${cliente.account_nome} · ` : ""}{formatBRL(cliente.mrr)}/mês
          </p>
          <p className="mt-2 text-[11px] text-brand-muted">
            Terminou a Estruturação Estratégica e não fechou a assessoria. O cliente sai da carteira do GP,
            <strong className="text-gray-200"> não conta como churn</strong> e fica no histórico em Clientes › E.E Finalizada.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Data da finalização</label>
            <input type="date" className="input" value={data}
              onChange={(e) => setData(e.target.value)} />
          </div>
          <div>
            <label className="label">Por que não fechou a assessoria? (opcional)</label>
            <textarea className="input" rows={3} value={motivo}
              onChange={(e) => setMotivo(e.target.value)}
              placeholder="Ex: sem verba agora, vai executar internamente, achou caro..." />
          </div>
          <div>
            <label className="label">Observações (opcional)</label>
            <textarea className="input" rows={2} value={observacoes}
              onChange={(e) => setObservacoes(e.target.value)}
              placeholder="Ex: retomar contato em 3 meses" />
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            className="btn bg-sky-600 hover:bg-sky-700 border-sky-500"
            disabled={!data}
            onClick={() => onConfirmar({
              data_finalizacao: data,
              motivo: motivo.trim() || null,
              observacoes: observacoes.trim() || null,
            })}
          >
            Confirmar E.E Finalizada
          </button>
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

const ETAPAS_REATIVACAO: EtapaCliente[] = ["onboarding", "estruturacao_estrategica", "byline", "pontual"];

export function ModalReativarEE({ registro, pessoas, squads, onFechar, onConfirmar }: {
  registro: EeFinalizada;
  pessoas: Pessoa[];
  squads: Squad[];
  onFechar: () => void;
  onConfirmar: (payload: PayloadReativarEE) => void;
}) {
  const gps = pessoas.filter((p) => p.cargo === "gestor_projetos");
  const [gpId, setGpId] = useState(registro.gp_id ?? "");
  const [squadId, setSquadId] = useState(registro.squad_id ?? "");
  const [etapa, setEtapa] = useState<EtapaCliente>("onboarding");
  const [mrr, setMrr] = useState(String(registro.mrr ?? ""));

  function escolherGp(id: string) {
    setGpId(id);
    // Squad acompanha o GP escolhido (dá pra trocar depois)
    const sq = pessoas.find((p) => p.id === id)?.squad_id;
    if (sq) setSquadId(sq);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onFechar}>
      <div className="w-full max-w-md rounded-xl bg-brand-panel p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4">
          <h3 className="text-lg font-bold text-emerald-300">✓ Reativar cliente</h3>
          <p className="mt-1 text-sm text-brand-muted">
            Cliente: <strong className="text-white">{registro.cliente_nome}</strong>
          </p>
          <p className="mt-2 text-[11px] text-brand-muted">
            O cliente fechou a assessoria: volta para a Carteira no GP escolhido. O histórico da E.E continua aqui, marcado como &quot;Fechou&quot;.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">GP</label>
            <select className="input" value={gpId} onChange={(e) => escolherGp(e.target.value)}>
              <option value="">Sem GP</option>
              {gps.map((p) => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
            {registro.gp_nome && <p className="mt-1 text-[10px] text-brand-muted">GP na E.E: {registro.gp_nome}</p>}
          </div>
          <div>
            <label className="label">Squad</label>
            <select className="input" value={squadId} onChange={(e) => setSquadId(e.target.value)}>
              <option value="">Sem squad</option>
              {squads.map((s) => <option key={s.id} value={s.id}>{s.nome}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Etapa</label>
              <select className="input" value={etapa} onChange={(e) => setEtapa(e.target.value as EtapaCliente)}>
                {ETAPAS_REATIVACAO.map((et) => <option key={et} value={et}>{ETAPA_LABEL[et]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">MRR da assessoria</label>
              <input type="number" className="input" value={mrr} onChange={(e) => setMrr(e.target.value)} />
            </div>
          </div>
        </div>

        <div className="mt-5 flex items-center gap-2">
          <button
            className="btn bg-emerald-600 hover:bg-emerald-700 border-emerald-500"
            onClick={() => onConfirmar({
              account_id: gpId || null,
              squad_id: squadId || null,
              etapa,
              mrr: Number(mrr) || 0,
            })}
          >
            Reativar na Carteira
          </button>
          <button className="btn-ghost" onClick={onFechar}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}
