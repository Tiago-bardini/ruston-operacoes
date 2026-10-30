"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatDate } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

/* ============================== TRATATIVAS DE CHURN ==============================
   O que o time realmente fez para resolver o problema do cliente (tabela
   ruston_tratativas_churn, migration 018). Fica dentro do card do Radar de Churn. */

export type TipoTratativa = "reuniao_stakeholder" | "ligacao" | "ajuste_entrega" | "troca_time" | "negociacao" | "fca_dossie" | "outro";
export type ResultadoTratativa = "resolvido" | "em_andamento" | "sem_efeito";

export type Tratativa = {
  id: string;
  cliente_id: string;
  data_acao: string;
  tipo: TipoTratativa;
  descricao: string;
  link_drive: string | null;
  resultado: ResultadoTratativa;
  proximo_passo: string | null;
  proximo_passo_data: string | null;
  registrado_por: string | null;
  criado_em: string;
};

export const TIPO_TRATATIVA_LABEL: Record<TipoTratativa, string> = {
  reuniao_stakeholder: "Reunião com stakeholder",
  ligacao: "Ligação",
  ajuste_entrega: "Ajuste de entrega",
  troca_time: "Troca de time / GP",
  negociacao: "Negociação comercial",
  fca_dossie: "FCA / dossiê",
  outro: "Outro",
};

