"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Pessoa, Squad, HeadcountPlanejado, Cargo, Cliente } from "@/lib/types";
import { CARGO_LABEL, formatBRL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

const CARGOS_OPERACIONAIS: Cargo[] = ["coordenador", "gestor_projetos", "gestor_trafego", "designer"];

// Metas de % de custo (sobre receita)
const META_VERDE = 20;    // ≤20% = verde
const META_AMARELO = 25;  // 20-25% = amarelo. >25% = vermelho

export default function HeadcountPage() {
  const supabase = createClient();
  const router = useRouter();
  const { loading: loadingPerfil, podeVerHeadcount, isCoordenador, squadId } = useUsuarioPerfil();
  useEffect(() => {
    if (!loadingPerfil && !podeVerHeadcount) router.push("/cockpit");
  }, [loadingPerfil, podeVerHeadcount, router]);

  const [squads, setSquads] = useState<Squad[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [planejados, setPlanejados] = useState<HeadcountPlanejado[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [squadExpandido, setSquadExpandido] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    let sqQuery = supabase.from("ruston_squads").select("*").eq("ativo", true)
      .eq("incluir_em_comparativo", true).order("nome");
    if (isCoordenador && squadId) sqQuery = sqQuery.eq("id", squadId);

    const [{ data: sq }, { data: ps }, { data: cl }, { data: hp }] = await Promise.all([
      sqQuery,
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_clientes").select("id,nome,mrr,squad_id,ativo").eq("ativo", true),
      supabase.from("ruston_headcount_planejado").select("*"),
    ]);
    setSquads((sq as Squad[]) ?? []);
    setPessoas((ps as Pessoa[]) ?? []);
    setClientes((cl as Cliente[]) ?? []);
    setPlanejados((hp as HeadcountPlanejado[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (loadingPerfil) return;
    load();
  /* eslint-disable-next-line */
  }, [loadingPerfil, isCoordenador, squadId]);

  const compartilhadas = useMemo(
    () => pessoas.filter((p) => p.compartilhado_entre_squads),
    [pessoas]
  );
  const salarioCompartilhadoTotal = useMemo(
    () => compartilhadas.reduce((s, p) => s + (Number(p.salario) || 0), 0),
    [compartilhadas]
  );
  const salarioCompartilhadoPorSquad = squads.length > 0 ? salarioCompartilhadoTotal / squads.length : 0;

  // Receita MRR por squad
  const receitaPorSquad = useMemo(() => {
    const map = new Map<string, number>();
    clientes.forEach((c) => {
      if (!c.squad_id) return;
      map.set(c.squad_id, (map.get(c.squad_id) ?? 0) + Number(c.mrr || 0));
    });
    return map;
  }, [clientes]);

  // Totais consolidados da unidade
  const consolidado = useMemo(() => {
    const receitaTotal = squads.reduce((s, sq) => s + (receitaPorSquad.get(sq.id) ?? 0), 0);
    const custoOperacional = pessoas
      .filter((p) => !p.compartilhado_entre_squads && p.squad_id && squads.some((s) => s.id === p.squad_id))
      .reduce((s, p) => s + (Number(p.salario) || 0), 0);
    const custoTotal = custoOperacional + salarioCompartilhadoTotal;
    const resultado = receitaTotal - custoTotal;
    const pctCusto = receitaTotal > 0 ? (custoTotal / receitaTotal) * 100 : 0;
    const pessoasAtivas = pessoas.filter((p) => p.squad_id && squads.some((s) => s.id === p.squad_id)).length;
    return { receitaTotal, custoTotal, custoOperacional, resultado, pctCusto, pessoasAtivas };
  }, [pessoas, squads, receitaPorSquad, salarioCompartilhadoTotal]);

  async function atualizarPlanejado(sqId: string, cargo: Cargo, qtd: number) {
    setSaving(`${sqId}-${cargo}`);
    const existente = planejados.find((p) => p.squad_id === sqId && p.cargo === cargo);
    if (existente) {
      await supabase.from("ruston_headcount_planejado")
        .update({ quantidade_planejada: qtd }).eq("id", existente.id);
    } else {
      await supabase.from("ruston_headcount_planejado").insert({ squad_id: sqId, cargo, quantidade_planejada: qtd });
    }
    setSaving(null);
    load();
  }

  function toggleSquad(id: string) {
    const n = new Set(squadExpandido);
    if (n.has(id)) n.delete(id); else n.add(id);
    setSquadExpandido(n);
  }

  function corSemaforo(pct: number): { bg: string; text: string; label: string; emoji: string } {
    if (pct <= META_VERDE) return { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-300", label: "saudável", emoji: "🟢" };
    if (pct <= META_AMARELO) return { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-300", label: "atenção", emoji: "🟠" };
    return { bg: "bg-red-500/10 border-red-500/30", text: "text-red-300", label: "crítico", emoji: "🔴" };
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">💰 Headcount & Rentabilidade</h1>
        <p className="text-sm text-brand-muted">
          Receita × Custo por squad. Meta: custo ≤ 20% da receita.
        </p>
      </div>

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && (
        <>
          {/* CARD CONSOLIDADO DA UNIDADE */}
          {!isCoordenador && (() => {
            const s = corSemaforo(consolidado.pctCusto);
            return (
              <div className={`mb-6 card ${s.bg} border`}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <p className="text-xs uppercase tracking-wide text-brand-muted">Unidade Ruston · Consolidado</p>
                    <p className="mt-1 text-xl font-bold">{s.emoji} {s.label}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-brand-muted">{squads.length} squads · {consolidado.pessoasAtivas} pessoas</p>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <KPI label="💰 Receita MRR" valor={formatBRL(consolidado.receitaTotal)} cor="text-emerald-300" />
                  <KPI
                    label="💸 Custo total"
                    valor={formatBRL(consolidado.custoTotal)}
                    cor="text-red-300"
                    sub={`${consolidado.pctCusto.toFixed(1)}% da receita`}
                  />
                  <KPI label="✅ Resultado" valor={formatBRL(consolidado.resultado)} cor={consolidado.resultado >= 0 ? "text-emerald-300" : "text-red-300"} />
                  <KPI
                    label="📊 Margem"
                    valor={`${consolidado.receitaTotal > 0 ? (100 - consolidado.pctCusto).toFixed(1) : "0.0"}%`}
                    cor={s.text}
                  />
                </div>
                <BarraCusto pct={consolidado.pctCusto} />
              </div>
            );
          })()}

          {/* CARDS POR SQUAD */}
          <div className="space-y-4">
            {squads.map((squad) => {
              const receita = receitaPorSquad.get(squad.id) ?? 0;
              const pessoasDoSquad = pessoas.filter(
                (p) => !p.compartilhado_entre_squads && p.squad_id === squad.id
              );
              const custoOperacional = pessoasDoSquad.reduce((s, p) => s + (Number(p.salario) || 0), 0);
              const custoTotal = custoOperacional + salarioCompartilhadoPorSquad;
              const resultado = receita - custoTotal;
              const pctCusto = receita > 0 ? (custoTotal / receita) * 100 : 0;
              const margem = receita > 0 ? 100 - pctCusto : 0;
              const sem = corSemaforo(pctCusto);
              const expandido = squadExpandido.has(squad.id);
              const totalAtual = pessoasDoSquad.length;

              const linhas = CARGOS_OPERACIONAIS.map((cargo) => {
                const plan = planejados.find((p) => p.squad_id === squad.id && p.cargo === cargo);
                const atuais = pessoasDoSquad.filter((p) => p.cargo === cargo);
                return {
                  cargo,
                  planejado: plan?.quantidade_planejada ?? 0,
                  atual: atuais.length,
                  gap: atuais.length - (plan?.quantidade_planejada ?? 0),
                  atuais,
                  custoLinha: atuais.reduce((s, p) => s + (Number(p.salario) || 0), 0),
                };
              });

              return (
                <div key={squad.id} className={`card border ${sem.bg}`}>
                  {/* Header */}
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-lg font-bold text-white text-lg"
                        style={{ backgroundColor: squad.cor || "#1a1a1a" }}
                      >
                        {squad.nome.charAt(0)}
                      </div>
                      <div>
                        <p className="text-lg font-bold">{sem.emoji} {squad.nome}</p>
                        <p className="text-xs text-brand-muted">
                          {totalAtual} pessoas · {sem.label}
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleSquad(squad.id)}
                      className="text-xs text-brand hover:text-emerald-300"
                    >
                      {expandido ? "− ocultar detalhes" : "+ ver pessoas e planejado"}
                    </button>
                  </div>

                  {/* KPIs */}
                  <div className="grid grid-cols-2 gap-3 md:grid-cols-4 mb-3">
                    <KPI label="💰 Receita MRR" valor={formatBRL(receita)} cor="text-emerald-300" />
                    <KPI
                      label="💸 Custo total"
                      valor={formatBRL(custoTotal)}
                      cor="text-red-300"
                      sub={receita > 0 ? `${pctCusto.toFixed(1)}% da receita` : "sem receita"}
                    />
                    <KPI label="✅ Resultado" valor={formatBRL(resultado)} cor={resultado >= 0 ? "text-emerald-300" : "text-red-300"} />
                    <KPI label="📊 Margem" valor={`${margem.toFixed(1)}%`} cor={sem.text} />
                  </div>

                  {/* Breakdown de custo */}
                  <div className="mb-3 text-xs text-brand-muted space-y-1">
                    <div className="flex justify-between">
                      <span>├─ Operacional ({pessoasDoSquad.length} pessoas)</span>
                      <span>{formatBRL(custoOperacional)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span>└─ Rateio compartilhado ({compartilhadas.length} ÷ {squads.length} squads)</span>
                      <span>{formatBRL(salarioCompartilhadoPorSquad)}</span>
                    </div>
                  </div>

                  <BarraCusto pct={pctCusto} />

                  {/* Expandido: planejado × atual + pessoas */}
                  {expandido && (
                    <div className="mt-4 pt-4 border-t border-white/5 overflow-x-auto">
                      <p className="text-xs uppercase tracking-wide text-brand-muted mb-2">Planejado × Atual por cargo</p>
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                            <th className="py-2">Cargo</th>
                            <th className="py-2 w-24 text-center">Planejado</th>
                            <th className="py-2 w-24 text-center">Atual</th>
                            <th className="py-2 w-24 text-center">Gap</th>
                            <th className="py-2 w-40 text-right">Custo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {linhas.map((l) => {
                            const gapColor = l.gap === 0 ? "text-emerald-300"
                              : l.gap > 0 ? "text-amber-300" : "text-red-300";
                            return (
                              <React.Fragment key={l.cargo}>
                                <tr className="border-b border-white/5 last:border-0">
                                  <td className="py-2 font-medium">{CARGO_LABEL[l.cargo]}</td>
                                  <td className="py-2 text-center">
                                    <input
                                      type="number" min="0"
                                      className="input py-1 text-center text-sm w-16 mx-auto"
                                      defaultValue={l.planejado}
                                      onBlur={(e) => {
                                        const v = Number(e.target.value) || 0;
                                        if (v !== l.planejado) atualizarPlanejado(squad.id, l.cargo, v);
                                      }}
                                    />
                                  </td>
                                  <td className="py-2 text-center">
                                    <span className={l.atual === l.planejado ? "text-emerald-300 font-semibold" : "text-white"}>{l.atual}</span>
                                  </td>
                                  <td className={`py-2 text-center font-semibold ${gapColor}`}>
                                    {l.gap === 0 ? "✓" : l.gap > 0 ? `+${l.gap}` : l.gap}
                                  </td>
                                  <td className="py-2 text-right">{formatBRL(l.custoLinha)}</td>
                                </tr>
                                {l.atuais.length > 0 && (
                                  <tr>
                                    <td colSpan={5} className="pb-2 pl-4">
                                      <div className="space-y-1 pl-2 border-l-2 border-white/5">
                                        {l.atuais.map((p) => (
                                          <div key={p.id} className="flex items-center justify-between text-xs">
                                            <span className="text-brand-muted">↳ {p.nome}</span>
                                            <span className="text-brand">{p.salario ? formatBRL(p.salario) : "salário —"}</span>
                                          </div>
                                        ))}
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* COMPARTILHADOS */}
          {compartilhadas.length > 0 && (
            <div className="mt-6 card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold">👥 Compartilhados entre squads</p>
                  <p className="text-[10px] text-brand-muted">
                    Rateio igualitário: cada squad carrega {formatBRL(salarioCompartilhadoPorSquad)}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold">{formatBRL(salarioCompartilhadoTotal)}</p>
                  <p className="text-[10px] text-brand-muted">custo total mensal</p>
                </div>
              </div>
              <div className="space-y-2">
                {compartilhadas.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-sm">
                    <div>
                      <p className="font-medium">{p.nome}</p>
                      <p className="text-[10px] text-brand-muted">{CARGO_LABEL[p.cargo]}</p>
                    </div>
                    <span className="text-brand font-medium">{p.salario ? formatBRL(p.salario) : "salário —"}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function KPI({ label, valor, cor, sub }: { label: string; valor: string; cor?: string; sub?: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-lg font-bold ${cor ?? "text-white"}`}>{valor}</p>
      {sub && <p className="text-[10px] text-brand-muted">{sub}</p>}
    </div>
  );
}

function BarraCusto({ pct }: { pct: number }) {
  const clamped = Math.min(100, Math.max(0, pct));
  const cor = pct <= 20 ? "bg-emerald-500" : pct <= 25 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="mt-2">
      <div className="h-2 w-full rounded-full bg-white/5 overflow-hidden">
        <div className={`h-full ${cor} transition-all`} style={{ width: `${clamped}%` }} />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-brand-muted">
        <span>0%</span>
        <span className="font-medium">{pct.toFixed(1)}% custo</span>
        <span>meta ≤ 20%</span>
      </div>
    </div>
  );
}
