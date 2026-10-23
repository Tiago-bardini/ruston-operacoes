"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { formatBRL } from "@/lib/types";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { CRITERIOS, calcularPlacar, inicioDaSemana, semanaFechada, type PlacarSquad } from "@/lib/placarSquad";

type Historico = { squad_id: string; semana: string; nota: number | null };

const corNota = (n: number | null) =>
  n == null ? "text-zinc-500" : n >= 80 ? "text-emerald-300" : n >= 60 ? "text-amber-300" : "text-red-300";
const barraNota = (p: number | null) =>
  p == null ? "bg-zinc-700" : p >= 0.8 ? "bg-emerald-500" : p >= 0.6 ? "bg-amber-500" : "bg-red-500";

function dataBR(iso: string) {
  const [, m, d] = iso.split("-");
  return `${d}/${m}`;
}

function ultimasSemanas(n: number): string[] {
  const out: string[] = [];
  const d = new Date(semanaFechada() + "T12:00:00");
  for (let i = 0; i < n; i++) {
    out.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`);
    d.setDate(d.getDate() - 7);
  }
  return out;
}

export default function PlacarPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, isGerente, squadId } = useUsuarioPerfil();
  const semanas = useMemo(() => ultimasSemanas(8), []);
  const [semana, setSemana] = useState(semanas[0]);
  const [placar, setPlacar] = useState<PlacarSquad[]>([]);
  const [historico, setHistorico] = useState<Historico[]>([]);
  const [aberto, setAberto] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (loadingPerfil) return;
    (async () => {
      setLoading(true);
      const [p, { data: h }] = await Promise.all([
        calcularPlacar(supabase, semana),
        supabase.from("ruston_placar_squad").select("squad_id, semana, nota").gte("semana", semanas[semanas.length - 1]),
      ]);
      // Coordenador vê só o próprio squad
      setPlacar(p.filter((s) => s.clientes > 0 && (isGerente || !squadId || s.squad_id === squadId))
        .sort((a, b) => (b.nota ?? -1) - (a.nota ?? -1)));
      setHistorico((h as Historico[]) ?? []);
      setLoading(false);
    })();
    // eslint-disable-next-line
  }, [semana, loadingPerfil]);

  const notaHist = (sq: string, sem: string) => historico.find((h) => h.squad_id === sq && h.semana === sem)?.nota ?? null;

  return (
    <div className="max-w-[1400px] space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Placar dos Squads</h1>
          <p className="text-sm text-brand-muted">Disciplina da operação + churn, de 0 a 100, semana a semana</p>
        </div>
        <div>
          <label className="label">Semana</label>
          <select className="input" value={semana} onChange={(e) => setSemana(e.target.value)}>
            {semanas.map((s, i) => (
              <option key={s} value={s}>{dataBR(inicioDaSemana(s))} a {dataBR(s)}{i === 0 ? " (última fechada)" : ""}</option>
            ))}
          </select>
        </div>
      </div>

      {loading && <p className="text-brand-muted">Calculando placar...</p>}

      {!loading && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            {placar.map((s, i) => (
              <button key={s.squad_id} onClick={() => setAberto(aberto === s.squad_id ? null : s.squad_id)}
                className={`card p-4 text-left transition hover:bg-white/[0.03] ${aberto === s.squad_id ? "border-brand/50" : ""}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-8 w-8 items-center justify-center rounded-lg text-sm font-bold text-white"
                      style={{ backgroundColor: s.cor || "#1a1a1a" }}>{s.squad_nome.charAt(0)}</div>
                    <div>
                      <p className="text-sm font-semibold tracking-wider">{s.squad_nome}</p>
                      <p className="text-[10px] text-brand-muted">{s.clientes} clientes · {formatBRL(s.mrr)}</p>
                    </div>
                  </div>
                  {isGerente && placar.length > 1 && <span className="text-xs text-brand-muted">{i + 1}º</span>}
                </div>
                <p className={`mt-3 text-4xl font-bold tabular-nums ${corNota(s.nota)}`}>{s.nota ?? "—"}</p>
                <div className="mt-3 space-y-1.5">
                  {CRITERIOS.map((c) => {
                    const v = s.criterios[c.key];
                    return (
                      <div key={c.key} className="flex items-center gap-2 text-[11px]">
                        <span className="w-32 shrink-0 text-brand-muted">{c.label}</span>
                        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/5">
                          <div className={`h-full rounded-full ${barraNota(v.pct)}`} style={{ width: `${(v.pct ?? 0) * 100}%` }} />
                        </div>
                        <span className="w-9 shrink-0 text-right tabular-nums">{v.pct == null ? "—" : `${Math.round(v.pct * 100)}%`}</span>
                      </div>
                    );
                  })}
                </div>
                <p className="mt-3 text-[10px] text-brand-muted">
                  {s.pendencias.length} pendência{s.pendencias.length === 1 ? "" : "s"} · clique pra ver
                </p>
              </button>
            ))}
          </div>

          {aberto && (() => {
            const s = placar.find((x) => x.squad_id === aberto);
            if (!s) return null;
            const porCliente: Record<string, string[]> = {};
            s.pendencias.forEach((p) => (porCliente[p.cliente] ??= []).push(p.motivo));
            const clientes = Object.entries(porCliente).sort((a, b) => b[1].length - a[1].length);
            return (
              <div className="card">
                <p className="mb-3 text-sm font-semibold">{s.squad_nome} · detalhe da semana</p>
                <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
                  {CRITERIOS.map((c) => {
                    const v = s.criterios[c.key];
                    return (
                      <div key={c.key} className="rounded-lg border border-white/5 bg-black/20 p-3">
                        <p className="text-[10px] uppercase tracking-wide text-brand-muted">{c.label}</p>
                        <p className={`mt-1 text-lg font-bold ${corNota(v.pct == null ? null : v.pct * 100)}`}>
                          {v.pontos == null ? "—" : `${v.pontos}/${c.peso}`}
                        </p>
                        <p className="text-[10px] text-brand-muted">{v.detalhe}</p>
                      </div>
                    );
                  })}
                </div>
                <p className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-brand-muted">
                  Pendências por cliente ({clientes.length})
                </p>
                {clientes.length === 0 && <p className="text-xs text-emerald-300">Nenhuma pendência 🎉</p>}
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {clientes.map(([cliente, motivos]) => (
                    <div key={cliente} className="rounded-lg border border-white/5 bg-black/20 p-2.5 text-xs">
                      <p className="font-medium">{cliente}</p>
                      <ul className="mt-1 space-y-0.5 text-[11px] text-brand-muted">
                        {motivos.map((m, i) => <li key={i}>• {m}</li>)}
                      </ul>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}

          <div className="card overflow-x-auto p-0">
            <p className="px-4 pt-4 text-sm font-semibold">Evolução</p>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="border-b border-white/5 text-brand-muted">
                  <th className="px-4 py-2 text-left">Squad</th>
                  {[...semanas].reverse().map((s) => <th key={s} className="px-3 py-2 text-right">{dataBR(s)}</th>)}
                </tr>
              </thead>
              <tbody>
                {placar.map((s) => (
                  <tr key={s.squad_id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-2 font-medium">{s.squad_nome}</td>
                    {[...semanas].reverse().map((sem) => {
                      const n = sem === semana ? s.nota : notaHist(s.squad_id, sem);
                      return <td key={sem} className={`px-3 py-2 text-right font-semibold tabular-nums ${corNota(n)}`}>{n ?? "·"}</td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="border-t border-white/5 px-4 py-2 text-[11px] text-brand-muted">
              O histórico é gravado todo sábado de manhã; semanas antes disso aparecem como &quot;·&quot;.
            </p>
          </div>

          <div className="card">
            <p className="mb-2 text-sm font-semibold">Como a nota é calculada</p>
            <ul className="grid grid-cols-1 gap-1 text-xs text-brand-muted md:grid-cols-2">
              {CRITERIOS.map((c) => <li key={c.key}><span className="text-gray-200">{c.label} ({c.peso} pts):</span> {c.regra}</li>)}
            </ul>
            <p className="mt-2 text-[11px] text-brand-muted">
              Critério sem dado na semana (ex.: nenhuma tarefa com prazo) não pune: o peso dele vai pros outros. Verde 80+, amarelo 60+, vermelho abaixo de 60.
            </p>
          </div>
        </>
      )}
    </div>
  );
}