export const RESULTADO_TRATATIVA: Record<ResultadoTratativa, { label: string; cor: string }> = {
  resolvido: { label: "Resolvido", cor: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  em_andamento: { label: "Em andamento", cor: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  sem_efeito: { label: "Sem efeito", cor: "border-red-500/40 bg-red-500/10 text-red-300" },
};

/** Dias desde a data (YYYY-MM-DD) até hoje */
export function diasDesde(data: string): number {
  const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
  return Math.round((hoje.getTime() - new Date(data + "T00:00:00").getTime()) / 86400000);
}

const hojeISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const formVazio = () => ({
  data_acao: hojeISO(),
  tipo: "reuniao_stakeholder" as TipoTratativa,
  descricao: "",
  link_drive: "",
  resultado: "em_andamento" as ResultadoTratativa,
  proximo_passo: "",
  proximo_passo_data: "",
});

export default function Tratativas({ clienteId, tratativas, onChange }: {
  clienteId: string;
  tratativas: Tratativa[];
  onChange: (lista: Tratativa[]) => void;
}) {
  const supabase = createClient();
  const { podeEditar, isGerente, email } = useUsuarioPerfil();
  const [form, setForm] = useState(formVazio());
  const [editando, setEditando] = useState<string | null>(null);
  const [aberto, setAberto] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  const podeMexer = (t: Tratativa) => isGerente || (podeEditar && !!email && t.registrado_por?.toLowerCase() === email.toLowerCase());

  function novo() {
    setForm(formVazio());
    setEditando(null);
    setErro(null);
    setAberto(true);
  }

  function editar(t: Tratativa) {
    setForm({
      data_acao: t.data_acao,
      tipo: t.tipo,
      descricao: t.descricao,
      link_drive: t.link_drive ?? "",
      resultado: t.resultado,
      proximo_passo: t.proximo_passo ?? "",
      proximo_passo_data: t.proximo_passo_data ?? "",
    });
    setEditando(t.id);
    setErro(null);
    setAberto(true);
  }

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.descricao.trim()) { setErro("Descreva o que foi feito."); return; }
    let link = form.link_drive.trim();
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;
    setSalvando(true);
    setErro(null);
    const payload = {
      cliente_id: clienteId,
      data_acao: form.data_acao || hojeISO(),
      tipo: form.tipo,
      descricao: form.descricao.trim(),
      link_drive: link || null,
      resultado: form.resultado,
      proximo_passo: form.proximo_passo.trim() || null,
      proximo_passo_data: form.proximo_passo_data || null,
    };
    const { data, error } = editando
      ? await supabase.from("ruston_tratativas_churn").update({ ...payload, atualizado_em: new Date().toISOString() }).eq("id", editando).select().single()
      : await supabase.from("ruston_tratativas_churn").insert(payload).select().single();
    setSalvando(false);
    if (error || !data) { setErro(error?.message ?? "Não foi possível salvar."); return; }
    const salvo = data as Tratativa;
    const lista = editando ? tratativas.map((t) => (t.id === editando ? salvo : t)) : [salvo, ...tratativas];
    onChange(lista.sort((a, b) => b.data_acao.localeCompare(a.data_acao) || b.criado_em.localeCompare(a.criado_em)));
    setAberto(false);
    setEditando(null);
  }

  async function excluir(t: Tratativa) {
    if (!confirm("Excluir esta tratativa?")) return;
    const { error } = await supabase.from("ruston_tratativas_churn").delete().eq("id", t.id);
    if (error) { setErro(error.message); return; }
    onChange(tratativas.filter((x) => x.id !== t.id));
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-[10px] font-semibold uppercase tracking-wide text-brand-muted">
          Tratativas realizadas {tratativas.length > 0 && `· ${tratativas.length}`}
        </p>
        {podeEditar && !aberto && (
          <button className="btn px-3 py-1 text-xs" onClick={novo}>+ Registrar tratativa</button>
        )}
      </div>
      {erro && !aberto && <p className="mb-2 text-xs text-red-300">{erro}</p>}

      {aberto && (
        <form onSubmit={salvar} className="mb-3 space-y-3 rounded-lg border border-white/10 bg-black/20 p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="label">Data da ação</label>
              <input type="date" className="input" value={form.data_acao} onChange={(e) => setForm({ ...form, data_acao: e.target.value })} />
            </div>
            <div>
              <label className="label">Tipo de ação</label>
              <select className="input" value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as TipoTratativa })}>
                {(Object.keys(TIPO_TRATATIVA_LABEL) as TipoTratativa[]).map((k) => <option key={k} value={k}>{TIPO_TRATATIVA_LABEL[k]}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Resultado</label>
              <select className="input" value={form.resultado} onChange={(e) => setForm({ ...form, resultado: e.target.value as ResultadoTratativa })}>
                {(Object.keys(RESULTADO_TRATATIVA) as ResultadoTratativa[]).map((k) => <option key={k} value={k}>{RESULTADO_TRATATIVA[k].label}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className="label">O que foi feito *</label>
            <textarea className="input min-h-[90px]" placeholder="Descreva a ação realizada, com quem falou e o que foi combinado..."
              value={form.descricao} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
          </div>
          <div>
            <label className="label">Link do Drive</label>
            <input className="input" placeholder="https://drive.google.com/..." value={form.link_drive}
              onChange={(e) => setForm({ ...form, link_drive: e.target.value })} />
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_180px]">
            <div>
              <label className="label">Próximo passo</label>
              <input className="input" placeholder="Ex.: reunião de acompanhamento com o sócio" value={form.proximo_passo}
                onChange={(e) => setForm({ ...form, proximo_passo: e.target.value })} />
            </div>
            <div>
              <label className="label">Data do próximo passo</label>
              <input type="date" className="input" value={form.proximo_passo_data}
                onChange={(e) => setForm({ ...form, proximo_passo_data: e.target.value })} />
            </div>
          </div>
          {erro && <p className="text-xs text-red-300">{erro}</p>}
          <div className="flex gap-2">
            <button type="submit" className="btn px-4 py-1.5 text-xs" disabled={salvando}>
              {salvando ? "Salvando..." : editando ? "Salvar alterações" : "Registrar"}
            </button>
            <button type="button" className="btn-ghost px-4 py-1.5 text-xs" onClick={() => { setAberto(false); setEditando(null); setErro(null); }}>
              Cancelar
            </button>
          </div>
        </form>
      )}

      {tratativas.length === 0 && !aberto && (
        <p className="text-xs text-brand-muted">Nenhuma tratativa registrada ainda. Registre aqui o que o time fez para resolver o problema do cliente.</p>
      )}

      <ul className="space-y-2">
        {tratativas.map((t) => {
          const res = RESULTADO_TRATATIVA[t.resultado];
          const passoVencido = t.proximo_passo_data && t.resultado !== "resolvido" && diasDesde(t.proximo_passo_data) > 0;
          return (
            <li key={t.id} className="rounded-lg border border-white/5 bg-black/20 p-3 text-xs">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-semibold">{formatDate(t.data_acao)}</span>
                <span className="badge border-white/10 text-[10px] text-gray-300">{TIPO_TRATATIVA_LABEL[t.tipo]}</span>
                <span className={`badge text-[10px] ${res.cor}`}>{res.label}</span>
                {t.link_drive && (
                  <a href={t.link_drive} target="_blank" rel="noopener noreferrer" className="text-brand hover:underline">📎 Drive</a>
                )}
                {podeMexer(t) && (
                  <span className="ml-auto flex gap-2">
                    <button className="text-brand-muted hover:text-white" onClick={() => editar(t)}>Editar</button>
                    <button className="text-brand-muted hover:text-red-300" onClick={() => excluir(t)}>Excluir</button>
                  </span>
                )}
              </div>
              <p className="mt-1.5 whitespace-pre-wrap text-gray-200">{t.descricao}</p>
              {t.proximo_passo && (
                <p className={`mt-1.5 ${passoVencido ? "text-red-300" : "text-gray-300"}`}>
                  <span className="text-brand-muted">Próximo passo: </span>{t.proximo_passo}
                  {t.proximo_passo_data && ` · ${formatDate(t.proximo_passo_data)}`}
                  {passoVencido && " (vencido)"}
                </p>
              )}
              <p className="mt-1 text-[10px] text-brand-muted">Registrado por {t.registrado_por ?? "—"}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
