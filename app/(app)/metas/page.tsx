"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { MetaEmpresa, UnidadeMeta } from "@/lib/types";
import { MESES_LABEL, UNIDADE_LABEL } from "@/lib/types";

type Tab = "empresa" | "squads" | "okrs";

const ANO_ATUAL = new Date().getFullYear();
const MES_ATUAL = new Date().getMonth() + 1;
const ANOS = [ANO_ATUAL - 1, ANO_ATUAL, ANO_ATUAL + 1];

const CATALOGO_EMPRESA: {
  metrica: string; label: string; unidade: UnidadeMeta; valor: number; ordem: number;
}[] = [
  { metrica: "churn",                  label: "Churn",                                    unidade: "percentual", valor: 5,     ordem: 1 },
  { metrica: "respostas_pesquisa",     label: "Respostas nas pesquisas de satisfação",    unidade: "percentual", valor: 80,    ordem: 2 },
  { metrica: "nps_medio",              label: "NPS Médio",                                unidade: "nota",       valor: 8.5,   ordem: 3 },
  { metrica: "csat_medio",             label: "CSAT Médio",                               unidade: "nota",       valor: 4,     ordem: 4 },
  { metrica: "clientes_safe",          label: "Clientes em Safe",                         unidade: "percentual", valor: 60,    ordem: 5 },
  { metrica: "clientes_roi_positivo",  label: "Clientes com ROI Positivo",                unidade: "percentual", valor: 50,    ordem: 6 },
  { metrica: "timer",                  label: "Timer",                                    unidade: "percentual", valor: 85,    ordem: 7 },
  { metrica: "upsell_mrr",             label: "Upsell MRR",                               unidade: "reais",      valor: 15000, ordem: 8 },
  { metrica: "upsell_one_time",        label: "Upsell One Time",                          unidade: "reais",      valor: 30000, ordem: 9 },
  { metrica: "indicacoes",             label: "Indicações",                               unidade: "quantidade", valor: 20,    ordem: 10 },
  { metrica: "renovacao_contratos",    label: "Taxa de renovação de contratos",           unidade: "percentual", valor: 80,    ordem: 11 },
  { metrica: "cumprimento_okrs_time",  label: "Cumprimento agregado das OKRs do time",    unidade: "percentual", valor: 70,    ordem: 12 },
];

