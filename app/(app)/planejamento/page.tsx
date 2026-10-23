"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import type { ClienteView } from "@/lib/types";
import { formatBRL, formatDate, MESES_LABEL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import SubAbas from "@/components/SubAbas";
import {
  type PontoEquilibrioInput, type ForecastInput, type PlanejamentoCliente,
  type CenarioPe, type ColunaForecast, type CustoFixoFcKey,
  CUSTOS_VAR_PE, CUSTOS_FIXOS_PE, CUSTOS_FIXOS_FC, CUSTOS_VAR_FC,
  PE_PADRAO, forecastPadrao, comPadraoPe, comPadraoForecast,
  calcularPontoEquilibrio, calcularForecast, formatNum, formatPct,
} from "@/lib/planejamento";

type Aba = "ponto_equilibrio" | "forecast";

// Campo que o GP preenche (as células amarelas da planilha)
const PREENCHER = "border-amber-400/40 bg-amber-400/5";

export default function PlanejamentoPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, isGerente, squadId } = useUsuarioPerfil();
  // Planejamento é preenchido pelos GPs: gerente, coordenador e investidor editam
  const podeEditar = true;
  const [aba, setAba] = useState<Aba>("ponto_equilibrio");
  const [clientes, setClientes] = useState<ClienteView[]>([]);
  const [salvos, setSalvos] = useState<Record<string, PlanejamentoCliente>>({});
  const [clienteId, setClienteId] = useState("");
  const [pe, setPe] = useState<PontoEquilibrioInput>(PE_PADRAO);
  const [fc, setFc] = useState<ForecastInput>(forecastPadrao());
  const [alterado, setAlterado] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data: cs }, { data: pl }] = await Promise.all([
      supabase.from("ruston_clientes_view").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_cliente_planejamento").select("*"),
    ]);
    const lista = ((cs as ClienteView[]) ?? []).filter((c) =>
      !c.churn_realizado && (isGerente || !squadId || c.squad_id === squadId)
    );
    setClientes(lista);
    const mapa: Record<string, PlanejamentoCliente> = {};
    ((pl as PlanejamentoCliente[]) ?? []).forEach((p) => { mapa[p.cliente_id] = p; });
    setSalvos(mapa);
    setLoading(false);
    // Link direto da Carteira: /planejamento?cliente=<id>
    const daUrl = new URLSearchParams(window.location.search).get("cliente");
    const inicial = lista.find((c) => c.id === daUrl)?.id ?? lista[0]?.id ?? "";
    abrir(inicial, mapa);
  }

  useEffect(() => {
    if (!loadingPerfil) load();
    // eslint-disable-next-line
  }, [loadingPerfil]);

  function abrir(id: string, mapa = salvos) {
    setClienteId(id);
    setPe(comPadraoPe(mapa[id]?.ponto_equilibrio));
    setFc(comPadraoForecast(mapa[id]?.forecast));
    setAlterado(false);
    if (id) {
      const url = new URL(window.location.href);
      url.searchParams.set("cliente", id);
      window.history.replaceState(null, "", url.toString());
    }
  }

  function trocarCliente(id: string) {
    if (alterado && !confirm("Tem alterações não salvas neste cliente. Trocar mesmo assim?")) return;
    abrir(id);
  }

  async function salvar() {
    if (!clienteId) return;
    setSalvando(true);
    const payload = { cliente_id: clienteId, ponto_equilibrio: pe, forecast: fc, updated_at: new Date().toISOString() };
    const { data, error } = await supabase
      .from("ruston_cliente_planejamento")
      .upsert(payload, { onConflict: "cliente_id" })
      .select()
      .single();
    setSalvando(false);
    if (error) return; // o AvisoErro já mostra a falha
    setSalvos((s) => ({ ...s, [clienteId]: data as PlanejamentoCliente }));
    setAlterado(false);
  }

  function restaurarPadrao() {
    if (!confirm(aba === "forecast"
      ? "Voltar o Forecast deste cliente pro modelo padrão? (só vale depois de salvar)"
      : "Voltar o Ponto de Equilíbrio deste cliente pro modelo padrão? (só vale depois de salvar)")) return;
    if (aba === "forecast") setFc(forecastPadrao());
    else setPe(PE_PADRAO);
    setAlterado(true);
  }

  const cliente = clientes.find((c) => c.id === clienteId);
  const mrr = Number(cliente?.mrr) || 0;
  const salvo = salvos[clienteId];
  const preenchidos = clientes.filter((c) => salvos[c.id]).length;

  const atualizarPe = (patch: Partial<PontoEquilibrioInput>) => { setPe((p) => ({ ...p, ...patch })); setAlterado(true); };
  const atualizarFc = (patch: Partial<ForecastInput>) => { setFc((f) => ({ ...f, ...patch })); setAlterado(true); };

  if (loadingPerfil || loading) return <p className="text-brand-muted">Carregando...</p>;

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Planejamento do Cliente</h1>
          <p className="text-sm text-brand-muted">
            Ponto de Equilíbrio e Forecasting · {preenchidos} de {clientes.length} clientes preenchidos
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select className="input min-w-[220px]" value={clienteId} onChange={(e) => trocarCliente(e.target.value)}>
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>{salvos[c.id] ? "✓ " : "○ "}{c.nome}</option>
            ))}
          </select>
          {podeEditar && clienteId && (
            <>
              <button className="btn-ghost text-xs" onClick={restaurarPadrao}>Restaurar padrão</button>
              <button className="btn" onClick={salvar} disabled={!alterado || salvando}>
                {salvando ? "Salvando..." : alterado ? "Salvar" : "Salvo"}
              </button>
            </>
          )}
        </div>
      </div>

      {clientes.length === 0 && (
        <div className="card text-center text-brand-muted">Nenhum cliente ativo na carteira.</div>
      )}

      {cliente && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3 text-xs text-brand-muted">
            <span className="font-semibold text-gray-200">{cliente.nome}</span>
            <span>MRR {formatBRL(mrr)}</span>
            {cliente.account_nome && <span>· GP {cliente.account_nome}</span>}
            {salvo
              ? <span className="badge border-emerald-500/30 bg-emerald-500/10 text-emerald-300">Atualizado em {formatDate(salvo.updated_at)}</span>
              : <span className="badge border-white/10 bg-white/5">Modelo padrão — ainda não preenchido</span>}
            {alterado && <span className="badge border-amber-400/40 bg-amber-400/10 text-amber-300">Alterações não salvas</span>}
            <span className="ml-auto flex items-center gap-2">
              <span className={`inline-block h-3 w-3 rounded border ${PREENCHER}`} /> GP preenche
              <span className="ml-2 inline-block h-3 w-3 rounded border border-white/10 bg-black/30" /> calculado automático
            </span>
          </div>

          <SubAbas<Aba>
            abas={[
              { v: "ponto_equilibrio", label: "Ponto de Equilíbrio" },
              { v: "forecast", label: "Forecasting" },
            ]}
            ativa={aba}
            onChange={setAba}
          />

          {aba === "ponto_equilibrio" && (
            <AbaPontoEquilibrio pe={pe} mrr={mrr} editavel={podeEditar} onChange={atualizarPe} />
          )}
          {aba === "forecast" && (
            <AbaForecast fc={fc} mrr={mrr} editavel={podeEditar} onChange={atualizarFc} />
          )}
        </>
      )}
    </div>
  );
}

