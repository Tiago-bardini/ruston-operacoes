"use client";

import { useState } from "react";
import type { TipoReuniao } from "@/lib/types";
import { TIPO_REUNIAO_LABEL } from "@/lib/types";

export type Variante1a1 = "coo" | "ge_ee";

export const TITULO_1A1: Record<Variante1a1, string> = {
  coo: "📞 1:1 COO X Cliente",
  ge_ee: "📞 GE - EE",
};

/** Resumo escrito à mão que a IA analisa (mesma análise das reuniões do Meet). Salva no histórico do cliente.
 *  coo = 1:1 do coordenador com o cliente · ge_ee = gerente com o cliente após a Estruturação Estratégica */
export function Form1a1({ clienteId, clienteNome, variante = "coo", onSalvo, onCancelar }: {
  clienteId: string;
  clienteNome: string;
  variante?: Variante1a1;
  onSalvo: () => void;
  onCancelar: () => void;
}) {
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [duracao, setDuracao] = useState("");
  const [tipo, setTipo] = useState<TipoReuniao>("periodica");
  const [resumo, setResumo] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar() {
    setSalvando(true);
    setErro(null);
    try {
      const res = await fetch("/api/reuniao-analise", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cliente_id: clienteId, cliente_nome: clienteNome, tipo_reuniao: tipo,
          data_reuniao: data, duracao_minutos: duracao, resumo, variante,
        }),
      });
      const r = await res.json();
      if (!res.ok || r.error) setErro(r.error ?? "Erro ao salvar");
      else onSalvo();
    } catch (e: any) {
      setErro(e?.message ?? "Erro de conexão");
    } finally {
      setSalvando(false);
    }
  }

  const curto = resumo.trim().length < 50;

  return (
    <div className="mb-4 space-y-3 rounded-lg border border-sky-500/30 bg-sky-500/5 p-4">
      <p className="text-sm font-semibold text-sky-300">{TITULO_1A1[variante]}</p>
      {variante === "ge_ee" && (
        <p className="text-[11px] text-brand-muted">Reunião/ligação do gerente com o cliente após a Estruturação Estratégica</p>
      )}
      <div className="grid grid-cols-3 gap-2">
        <div>
          <label className="label">Data</label>
          <input type="date" className="input" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div>
          <label className="label">Duração (min)</label>
          <input type="number" min={1} className="input" value={duracao}
            onChange={(e) => setDuracao(e.target.value)} placeholder="Ex: 20" />
        </div>
        <div>
          <label className="label">Tipo</label>
          <select className="input" value={tipo} onChange={(e) => setTipo(e.target.value as TipoReuniao)}>
            {Object.entries(TIPO_REUNIAO_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
      <div>
        <label className="label">Resumo da conversa</label>
        <textarea rows={7} className="input" value={resumo} onChange={(e) => setResumo(e.target.value)}
          placeholder={variante === "ge_ee"
            ? "Como o cliente recebeu a Estruturação Estratégica, o que gostou ou questionou, se está confiante para seguir, expectativas, riscos, o que foi combinado e quem ficou responsável..."
            : "Como o cliente está, o que elogiou ou reclamou, como vê o resultado, mudanças no negócio (verba, decisor, lançamentos), se falou de outra agência, o que foi combinado e quem ficou responsável..."} />
        <p className="mt-1 text-[10px] text-brand-muted">
          A IA analisa o resumo (temperatura, risco de churn, upsell, plano de ação). Conta na cadência e alimenta o Radar de Churn.
        </p>
      </div>
      {erro && <p className="text-xs text-red-300">{erro}</p>}
      <div className="flex items-center gap-2">
        <button className="btn text-xs" disabled={salvando || curto} onClick={salvar}>
          {salvando ? "Analisando com IA..." : "Salvar e analisar"}
        </button>
        <button className="btn-ghost text-xs" onClick={onCancelar}>Cancelar</button>
        {curto && <span className="text-[10px] text-brand-muted">escreva pelo menos algumas frases</span>}
      </div>
    </div>
  );
}

/** Modal com seletor de cliente, para abrir o 1:1 direto do topo da tela de Reuniões. */
export function Modal1a1({ clientes, variante = "coo", onFechar, onSalvo }: {
  clientes: { cliente_id: string; cliente_nome: string }[];
  variante?: Variante1a1;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [clienteId, setClienteId] = useState("");
  const lista = [...clientes].sort((a, b) => a.cliente_nome.localeCompare(b.cliente_nome));
  const cliente = lista.find((c) => c.cliente_id === clienteId);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 overflow-y-auto" onClick={onFechar}>
      <div className="w-full max-w-2xl rounded-xl bg-brand-panel p-6 shadow-lg my-8" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <h3 className="text-lg font-bold">Novo {TITULO_1A1[variante].replace("📞 ", "")}</h3>
          <button onClick={onFechar} className="text-brand-muted hover:text-gray-200 text-xl">×</button>
        </div>
        <div className="mb-3">
          <label className="label">Cliente</label>
          <select className="input" value={clienteId} onChange={(e) => setClienteId(e.target.value)}>
            <option value="">Selecione o cliente</option>
            {lista.map((c) => <option key={c.cliente_id} value={c.cliente_id}>{c.cliente_nome}</option>)}
          </select>
        </div>
        {cliente && (
          <Form1a1 key={cliente.cliente_id} clienteId={cliente.cliente_id} clienteNome={cliente.cliente_nome}
            variante={variante} onSalvo={onSalvo} onCancelar={onFechar} />
        )}
      </div>
    </div>
  );
}
