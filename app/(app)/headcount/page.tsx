"use client";

import React, { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { Pessoa, Squad, HeadcountPlanejado, Cargo } from "@/lib/types";
import { CARGO_LABEL, formatBRL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";

// Cargos operacionais que entram no planejamento por squad
const CARGOS_OPERACIONAIS: Cargo[] = ["coordenador", "gestor_projetos", "gestor_trafego", "designer"];

// Cargos compartilhados (aparecem em todos os squads, custo dividido)
const CARGOS_COMPARTILHADOS: Cargo[] = ["gerente", "tech", "coo"];

export default function HeadcountPage() {
  const supabase = createClient();
  const router = useRouter();
  const { loading: loadingPerfil, podeVerHeadcount, isCoordenador, squadId } = useUsuarioPerfil();
  useEffect(() => {
    if (!loadingPerfil && !podeVerHeadcount) router.push("/cockpit");
  }, [loadingPerfil, podeVerHeadcount, router]);

  const [squads, setSquads] = useState<Squad[]>([]);
  const [pessoas, setPessoas] = useState<Pessoa[]>([]);
  const [planejados, setPlanejados] = useState<HeadcountPlanejado[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [squadExpandido, setSquadExpandido] = useState<Set<string>>(new Set());

  async function load() {
    setLoading(true);
    let sqQuery = supabase.from("ruston_squads").select("*").eq("ativo", true)
      .eq("incluir_em_comparativo", true).order("nome");
    // Coordenador só vê o próprio squad
    if (isCoordenador && squadId) {
      sqQuery = sqQuery.eq("id", squadId);
    }
    const [{ data: sq }, { data: ps }, { data: hp }] = await Promise.all([
      sqQuery,
      supabase.from("ruston_pessoas").select("*").eq("ativo", true).order("nome"),
      supabase.from("ruston_headcount_planejado").select("*"),
    ]);
    setSquads((sq as Squad[]) ?? []);
    setPessoas((ps as Pessoa[]) ?? []);
    setPlanejados((hp as HeadcountPlanejado[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (loadingPerfil) return;
    load();
  /* eslint-disable-next-line */
  }, [loadingPerfil, isCoordenador, squadId]);

  // Pessoas compartilhadas (Gerente/Tech/COO) — custo dividido entre squads operacionais
  const compartilhadas = useMemo(
    () => pessoas.filter((p) => p.compartilhado_entre_squads),
    [pessoas]
  );

  const salarioCompartilhadoTotal = useMemo(
    () => compartilhadas.reduce((s, p) => s + (Number(p.salario) || 0), 0),
    [compartilhadas]
  );

  const salarioCompartilhadoPorSquad = squads.length > 0
    ? salarioCompartilhadoTotal / squads.length
    : 0;

  async function atualizarPlanejado(squadId: string, cargo: Cargo, qtd: number) {
    setSaving(`${squadId}-${cargo}`);
    const existente = planejados.find((p) => p.squad_id === squadId && p.cargo === cargo);
    if (existente) {
      await supabase.from("ruston_headcount_planejado")
        .update({ quantidade_planejada: qtd })
        .eq("id", existente.id);
    } else {
      await supabase.from("ruston_headcount_planejado").insert({
        squad_id: squadId, cargo, quantidade_planejada: qtd,
      });
    }
    setSaving(null);
    load();
  }

  function toggleSquad(id: string) {
    const novo = new Set(squadExpandido);
    if (novo.has(id)) novo.delete(id); else novo.add(id);
    setSquadExpandido(novo);
  }

  // Stats globais
  const totalPlanejado = planejados.reduce((s, p) => s + p.quantidade_planejada, 0);
  const totalAtualOperacional = pessoas.filter(
    (p) => !p.compartilhado_entre_squads && p.squad_id && CARGOS_OPERACIONAIS.includes(p.cargo)
  ).length;
  const totalGeral = totalAtualOperacional + compartilhadas.length;
  const custoOperacional = pessoas
    .filter((p) => !p.compartilhado_entre_squads && p.squad_id)
    .reduce((s, p) => s + (Number(p.salario) || 0), 0);
  const custoTotal = custoOperacional + salarioCompartilhadoTotal;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Headcount por Squad</h1>
        <p className="text-sm text-brand-muted">
          Planejamento vs. atual, custo por squad, alocação de gerência/tech compartilhada
        </p>
      </div>

      {loading && <p className="text-brand-muted">Carregando...</p>}

      {!loading && (
        <>
          {/* Stats globais */}
          <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Time total" valor={String(totalGeral)} />
            <StatCard label="Operacional" valor={`${totalAtualOperacional}/${totalPlanejado}`} sublabel="atual/planejado" />
            <StatCard label="Compartilhados" valor={String(compartilhadas.length)} sublabel="Gerente · Tech · COO" />
            <StatCard label="Custo total" valor={formatBRL(custoTotal)} cor="text-brand" />
          </div>

          {/* Cards por squad */}
          <div className="space-y-4">
            {squads.map((squad) => {
              const pessoasDoSquad = pessoas.filter(
                (p) => !p.compartilhado_entre_squads && p.squad_id === squad.id
              );
              const custoSquad = pessoasDoSquad.reduce((s, p) => s + (Number(p.salario) || 0), 0);
              const custoTotalSquad = custoSquad + salarioCompartilhadoPorSquad;
              const expandido = squadExpandido.has(squad.id);

              // Planejado × Atual por cargo
              const linhas = CARGOS_OPERACIONAIS.map((cargo) => {
                const plan = planejados.find((p) => p.squad_id === squad.id && p.cargo === cargo);
                const atuais = pessoasDoSquad.filter((p) => p.cargo === cargo);
                const custoLinha = atuais.reduce((s, p) => s + (Number(p.salario) || 0), 0);
                const planejado = plan?.quantidade_planejada ?? 0;
                const atual = atuais.length;
                const gap = atual - planejado;
                return { cargo, planejado, atual, gap, atuais, custoLinha };
              });

              const totalPlanejadoSquad = linhas.reduce((s, l) => s + l.planejado, 0);
              const totalAtualSquad = linhas.reduce((s, l) => s + l.atual, 0);

              return (
                <div key={squad.id} className="card">
                  {/* Header do squad */}
                  <div className="mb-3 flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-lg font-bold text-white text-lg"
                        style={{ backgroundColor: squad.cor || "#1a1a1a" }}
                      >
                        {squad.nome.charAt(0)}
                      </div>
                      <div>
                        <p className="text-lg font-bold">{squad.nome}</p>
                        <p className="text-xs text-brand-muted">
                          {totalAtualSquad}/{totalPlanejadoSquad} operacionais · {formatBRL(custoTotalSquad)} custo total
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => toggleSquad(squad.id)}
                      className="text-xs text-brand-muted hover:text-gray-200"
                    >
                      {expandido ? "− ocultar" : "+ ver pessoas"}
                    </button>
                  </div>

                  {/* Tabela de cargos */}
                  <div className="overflow-x-auto">
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
                            : l.gap > 0 ? "text-amber-300"
                            : "text-red-300";
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
                                  <span className={l.atual === l.planejado ? "text-emerald-300 font-semibold" : "text-white"}>
                                    {l.atual}
                                  </span>
                                </td>
                                <td className={`py-2 text-center font-semibold ${gapColor}`}>
                                  {l.gap === 0 ? "✓" : (l.gap > 0 ? `+${l.gap}` : l.gap)}
                                </td>
                                <td className="py-2 text-right font-medium">
                                  {formatBRL(l.custoLinha)}
                                </td>
                              </tr>
                              {expandido && l.atuais.length > 0 && (
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
                        {/* Linha de compartilhados */}
                        <tr className="border-t-2 border-white/10">
                          <td className="pt-3 text-xs italic text-brand-muted">
                            Compartilhados (Gerente · Tech · COO)
                          </td>
                          <td colSpan={2} className="pt-3 text-center text-xs text-brand-muted">
                            {compartilhadas.length} ÷ {squads.length} squads
                          </td>
                          <td className="pt-3 text-center text-xs text-brand-muted">—</td>
                          <td className="pt-3 text-right text-xs italic text-brand-muted">
                            {formatBRL(salarioCompartilhadoPorSquad)}
                          </td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Seção compartilhados */}
          {compartilhadas.length > 0 && (
            <div className="mt-6 card">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="font-semibold">Compartilhados entre squads</p>
                  <p className="text-[10px] text-brand-muted">
                    Cada squad carrega {formatBRL(salarioCompartilhadoPorSquad)} de custo
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
                    <span className="text-brand font-medium">
                      {p.salario ? formatBRL(p.salario) : "salário —"}
                    </span>
                  </div>
                ))}
              </div>
              {compartilhadas.length === 0 && (
                <p className="text-xs text-brand-muted">
                  Nenhuma pessoa marcada como compartilhada. Cadastre Gerente/Tech/COO em /pessoas e marque o checkbox "Compartilhado entre squads".
                </p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function StatCard({ label, valor, sublabel, cor }: {
  label: string; valor: string; sublabel?: string; cor?: string;
}) {
  return (
    <div className="card p-3">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{label}</p>
      <p className={`mt-1 text-xl font-bold ${cor ?? "text-white"}`}>{valor}</p>
      {sublabel && <p className="text-[10px] text-brand-muted">{sublabel}</p>}
    </div>
  );
}