/* -------- PONTO DE EQUILÍBRIO -------- */

function AbaPontoEquilibrio({ pe, mrr, editavel, onChange }: {
  pe: PontoEquilibrioInput;
  mrr: number;
  editavel: boolean;
  onChange: (p: Partial<PontoEquilibrioInput>) => void;
}) {
  const r = useMemo(() => calcularPontoEquilibrio(pe, mrr), [pe, mrr]);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <div className="space-y-4">
        <div className="card">
          <p className="mb-3 text-sm font-semibold">Vendas no período</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Produto / serviço</label>
              <input className={`input ${PREENCHER}`} disabled={!editavel} value={pe.produto}
                onChange={(e) => onChange({ produto: e.target.value })} />
            </div>
            <div>
              <label className="label">Período analisado</label>
              <input className={`input ${PREENCHER}`} disabled={!editavel} value={pe.periodo}
                placeholder="ex: últimos 3 meses" onChange={(e) => onChange({ periodo: e.target.value })} />
            </div>
            <div>
              <label className="label">Faturamento no período (R$)</label>
              <NumInput value={pe.faturamento} disabled={!editavel} onChange={(v) => onChange({ faturamento: v })} />
            </div>
            <div>
              <label className="label">Quantidade de vendas</label>
              <NumInput value={pe.qtd_vendas} disabled={!editavel} onChange={(v) => onChange({ qtd_vendas: v })} />
            </div>
          </div>
          <Linha label="Ticket médio" valor={formatBRL2(r.ticket)} destaque dica="Faturamento ÷ quantidade de vendas" />
        </div>

        <div className="card">
          <p className="mb-1 text-sm font-semibold">Custos variáveis (por venda)</p>
          <p className="mb-3 text-[11px] text-brand-muted">% sobre o ticket médio — o R$ é calculado.</p>
          <div className="space-y-2">
            {r.variaveis.map((c) => (
              <div key={c.key} className="grid grid-cols-[1fr_110px_110px] items-center gap-3">
                <div>
                  <p className="text-sm">{c.label}</p>
                  <p className="text-[10px] text-brand-muted">{c.dica}</p>
                </div>
                <NumInput value={pe[c.key]} sufixo="%" disabled={!editavel}
                  onChange={(v) => onChange({ [c.key]: v ?? 0 })} />
                <p className="text-right text-sm tabular-nums text-brand-muted">{formatBRL2(c.valor)}</p>
              </div>
            ))}
          </div>
          <Linha label="Total custos variáveis" valor={formatBRL2(r.custoVariavel)} />
          <Linha label="Margem de contribuição" valor={`${formatBRL2(r.margem)} · ${formatPct(r.margemPct)}`} destaque />
        </div>

        <div className="card">
          <p className="mb-3 text-sm font-semibold">Custos fixos do projeto (mês)</p>
          <div className="space-y-2">
            {CUSTOS_FIXOS_PE.map((c) => (
              <div key={c.key} className="grid grid-cols-[1fr_160px] items-center gap-3">
                <div>
                  <p className="text-sm">{c.label}</p>
                  <p className="text-[10px] text-brand-muted">{c.dica}</p>
                </div>
                <NumInput value={pe[c.key]} disabled={!editavel}
                  placeholder={c.key === "fee_v4" ? formatNum(mrr) : "0"}
                  onChange={(v) => onChange({ [c.key]: v })} />
              </div>
            ))}
          </div>
          <Linha label="Total custos fixos" valor={formatBRL2(r.custoFixo)} destaque />
        </div>
      </div>

      <div className="space-y-4">
        <div className="card">
          <p className="mb-3 text-sm font-semibold">Parâmetros de CAC</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="label">CAC alvo (% da margem)</label>
              <NumInput value={pe.pct_cac_alvo} sufixo="%" disabled={!editavel || pe.cac_alvo_valor != null}
                onChange={(v) => onChange({ pct_cac_alvo: v ?? 0 })} />
            </div>
            <div>
              <label className="label">ou CAC já mapeado (R$)</label>
              <NumInput value={pe.cac_alvo_valor} disabled={!editavel} placeholder="opcional"
                onChange={(v) => onChange({ cac_alvo_valor: v })} />
            </div>
            <div>
              <label className="label">CAC aceitável (% da margem)</label>
              <NumInput value={pe.pct_cac_aceitavel} sufixo="%" disabled={!editavel}
                onChange={(v) => onChange({ pct_cac_aceitavel: v ?? 0 })} />
            </div>
          </div>
        </div>

        <Cenario titulo="Cenário 1 · CAC alvo" c={r.alvo} ticket={r.ticket} />
        <Cenario titulo="Cenário 2 · CAC aceitável" c={r.aceitavel} ticket={r.ticket} />

        <div className="card border border-amber-500/40 bg-amber-500/5">
          <p className="text-[10px] uppercase tracking-wide text-amber-300">Stop loss · CAC máximo</p>
          <p className="mt-1 text-2xl font-bold text-amber-300">{formatBRL2(r.stopLoss)}</p>
          <p className="mt-1 text-[11px] text-brand-muted">
            Acima desse CAC a empresa paga pra vender — pare as campanhas e reavalie.
          </p>
        </div>
      </div>
    </div>
  );
}