export default function MetasPage() {
  const [tab, setTab] = useState<Tab>("empresa");

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Metas</h1>
        <p className="text-sm text-brand-muted">
          Metas de empresa, squads e OKRs dos investidores — editáveis mês a mês
        </p>
      </div>

      <div className="mb-6 inline-flex rounded-lg border border-white/10 bg-brand-panel/50 p-1">
        {[
          { v: "empresa", label: "Empresa" },
          { v: "squads",  label: "Squads" },
          { v: "okrs",    label: "OKRs (Régua)" },
        ].map((it) => (
          <button
            key={it.v}
            onClick={() => setTab(it.v as Tab)}
            className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
              tab === it.v ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"
            }`}
          >
            {it.label}
          </button>
        ))}
      </div>

      {tab === "empresa" && <TabEmpresa />}
      {tab === "squads"  && <TabPlaceholder titulo="Squads"      texto="Em construção — Etapa 2 da Sprint de Metas." />}
      {tab === "okrs"    && <TabPlaceholder titulo="OKRs (Régua)" texto="Em construção — Etapa 3 da Sprint de Metas." />}
    </div>
  );
}

/* ============================== TAB EMPRESA ============================== */

function TabEmpresa() {
  const supabase = createClient();
  const [ano, setAno] = useState(ANO_ATUAL);
  const [mes, setMes] = useState(MES_ATUAL);
  const [metas, setMetas] = useState<MetaEmpresa[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase
      .from("ruston_metas_empresa")
      .select("*")
      .eq("ano", ano).eq("mes", mes)
      .order("ordem");
    const lista = (data as MetaEmpresa[]) ?? [];
    // Se não tem as 12 métricas no mês, cria automaticamente
    if (lista.length < CATALOGO_EMPRESA.length) {
      const existentes = new Set(lista.map((m) => m.metrica));
      const faltando = CATALOGO_EMPRESA.filter((c) => !existentes.has(c.metrica));
      if (faltando.length > 0) {
        const payload = faltando.map((c) => ({
          ano, mes,
          metrica: c.metrica,
          metrica_label: c.label,
          unidade: c.unidade,
          valor_meta: c.valor,
          ordem: c.ordem,
        }));
        await supabase.from("ruston_metas_empresa").insert(payload);
        const { data: novo } = await supabase
          .from("ruston_metas_empresa")
          .select("*")
          .eq("ano", ano).eq("mes", mes)
          .order("ordem");
        setMetas((novo as MetaEmpresa[]) ?? []);
        setLoading(false);
        return;
      }
    }
    setMetas(lista);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano, mes]);

  async function atualizarValor(m: MetaEmpresa, campo: "valor_meta" | "valor_realizado", valor: number | null) {
    setSaving(m.id);
    await supabase.from("ruston_metas_empresa")
      .update({ [campo]: valor })
      .eq("id", m.id);
    setSaving(null);
    load();
  }

  async function atualizarObs(m: MetaEmpresa, obs: string) {
    if (obs === (m.observacoes ?? "")) return;
    setSaving(m.id);
    await supabase.from("ruston_metas_empresa").update({ observacoes: obs || null }).eq("id", m.id);
    setSaving(null);
    load();
  }

  const totalCampos = metas.length;
  const preenchidos = metas.filter((m) => m.valor_realizado != null).length;
  const batidos = metas.filter((m) => {
    if (m.valor_realizado == null) return false;
    if (m.metrica === "churn") return m.valor_realizado <= m.valor_meta;
    return m.valor_realizado >= m.valor_meta;
  }).length;

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select className="input max-w-[160px]" value={mes} onChange={(e) => setMes(Number(e.target.value))}>
          {MESES_LABEL.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
        </select>
        <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
          {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
        <div className="ml-auto flex items-center gap-4 text-xs">
          <span className="text-brand-muted"><strong className="text-white">{preenchidos}</strong>/{totalCampos} preenchidas</span>
          <span className="text-emerald-300">{batidos} batidas</span>
        </div>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
              <th className="px-4 py-3">Métrica</th>
              <th className="px-4 py-3 w-48">Meta</th>
              <th className="px-4 py-3 w-48">Realizado</th>
              <th className="px-4 py-3 w-32">Status</th>
              <th className="px-4 py-3">Observações</th>
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-brand-muted">Carregando...</td></tr>
            )}
            {!loading && metas.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-brand-muted">
                Preparando as 12 métricas para {MESES_LABEL[mes - 1]}/{ano}...
              </td></tr>
            )}
            {!loading && metas.map((m) => {
              const bateu = m.valor_realizado != null && (
                m.metrica === "churn"
                  ? m.valor_realizado <= m.valor_meta
                  : m.valor_realizado >= m.valor_meta
              );
              const naoBateu = m.valor_realizado != null && !bateu;
              return (
                <tr key={m.id} className="border-b border-white/5 last:border-0">
                  <td className="px-4 py-3 font-medium">{m.metrica_label}</td>
                  <td className="px-4 py-3">
                    <InputMeta
                      valor={m.valor_meta}
                      unidade={m.unidade}
                      onSalvar={(v) => atualizarValor(m, "valor_meta", v ?? 0)}
                      salvando={saving === m.id}
                    />
                  </td>
                  <td className="px-4 py-3">
                    <InputMeta
                      valor={m.valor_realizado}
                      unidade={m.unidade}
                      onSalvar={(v) => atualizarValor(m, "valor_realizado", v)}
                      salvando={saving === m.id}
                      placeholder="—"
                    />
                  </td>
                  <td className="px-4 py-3">
                    {m.valor_realizado == null && <span className="text-xs text-brand-muted">Sem dado</span>}
                    {bateu && <span className="badge bg-emerald-500/15 text-emerald-300 border-emerald-500/30">✓ Bateu</span>}
                    {naoBateu && <span className="badge bg-red-500/15 text-red-300 border-red-500/30">Abaixo</span>}
                  </td>
                  <td className="px-4 py-3">
                    <input
                      className="input py-1 text-xs"
                      defaultValue={m.observacoes ?? ""}
                      onBlur={(e) => atualizarObs(m, e.target.value)}
                      placeholder="—"
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ============================== INPUT DE META ============================== */

function InputMeta({
  valor, unidade, onSalvar, salvando, placeholder,
}: {
  valor: number | null;
  unidade: UnidadeMeta;
  onSalvar: (v: number | null) => void;
  salvando?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState<string>(valor != null ? String(valor) : "");

  useEffect(() => { setV(valor != null ? String(valor) : ""); }, [valor]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        step="0.01"
        className="input py-1 text-sm"
        value={v}
        placeholder={placeholder}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const num = v === "" ? null : Number(v);
          if (num !== valor) onSalvar(num);
        }}
      />
      <span className="text-[10px] text-brand-muted w-8">{UNIDADE_LABEL[unidade]}</span>
      {salvando && <span className="text-[10px] text-brand-muted">...</span>}
    </div>
  );
}

/* ============================== PLACEHOLDER ============================== */

function TabPlaceholder({ titulo, texto }: { titulo: string; texto: string }) {
  return (
    <div className="card text-center py-16">
      <p className="mb-2 text-lg font-semibold">{titulo}</p>
      <p className="text-sm text-brand-muted">{texto}</p>
    </div>
  );
}
