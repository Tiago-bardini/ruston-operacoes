"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Forecast } from "@/lib/types";
import { MESES_LABEL, formatBRL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

const ANO_ATUAL = new Date().getFullYear();
const MES_ATUAL = new Date().getMonth() + 1;
const ANOS = [ANO_ATUAL - 1, ANO_ATUAL, ANO_ATUAL + 1];

export default function ForecastPage() {
  const supabase = createClient();
  const router = useRouter();
  const { loading: loadingPerfil, podeVerForecast } = useUsuarioPerfil();
  useEffect(() => {
    if (!loadingPerfil && !podeVerForecast) router.push("/cockpit");
  }, [loadingPerfil, podeVerForecast, router]);

  const [ano, setAno] = useState(ANO_ATUAL);
  const [forecast, setForecast] = useState<Forecast[]>([]);
  const [mrrAtual, setMrrAtual] = useState(0);
  const [clientesAtual, setClientesAtual] = useState(0);
  const [pessoasAtual, setPessoasAtual] = useState(0);
  const [folhaAtual, setFolhaAtual] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data: fc }, { data: cs }, { data: ps }] = await Promise.all([
      supabase.from("ruston_forecast").select("*").eq("ano", ano).order("mes"),
      supabase.from("ruston_clientes_view").select("mrr").eq("ativo", true),
      supabase.from("ruston_pessoas").select("salario").eq("ativo", true),
    ]);
    let lista = (fc as Forecast[]) ?? [];
    if (lista.length < 12) {
      const existentes = new Set(lista.map((f) => f.mes));
      const faltando = [];
      for (let m = 1; m <= 12; m++) {
        if (!existentes.has(m)) {
          faltando.push({ ano, mes: m, meta_mrr: Math.round((1000000 * m) / 12) });
        }
      }
      if (faltando.length > 0) {
        await supabase.from("ruston_forecast").insert(faltando);
        const { data: novo } = await supabase.from("ruston_forecast").select("*").eq("ano", ano).order("mes");
        lista = (novo as Forecast[]) ?? [];
      }
    }
    setForecast(lista);
    const clientes = (cs as { mrr: number }[]) ?? [];
    setMrrAtual(clientes.reduce((s, c) => s + (Number(c.mrr) || 0), 0));
    setClientesAtual(clientes.length);
    const pessoas = (ps as { salario: number | null }[]) ?? [];
    setPessoasAtual(pessoas.length);
    setFolhaAtual(pessoas.reduce((s, p) => s + (Number(p.salario) || 0), 0));
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [ano]);

  async function atualizar(f: Forecast, campo: keyof Forecast, valor: number | null) {
    setSaving(f.id);
    await supabase.from("ruston_forecast").update({ [campo]: valor }).eq("id", f.id);
    setSaving(null);
    load();
  }

  async function toggleFechado(f: Forecast) {
    if (!f.fechado) {
      // Fechar: salva snapshot
      const payload = {
        fechado: true,
        fechado_em: new Date().toISOString(),
        mrr_total_snapshot: mrrAtual,
        clientes_ativos_snapshot: clientesAtual,
        total_pessoas_snapshot: pessoasAtual,
        folha_snapshot: folhaAtual,
      };
      await supabase.from("ruston_forecast").update(payload).eq("id", f.id);
    } else {
      // Reabrir: limpa snapshot
      await supabase.from("ruston_forecast").update({
        fechado: false, fechado_em: null,
        mrr_total_snapshot: null, clientes_ativos_snapshot: null,
        total_pessoas_snapshot: null, folha_snapshot: null,
      }).eq("id", f.id);
    }
    load();
  }

  // ============ Cálculos ============
  // Se mês fechado, usa snapshot. Senão usa valor atual do sistema.
  function autoMrr(f: Forecast)      { return f.fechado ? (f.mrr_total_snapshot ?? 0)     : mrrAtual; }
  function autoClientes(f: Forecast) { return f.fechado ? (f.clientes_ativos_snapshot ?? 0): clientesAtual; }
  function autoPessoas(f: Forecast)  { return f.fechado ? (f.total_pessoas_snapshot ?? 0)  : pessoasAtual; }
  function autoFolha(f: Forecast)    { return f.fechado ? (f.folha_snapshot ?? 0)          : folhaAtual; }

  // ============ Métricas calculadas por mês ============

  interface MetricasMes {
    ticketMedio: number;
    revenueChurnPctReal: number;
    revenueChurnRs: number;
    receitaTotalProj: number;
    receitaTotalReal: number;
    folha: number;
    pctFolhaReceita: number;
    custoCabeca: number;
    produtividadeAbs: number;
    mrrTotal: number;
  }

  const metricasPorMes = useMemo(() => {
    const map = new Map<number, MetricasMes>();
    let mrrAnterior = 0;
    forecast.forEach((f) => {
      const mrr = autoMrr(f);
      const clientes = autoClientes(f);
      const pessoas = autoPessoas(f);
      const folha = autoFolha(f);
      const ticketMedio = clientes > 0 ? mrr / clientes : 0;
      // Revenue churn (%) — se mês fechado: churn_projetado. Se não: mesmo
      const revenueChurnPctReal = f.churn_projetado_pct ?? 0;
      const revenueChurnRs = mrrAnterior * ((f.churn_projetado_pct ?? 0) / 100);
      const oneTimeProj = (f.onetime_aquisicao_projetado ?? 0) + (f.onetime_upsell_projetado ?? 0);
      const oneTimeReal = (f.onetime_aquisicao_realizado ?? 0) + (f.onetime_upsell_realizado ?? 0);
      const receitaTotalProj = (f.meta_mrr ?? 0) + oneTimeProj;
      const receitaTotalReal = mrr + oneTimeReal;
      const pctFolhaReceita = receitaTotalReal > 0 ? (folha / receitaTotalReal) * 100 : 0;
      const custoCabeca = pessoas > 0 ? folha / pessoas : 0;
      const produtividadeAbs = folha > 0 ? mrr / folha : 0;
      map.set(f.mes, {
        ticketMedio, revenueChurnPctReal, revenueChurnRs,
        receitaTotalProj, receitaTotalReal, folha,
        pctFolhaReceita, custoCabeca, produtividadeAbs, mrrTotal: mrr,
      });
      mrrAnterior = mrr;
    });
    return map;
  }, [forecast, mrrAtual, clientesAtual, pessoasAtual, folhaAtual]);

  return (
    <div>
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold">Forecast Anual</h1>
          <p className="text-sm text-brand-muted">
            Painel FinOps mensal · MRR atual {formatBRL(mrrAtual)} · {clientesAtual} clientes · {pessoasAtual} pessoas · Folha {formatBRL(folhaAtual)}
          </p>
        </div>
        <select className="input max-w-[100px]" value={ano} onChange={(e) => setAno(Number(e.target.value))}>
          {ANOS.map((a) => <option key={a} value={a}>{a}</option>)}
        </select>
      </div>

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && (
        <div className="card overflow-x-auto p-0">
          <table className="text-xs" style={{ minWidth: 1800 }}>
            <thead>
              <tr className="border-b border-white/5 bg-brand-panel/30">
                <th className="sticky left-0 z-10 bg-brand-panel/90 px-3 py-3 text-left uppercase tracking-wide text-brand-muted min-w-[180px]">
                  Métrica
                </th>
                {forecast.map((f) => (
                  <th key={f.id} colSpan={2} className="px-2 py-3 text-center border-l border-white/5">
                    <div className="flex items-center justify-center gap-2">
                      <span>{MESES_LABEL[f.mes - 1]}/{String(ano).slice(-2)}</span>
                      <button
                        onClick={() => toggleFechado(f)}
                        className={`text-[9px] rounded px-1.5 py-0.5 border ${
                          f.fechado
                            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                            : "bg-white/5 text-brand-muted border-white/10 hover:text-gray-200"
                        }`}
                        title={f.fechado ? "Reabrir mês (destrava valores)" : "Fechar mês (congela valores)"}
                      >
                        {f.fechado ? "✓ fechado" : "fechar mês"}
                      </button>
                    </div>
                  </th>
                ))}
              </tr>
              <tr className="border-b border-white/5 text-[10px] uppercase text-brand-muted/70">
                <th className="sticky left-0 z-10 bg-brand-panel/90 px-3 py-2"></th>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <th className="px-2 py-2 text-center border-l border-white/5">Proj.</th>
                    <th className="px-2 py-2 text-center">Real.</th>
                  </React.Fragment>
                ))}
              </tr>
            </thead>
            <tbody>
              {/* Meta MRR */}
              <TrLinha titulo="Meta MRR" muted>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-1 py-1 border-l border-white/5">
                      <InputMini valor={f.meta_mrr}
                        onSalvar={(v) => atualizar(f, "meta_mrr", v)}
                        salvando={saving === f.id} />
                    </td>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Ticket Médio */}
              <TrLinha titulo="Ticket Médio" muted>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                    <td className="px-2 py-1 text-right">{formatBRL(metricasPorMes.get(f.mes)?.ticketMedio ?? 0)}</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* MRR Aquisição */}
              <TrLinha titulo="MRR Aquisição">
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-1 py-1 border-l border-white/5">
                      <InputMini valor={f.mrr_aquisicao_projetado}
                        onSalvar={(v) => atualizar(f, "mrr_aquisicao_projetado", v ?? 0)}
                        salvando={saving === f.id} />
                    </td>
                    <td className="px-1 py-1">
                      <InputMini valor={f.mrr_aquisicao_realizado}
                        onSalvar={(v) => atualizar(f, "mrr_aquisicao_realizado", v)}
                        salvando={saving === f.id} />
                    </td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* One time Aquisição */}
              <TrLinha titulo="One time Aquisição">
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-1 py-1 border-l border-white/5">
                      <InputMini valor={f.onetime_aquisicao_projetado}
                        onSalvar={(v) => atualizar(f, "onetime_aquisicao_projetado", v ?? 0)}
                        salvando={saving === f.id} />
                    </td>
                    <td className="px-1 py-1">
                      <InputMini valor={f.onetime_aquisicao_realizado}
                        onSalvar={(v) => atualizar(f, "onetime_aquisicao_realizado", v)}
                        salvando={saving === f.id} />
                    </td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* MRR Upsell */}
              <TrLinha titulo="MRR Upsell/Farmer">
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-1 py-1 border-l border-white/5">
                      <InputMini valor={f.mrr_upsell_projetado}
                        onSalvar={(v) => atualizar(f, "mrr_upsell_projetado", v ?? 0)}
                        salvando={saving === f.id} />
                    </td>
                    <td className="px-1 py-1">
                      <InputMini valor={f.mrr_upsell_realizado}
                        onSalvar={(v) => atualizar(f, "mrr_upsell_realizado", v)}
                        salvando={saving === f.id} />
                    </td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* One time Upsell */}
              <TrLinha titulo="One time Upsell">
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-1 py-1 border-l border-white/5">
                      <InputMini valor={f.onetime_upsell_projetado}
                        onSalvar={(v) => atualizar(f, "onetime_upsell_projetado", v ?? 0)}
                        salvando={saving === f.id} />
                    </td>
                    <td className="px-1 py-1">
                      <InputMini valor={f.onetime_upsell_realizado}
                        onSalvar={(v) => atualizar(f, "onetime_upsell_realizado", v)}
                        salvando={saving === f.id} />
                    </td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Clientes (auto) */}
              <TrLinha titulo="Clientes" muted>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                    <td className="px-2 py-1 text-right font-semibold">{autoClientes(f)}</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Clientes Churn */}
              <TrLinha titulo="Clientes Churn">
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-1 py-1 border-l border-white/5">
                      <InputMini valor={f.clientes_churn_projetado} inteiro
                        onSalvar={(v) => atualizar(f, "clientes_churn_projetado", v ?? 0)}
                        salvando={saving === f.id} />
                    </td>
                    <td className="px-1 py-1">
                      <InputMini valor={f.clientes_churn_realizado} inteiro
                        onSalvar={(v) => atualizar(f, "clientes_churn_realizado", v)}
                        salvando={saving === f.id} />
                    </td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Revenue Churn % */}
              <TrLinha titulo="Revenue Churn (%)">
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-1 py-1 border-l border-white/5">
                      <InputMini valor={f.churn_projetado_pct} suffix="%"
                        onSalvar={(v) => atualizar(f, "churn_projetado_pct", v ?? 0)}
                        salvando={saving === f.id} />
                    </td>
                    <td className="px-2 py-1 text-right text-brand-muted">
                      {(metricasPorMes.get(f.mes)?.revenueChurnPctReal ?? 0).toFixed(2)}%
                    </td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Revenue Churn R$ */}
              <TrLinha titulo="Revenue Churn (R$)" muted>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                    <td className="px-2 py-1 text-right">{formatBRL(metricasPorMes.get(f.mes)?.revenueChurnRs ?? 0)}</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Total pessoas */}
              <TrLinha titulo="Total pessoas" muted>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                    <td className="px-2 py-1 text-right font-semibold">{autoPessoas(f)}</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Folha */}
              <TrLinha titulo="Folha" muted>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                    <td className="px-2 py-1 text-right">{formatBRL(autoFolha(f))}</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* % Folha/Receita */}
              <TrLinha titulo="% Folha/Receita" muted>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                    <td className="px-2 py-1 text-right">
                      {(metricasPorMes.get(f.mes)?.pctFolhaReceita ?? 0).toFixed(2)}%
                    </td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Custo por cabeça */}
              <TrLinha titulo="Salário/cabeça" muted>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                    <td className="px-2 py-1 text-right">{formatBRL(metricasPorMes.get(f.mes)?.custoCabeca ?? 0)}</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* MRR Total */}
              <TrLinha titulo="MRR Total" destaque>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right">{formatBRL(f.meta_mrr ?? 0)}</td>
                    <td className="px-2 py-1 text-right font-bold text-brand">{formatBRL(metricasPorMes.get(f.mes)?.mrrTotal ?? 0)}</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Receita Total */}
              <TrLinha titulo="Receita Total" destaque>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right">{formatBRL(metricasPorMes.get(f.mes)?.receitaTotalProj ?? 0)}</td>
                    <td className="px-2 py-1 text-right font-bold text-emerald-300">{formatBRL(metricasPorMes.get(f.mes)?.receitaTotalReal ?? 0)}</td>
                  </React.Fragment>
                ))}
              </TrLinha>

              {/* Produtividade Absoluta */}
              <TrLinha titulo="Produtividade Absoluta" destaque>
                {forecast.map((f) => (
                  <React.Fragment key={f.id}>
                    <td className="px-2 py-1 text-right text-brand-muted">—</td>
                    <td className="px-2 py-1 text-right font-bold">
                      {(metricasPorMes.get(f.mes)?.produtividadeAbs ?? 0).toFixed(2)}
                    </td>
                  </React.Fragment>
                ))}
              </TrLinha>
            </tbody>
          </table>
        </div>
      )}

      <p className="mt-4 text-[10px] text-brand-muted">
        <strong>Automático:</strong> Ticket Médio · Clientes · Total Pessoas · Folha · % Folha/Receita · Salário/cabeça · Produtividade Absoluta · Revenue Churn R$
        <br />
        <strong>Fechar mês:</strong> congela os valores automáticos daquele mês (snapshot). Reabrir permite recalcular novamente com dados atuais.
        <br />
        <strong>Produtividade Absoluta:</strong> MRR ÷ Folha (quantas vezes o MRR cobre a folha salarial)
      </p>
    </div>
  );
}