function Cenario({ titulo, c, ticket }: { titulo: string; c: CenarioPe; ticket: number }) {
  return (
    <div className="card">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold">{titulo}</p>
        <span className="text-sm font-bold text-brand">CAC {formatBRL2(c.cac)}</span>
      </div>
      {c.vendas == null ? (
        <p className="text-xs text-brand-muted">
          {ticket ? "A margem de contribuição não cobre esse CAC — não existe ponto de equilíbrio." : "Preencha faturamento e quantidade de vendas."}
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-x-6 sm:grid-cols-3">
          <Kpi label="Breakeven nº de vendas" valor={formatNum(c.vendas, 1)} />
          <Kpi label="Faturamento previsto" valor={formatBRL(c.faturamento)} />
          <Kpi label="Custos variáveis" valor={formatBRL(c.custosVariaveis)} />
          <Kpi label="Mídia necessária" valor={formatBRL(c.midia)} />
          <Kpi label="ROAS" valor={formatNum(c.roas, 2)} />
          <Kpi label="ROI" valor={formatNum(c.roi, 2)} />
        </div>
      )}
    </div>
  );
}

/* -------- FORECASTING -------- */

function AbaForecast({ fc, mrr, editavel, onChange }: {
  fc: ForecastInput;
  mrr: number;
  editavel: boolean;
  onChange: (p: Partial<ForecastInput>) => void;
}) {
  const cols = useMemo(() => calcularForecast(fc, mrr), [fc, mrr]);
  const meses = cols.slice(1);

  function ajustar(campo: "ajuste_cresc_invest" | "ajuste_perda_roas", mes: number, v: number | null) {
    const novo = { ...fc[campo] };
    if (v == null) delete novo[mes]; else novo[mes] = v;
    onChange({ [campo]: novo });
  }

  function ajustarFixo(key: CustoFixoFcKey, mes: number, v: number | null) {
    const doItem = { ...(fc.ajuste_fixos[key] ?? {}) };
    if (v == null) delete doItem[mes]; else doItem[mes] = v;
    onChange({ ajuste_fixos: { ...fc.ajuste_fixos, [key]: doItem } });
  }

  const base = (campo: keyof ForecastInput, placeholder?: string) => (
    <NumInput compacto value={fc[campo] as number | null} disabled={!editavel} placeholder={placeholder}
      onChange={(v) => onChange({ [campo]: v })} />
  );

  return (
    <div className="space-y-4">
      <div className="card">
        <p className="mb-3 text-sm font-semibold">Premissas</p>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <div>
            <label className="label">1º mês projetado</label>
            <input type="month" className={`input ${PREENCHER}`} disabled={!editavel} value={fc.mes_inicio}
              onChange={(e) => e.target.value && onChange({ mes_inicio: e.target.value })} />
          </div>
          <div>
            <label className="label">Horizonte</label>
            <select className={`input ${PREENCHER}`} disabled={!editavel} value={fc.meses}
              onChange={(e) => onChange({ meses: Number(e.target.value) })}>
              <option value={12}>12 meses</option>
              <option value={24}>24 meses</option>
            </select>
          </div>
          <div>
            <label className="label">Ajuste a cada (meses)</label>
            <NumInput value={fc.intervalo_meses} disabled={!editavel} onChange={(v) => onChange({ intervalo_meses: v ?? 3 })} />
          </div>
          <div>
            <label className="label">Crescimento invest. ads</label>
            <NumInput value={fc.cresc_invest_pct} sufixo="%" disabled={!editavel} onChange={(v) => onChange({ cresc_invest_pct: v ?? 0 })} />
          </div>
          <div>
            <label className="label">Perda ROAS 1º mês</label>
            <NumInput value={fc.perda_roas_inicial_pct} sufixo="%" disabled={!editavel} onChange={(v) => onChange({ perda_roas_inicial_pct: v ?? 0 })} />
          </div>
          <div>
            <label className="label">Perda ROAS periódica</label>
            <NumInput value={fc.perda_roas_pct} sufixo="%" disabled={!editavel} onChange={(v) => onChange({ perda_roas_pct: v ?? 0 })} />
          </div>
          <div>
            <label className="label">Taxa de retorno (recompra)</label>
            <NumInput value={fc.taxa_retorno_pct} sufixo="%" disabled={!editavel} onChange={(v) => onChange({ taxa_retorno_pct: v ?? 0 })} />
          </div>
          {CUSTOS_VAR_FC.map((c) => (
            <div key={c.key}>
              <label className="label">{c.label}</label>
              <NumInput value={fc[c.key]} sufixo="%" disabled={!editavel} onChange={(v) => onChange({ [c.key]: v ?? 0 })} />
            </div>
          ))}
          <div>
            <label className="label">Gateway por item (R$)</label>
            <NumInput value={fc.gateway_por_item} disabled={!editavel} onChange={(v) => onChange({ gateway_por_item: v ?? 0 })} />
          </div>
        </div>
        <p className="mt-3 text-[11px] text-brand-muted">
          A cada {fc.intervalo_meses || 3} meses o investimento sobe {formatNum(fc.cresc_invest_pct, 1)}% e o ROAS cai {formatNum(fc.perda_roas_pct, 1)}%.
          Pra mudar um mês específico, preencha a célula dele na tabela (vazio = regra padrão).
          Hospedagem é % da receita de novos clientes; os demais custos variáveis, % da receita total.
        </p>
      </div>

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-white/5 text-brand-muted">
              <th className="sticky left-0 z-10 min-w-[230px] bg-brand-panel px-3 py-2 text-left uppercase tracking-wide">Forecasting</th>
              <th className="min-w-[110px] px-2 py-2 text-right">
                <p className="text-amber-300">Mês base</p>
                <p className="font-normal">{nomeMes(cols[0])}</p>
              </th>
              {meses.map((c) => (
                <th key={c.mes} className="min-w-[100px] px-2 py-2 text-right">
                  <p className="text-gray-200">{nomeMes(c)}</p>
                  <p className="font-normal">mês {c.mes}</p>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <Secao titulo="Investimento e performance" n={meses.length} />
            <Row label="Investimento (R$)" baseCel={base("investimento")} cols={meses} fmt={(c) => formatBRL(c.investimento)} />
            <RowEditavel label="Crescimento investimento (%)" cols={meses} editavel={editavel}
              valor={(c) => fc.ajuste_cresc_invest[c.mes] ?? null}
              padrao={(c) => c.crescInvestPct}
              onChange={(m, v) => ajustar("ajuste_cresc_invest", m, v)} />
            <Row label="ROAS" baseCel={base("roas")} cols={meses} fmt={(c) => formatNum(c.roas, 2)} />
            <RowEditavel label="Perda de performance ROAS (%)" cols={meses} editavel={editavel}
              valor={(c) => fc.ajuste_perda_roas[c.mes] ?? null}
              padrao={(c) => c.perdaRoasPct}
              onChange={(m, v) => ajustar("ajuste_perda_roas", m, v)} />

            <Secao titulo="Vendas" n={meses.length} />
            <Row label="Pedidos finalizados (nº)" baseCel={base("pedidos")} cols={meses} fmt={(c) => formatNum(c.pedidos, 1)} />
            <Row label="Produtos/serviços vendidos (nº)" baseCel={base("produtos")} cols={meses} fmt={(c) => formatNum(c.produtos, 1)} />
            <Row label="Receita novos clientes (R$)" baseCel={base("receita")} cols={meses} fmt={(c) => formatBRL(c.receitaNovos)} />
            <Row label="Receita total c/ recompra (R$)" base={formatBRL(cols[0].receitaTotal)} cols={meses} fmt={(c) => formatBRL(c.receitaTotal)} forte />
            <Row label="Ticket médio (R$)" base={formatBRL2(cols[0].ticket)} cols={meses} fmt={(c) => formatBRL2(c.ticket)} />

            <Secao titulo="Custos variáveis (R$)" n={meses.length} />
            {CUSTOS_VAR_FC.map((v) => (
              <Row key={v.key} label={v.label} base={formatBRL(cols[0].variaveis[v.key])} cols={meses} fmt={(c) => formatBRL(c.variaveis[v.key])} />
            ))}
            <Row label="Total custos variáveis" base={formatBRL(cols[0].custoVariavel)} cols={meses} fmt={(c) => formatBRL(c.custoVariavel)} forte />
            <Row label="Margem de contribuição (R$)" base={formatBRL(cols[0].margem)} cols={meses} fmt={(c) => formatBRL(c.margem)} forte />
            <Row label="Margem de contribuição (%)" base={formatPct(cols[0].margemPct)} cols={meses} fmt={(c) => formatPct(c.margemPct)} />

            <Secao titulo="Custos fixos (R$)" n={meses.length} />
            {CUSTOS_FIXOS_FC.map((f) => (
              <RowEditavel key={f.key} label={f.label} cols={meses} editavel={editavel}
                baseCel={
                  <NumInput compacto value={fc.fixos[f.key]} disabled={!editavel}
                    placeholder={f.key === "v4" ? formatNum(mrr) : "0"}
                    onChange={(v) => onChange({ fixos: { ...fc.fixos, [f.key]: v } })} />
                }
                valor={(c) => fc.ajuste_fixos[f.key]?.[c.mes] ?? null}
                padrao={(c) => c.fixos[f.key]}
                onChange={(m, v) => ajustarFixo(f.key, m, v)} />
            ))}
            <Row label="Total custos fixos" base={formatBRL(cols[0].custoFixo)} cols={meses} fmt={(c) => formatBRL(c.custoFixo)} forte />

            <Secao titulo="Resultado" n={meses.length} />
            <Row label="EBITDA (R$)" base={formatBRL(cols[0].ebitda)} cols={meses} fmt={(c) => formatBRL(c.ebitda)} forte sinal={(c) => c.ebitda} sinalBase={cols[0].ebitda} />
            <Row label="EBITDA (%)" base={formatPct(cols[0].ebitdaPct)} cols={meses} fmt={(c) => formatPct(c.ebitdaPct)} sinal={(c) => c.ebitda} sinalBase={cols[0].ebitda} />
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Secao({ titulo, n }: { titulo: string; n: number }) {
  return (
    <tr className="border-y border-white/5 bg-white/[0.03]">
      <td className="sticky left-0 z-10 bg-[#1b1b1b] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-brand-muted">{titulo}</td>
      <td colSpan={n + 1} />
    </tr>
  );
}

function Row({ label, base, baseCel, cols, fmt, forte, sinal, sinalBase }: {
  label: string;
  base?: string;
  baseCel?: ReactNode;
  cols: ColunaForecast[];
  fmt: (c: ColunaForecast) => string;
  forte?: boolean;
  sinal?: (c: ColunaForecast) => number;
  sinalBase?: number;
}) {
  const cor = (v?: number) => (v == null ? "" : v < 0 ? "text-red-400" : "text-emerald-400");
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className={`sticky left-0 z-10 bg-brand-panel px-3 py-1.5 ${forte ? "font-semibold" : ""}`}>{label}</td>
      <td className={`px-2 py-1 text-right tabular-nums ${cor(sinalBase)}`}>{baseCel ?? base}</td>
      {cols.map((c) => (
        <td key={c.mes} className={`px-2 py-1.5 text-right tabular-nums ${forte ? "font-semibold" : "text-gray-300"} ${sinal ? cor(sinal(c)) : ""}`}>
          {fmt(c)}
        </td>
      ))}
    </tr>
  );
}

function RowEditavel({ label, baseCel, cols, editavel, valor, padrao, onChange }: {
  label: string;
  baseCel?: ReactNode;
  cols: ColunaForecast[];
  editavel: boolean;
  valor: (c: ColunaForecast) => number | null;
  padrao: (c: ColunaForecast) => number | null;
  onChange: (mes: number, v: number | null) => void;
}) {
  return (
    <tr className="border-b border-white/5 last:border-0">
      <td className="sticky left-0 z-10 bg-brand-panel px-3 py-1.5">{label}</td>
      <td className="px-2 py-1 text-right">{baseCel ?? <span className="text-brand-muted">—</span>}</td>
      {cols.map((c) => (
        <td key={c.mes} className="px-1 py-1">
          <NumInput compacto value={valor(c)} disabled={!editavel} placeholder={formatNum(padrao(c), 2)}
            leve onChange={(v) => onChange(c.mes, v)} />
        </td>
      ))}
    </tr>
  );
}

/* -------- PEÇAS -------- */

// Campo numérico que aceita vírgula (padrão BR). Vazio = null.
function NumInput({ value, onChange, disabled, placeholder, sufixo, compacto, leve }: {
  value: number | null;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  placeholder?: string;
  sufixo?: string;
  compacto?: boolean;
  leve?: boolean;   // célula de ajuste opcional: só fica amarela quando preenchida
}) {
  const [txt, setTxt] = useState(value == null ? "" : String(value).replace(".", ","));
  useEffect(() => {
    if (lerNumero(txt) !== value) setTxt(value == null ? "" : String(value).replace(".", ","));
    // eslint-disable-next-line
  }, [value]);

  function mudar(t: string) {
    setTxt(t);
    const n = lerNumero(t);
    if (n === null || !isNaN(n)) onChange(n);
  }

  const destaque = leve ? (value != null ? PREENCHER : "border-white/5 bg-transparent") : PREENCHER;
  return (
    <div className="relative">
      <input
        className={`input text-right tabular-nums ${destaque} ${compacto ? "px-2 py-1 text-xs" : ""} ${sufixo ? "pr-7" : ""}`}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        value={txt}
        onChange={(e) => mudar(e.target.value)}
      />
      {sufixo && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-brand-muted">{sufixo}</span>}
    </div>
  );
}

// "1.583,50" e "1583,5" (BR) ou "3.99" (ponto decimal) — vazio = null
function lerNumero(t: string): number | null {
  const s = t.trim().replace(/\s|R\$|%/g, "");
  if (s === "") return null;
  if (s.includes(",")) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(\.\d{3})+$/.test(s)) return Number(s.replace(/\./g, ""));
  return Number(s);
}

function Linha({ label, valor, destaque, dica }: { label: string; valor: string; destaque?: boolean; dica?: string }) {
  return (
    <div className="mt-3 flex items-center justify-between border-t border-white/5 pt-3">
      <div>
        <p className={`text-sm ${destaque ? "font-semibold" : ""}`}>{label}</p>
        {dica && <p className="text-[10px] text-brand-muted">{dica}</p>}
      </div>
      <p className={`tabular-nums ${destaque ? "text-lg font-bold text-brand" : "text-sm"}`}>{valor}</p>
    </div>
  );
}

function Kpi({ label, valor }: { label: string; valor: string }) {
  return (
    <div className="py-1.5">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className="text-base font-semibold tabular-nums">{valor}</p>
    </div>
  );
}

function formatBRL2(v: number | null | undefined): string {
  if (v == null || !isFinite(v)) return "—";
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function nomeMes(c: ColunaForecast) {
  return `${MESES_LABEL[c.mesCalendario - 1].slice(0, 3)}/${String(c.ano).slice(2)}`;
}
