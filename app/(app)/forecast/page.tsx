"use client";

import { useEffect, useState, useMemo } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Forecast, ClienteView } from "@/lib/types";
import { MESES_LABEL, formatBRL } from "@/lib/types";

const ANO_ATUAL = new Date().getFullYear();
const MES_ATUAL = new Date().getMonth() + 1;
const ANOS = [ANO_ATUAL - 1, ANO_ATUAL, ANO_ATUAL + 1];

type Cenario = "realista" | "otimista" | "pessimista";

export default function ForecastPage() {
  const supabase = createClient();
  const [ano, setAno] = useState(ANO_ATUAL);
  const [forecast, setForecast] = useState<Forecast[]>([]);
  const [mrrAtual, setMrrAtual] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: fc }, { data: cs }] = await Promise.all([
      supabase.from("ruston_forecast").select("*").eq("ano", ano).order("mes"),
      supabase.from("ruston_clientes_view").select("mrr").eq("ativo", true),
    ]);
    let lista = (fc as Forecast[]) ?? [];
    // Se o ano não tem os 12 meses, cria automático
    if (lista.length < 12) {
      const existentes = new Set(lista.map((f) => f.mes));
      const faltando = [];
      for (let m = 1; m <= 12; m++) {
        if (!existentes.has(m)) {
          faltando.push({
            ano, mes: m,
            meta_mrr: Math.round((1000000 * m) / 12),
            churn_projetado_pct: 5,
            novos_contratos_valor: 0,
          });
        }
      }
      if (faltando.length > 0) {
        await supabase.from("ruston_forecast").insert(faltando);
        const { data: novo } = await supabase.from("ruston_forecast").select("*").eq("ano", ano).order("mes");
        lista = (novo as Forecast[]) ?? [];
      }
    }
    setForecast(lista);
    const mrrTotal = ((cs as { mrr: number }[]) ?? []).reduce((s, c) => s + (Number(c.mrr) || 0), 0);
    setMrrAtual(mrrTotal);
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano]);

  async function atualizar(f: Forecast, campo: keyof Forecast, valor: number | null) {
    setSaving(f.id);
    await supabase.from("ruston_forecast").update({ [campo]: valor }).eq("id", f.id);
    setSaving(null);
    load();
  }

  // ============ Cálculo de cenários ============
  // Para cada mês: MRR = MRR anterior × (1 - churn/100) + novos_contratos
  // Realista: valores do user
  // Otimista: churn -1pp / novos +20%
  // Pessimista: churn +1pp / novos -20%

  const cenarios = useMemo(() => {
    const calc = (ajusteChurn: number, ajusteNovos: number) => {
      let mrrAcumulado = mrrAtual;
      return forecast.map((f) => {
        const churn = Math.max(0, (f.churn_projetado_pct ?? 5) + ajusteChurn);
        const novos = Math.max(0, (f.novos_contratos_valor ?? 0) * ajusteNovos);
        mrrAcumulado = mrrAcumulado * (1 - churn / 100) + novos;
        const gap = (f.meta_mrr ?? 0) - mrrAcumulado;
        return {
          mes: f.mes,
          mrrProjetado: Math.round(mrrAcumulado),
          gap: Math.round(gap),
          bateu: mrrAcumulado >= (f.meta_mrr ?? 0),
        };
      });
    };
    return {
      realista:   calc(0, 1),
      otimista:   calc(-1, 1.2),
      pessimista: calc(+1, 0.8),
    };
  }, [forecast, mrrAtual]);

  const totalNovosContratos = forecast.reduce((s, f) => s + (f.novos_contratos_valor || 0), 0);
  const mrrFinalRealista = cenarios.realista[11]?.mrrProjetado ?? 0;
  const mrrFinalOtimista = cenarios.otimista[11]?.mrrProjetado ?? 0;
  const mrrFinalPessimista = cenarios.pessimista[11]?.mrrProjetado ?? 0;
  const metaFinal = forecast[11]?.meta_mrr ?? 0;

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Forecast Anual</h1>
          <p className="text-sm text-brand-muted">
            Projeção mensal de MRR com 3 cenários · MRR atual: {formatBRL(mrrAtual)}
          </p>
        </div>
        <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
          {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && (
        <>
          {/* Cards de fechamento anual (dezembro projetado × meta) */}
          <div className="mb-6 grid grid-cols-1 gap-3 md:grid-cols-4">
            <CardCenario
              nome="Meta dez"
              valor={metaFinal}
              cor="text-brand"
              sublabel="objetivo do ano"
            />
            <CardCenario
              nome="Otimista"
              valor={mrrFinalOtimista}
              cor="text-emerald-300"
              sublabel={`${((mrrFinalOtimista / (metaFinal || 1)) * 100).toFixed(0)}% da meta`}
            />
            <CardCenario
              nome="Realista"
              valor={mrrFinalRealista}
              cor="text-amber-300"
              sublabel={`${((mrrFinalRealista / (metaFinal || 1)) * 100).toFixed(0)}% da meta`}
            />
            <CardCenario
              nome="Pessimista"
              valor={mrrFinalPessimista}
              cor="text-red-300"
              sublabel={`${((mrrFinalPessimista / (metaFinal || 1)) * 100).toFixed(0)}% da meta`}
            />
          </div>

          <p className="mb-3 text-[10px] text-brand-muted">
            📊 Otimista: churn -1pp, novos contratos +20% · Realista: seus valores · Pessimista: churn +1pp, novos contratos -20%
          </p>

          {/* Tabela mensal editável */}
          <div className="card overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                  <th className="px-3 py-3">Mês</th>
                  <th className="px-3 py-3 text-center w-32">Meta MRR</th>
                  <th className="px-3 py-3 text-center w-24">Churn %</th>
                  <th className="px-3 py-3 text-center w-32">Novos contratos</th>
                  <th className="px-3 py-3 text-center w-32">Realizado</th>
                  <th className="px-3 py-3 text-center w-32 text-emerald-300">Otimista</th>
                  <th className="px-3 py-3 text-center w-32 text-amber-300">Realista</th>
                  <th className="px-3 py-3 text-center w-32 text-red-300">Pessimista</th>
                </tr>
              </thead>
              <tbody>
                {forecast.map((f, i) => {
                  const eOtim = cenarios.otimista[i];
                  const eReal = cenarios.realista[i];
                  const ePess = cenarios.pessimista[i];
                  const isMesAtual = f.mes === MES_ATUAL && ano === ANO_ATUAL;
                  return (
                    <tr key={f.id}
                      className={`border-b border-white/5 last:border-0 ${isMesAtual ? "bg-brand/5" : ""}`}>
                      <td className="px-3 py-2 font-medium">
                        {MESES_LABEL[f.mes - 1]}
                        {isMesAtual && <span className="ml-1 text-[9px] text-brand">atual</span>}
                      </td>
                      <td className="px-3 py-2">
                        <InputNum
                          valor={f.meta_mrr}
                          onSalvar={(v) => atualizar(f, "meta_mrr", v)}
                          salvando={saving === f.id}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <InputNum
                          valor={f.churn_projetado_pct}
                          onSalvar={(v) => atualizar(f, "churn_projetado_pct", v ?? 0)}
                          salvando={saving === f.id}
                          suffix="%"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <InputNum
                          valor={f.novos_contratos_valor}
                          onSalvar={(v) => atualizar(f, "novos_contratos_valor", v ?? 0)}
                          salvando={saving === f.id}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <InputNum
                          valor={f.mrr_realizado}
                          onSalvar={(v) => atualizar(f, "mrr_realizado", v)}
                          salvando={saving === f.id}
                        />
                      </td>
                      <td className="px-3 py-2 text-right text-emerald-300 font-medium">
                        {formatBRL(eOtim.mrrProjetado)}
                      </td>
                      <td className="px-3 py-2 text-right text-amber-300 font-medium">
                        {formatBRL(eReal.mrrProjetado)}
                      </td>
                      <td className="px-3 py-2 text-right text-red-300 font-medium">
                        {formatBRL(ePess.mrrProjetado)}
                      </td>
                    </tr>
                  );
                })}
                {/* Linha total */}
                <tr className="border-t-2 border-white/10 font-semibold">
                  <td className="px-3 py-3">Total ano</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 text-right">{formatBRL(totalNovosContratos)}</td>
                  <td className="px-3 py-3"></td>
                  <td className="px-3 py-3 text-right text-emerald-300">{formatBRL(mrrFinalOtimista)}</td>
                  <td className="px-3 py-3 text-right text-amber-300">{formatBRL(mrrFinalRealista)}</td>
                  <td className="px-3 py-3 text-right text-red-300">{formatBRL(mrrFinalPessimista)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Gráfico visual */}
          <div className="mt-6 card">
            <p className="mb-3 text-sm font-semibold">📈 Evolução mensal — 3 cenários</p>
            <div className="flex items-end gap-1 h-40">
              {forecast.map((f, i) => {
                const otim = cenarios.otimista[i].mrrProjetado;
                const real = cenarios.realista[i].mrrProjetado;
                const pess = cenarios.pessimista[i].mrrProjetado;
                const max = Math.max(mrrFinalOtimista, metaFinal) * 1.1 || 1;
                return (
                  <div key={f.id} className="flex flex-1 flex-col items-center gap-1">
                    <div className="w-full flex-1 flex items-end gap-0.5">
                      <div className="flex-1 bg-emerald-500/70 rounded-t" style={{ height: `${(otim / max) * 100}%` }} title={`Otim ${formatBRL(otim)}`} />
                      <div className="flex-1 bg-amber-500/70 rounded-t" style={{ height: `${(real / max) * 100}%` }} title={`Real ${formatBRL(real)}`} />
                      <div className="flex-1 bg-red-500/70 rounded-t" style={{ height: `${(pess / max) * 100}%` }} title={`Pess ${formatBRL(pess)}`} />
                    </div>
                    <p className="text-[9px] text-brand-muted">{MESES_LABEL[f.mes - 1].slice(0, 3)}</p>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function CardCenario({ nome, valor, cor, sublabel }: {
  nome: string; valor: number; cor: string; sublabel: string;
}) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{nome}</p>
      <p className={`mt-1 text-xl font-bold ${cor}`}>{formatBRL(valor)}</p>
      <p className="text-[10px] text-brand-muted">{sublabel}</p>
    </div>
  );
}

function InputNum({ valor, onSalvar, salvando, suffix }: {
  valor: number | null;
  onSalvar: (v: number | null) => void;
  salvando?: boolean;
  suffix?: string;
}) {
  const [v, setV] = useState<string>(valor != null ? String(valor) : "");
  useEffect(() => { setV(valor != null ? String(valor) : ""); }, [valor]);
  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        step="0.01"
        className="input py-1 text-right text-sm w-full"
        value={v}
        placeholder="—"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const num = v === "" ? null : Number(v);
          if (num !== valor) onSalvar(num);
        }}
      />
      {suffix && <span className="text-[10px] text-brand-muted">{suffix}</span>}
      {salvando && <span className="text-[10px] text-brand-muted">...</span>}
    </div>
  );
}