/* ============================== SUBCOMPONENTES ============================== */

function TrLinha({ titulo, muted, destaque, children }: {
  titulo: string; muted?: boolean; destaque?: boolean; children: React.ReactNode;
}) {
  return (
    <tr className={`border-b border-white/5 ${destaque ? "bg-brand/5 font-semibold" : ""}`}>
      <td className={`sticky left-0 z-10 bg-brand-panel/95 px-3 py-1 whitespace-nowrap ${muted ? "text-brand-muted" : ""} ${destaque ? "text-white font-bold" : ""}`}>
        {titulo}
      </td>
      {children}
    </tr>
  );
}

function InputMini({ valor, onSalvar, salvando, suffix, inteiro }: {
  valor: number | null;
  onSalvar: (v: number | null) => void;
  salvando?: boolean;
  suffix?: string;
  inteiro?: boolean;
}) {
  const [v, setV] = useState<string>(valor != null ? String(valor) : "");
  useEffect(() => { setV(valor != null ? String(valor) : ""); }, [valor]);
  return (
    <div className="flex items-center gap-0.5">
      <input
        type="number"
        step={inteiro ? "1" : "0.01"}
        className="input py-0.5 px-1 text-right text-[11px] w-full"
        value={v}
        placeholder="—"
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          const num = v === "" ? null : Number(v);
          if (num !== valor) onSalvar(num);
        }}
      />
      {suffix && <span className="text-[9px] text-brand-muted">{suffix}</span>}
      {salvando && <span className="text-[9px] text-brand-muted">…</span>}
    </div>
  );
}
