====================================================================
COCKPIT — SÓ AS 2 MUDANÇAS (caso o arquivo cheio não abra)
====================================================================
Se preferir editar direto o arquivo que já tá no GitHub em vez de
substituir tudo, é só trocar esses 2 pedaços dentro dele.

Arquivo: app/(app)/cockpit/page.tsx
====================================================================


────────────────────────────────────────────────────────────────────
MUDANÇA 1 — Cálculo do top3PorCargo (perto da linha 203)
────────────────────────────────────────────────────────────────────

PROCURA por esse bloco no arquivo:

  const top3PorCargo = useMemo(() => {
    const cargosComMetricas = Array.from(new Set(okrMetricas.map((m) => m.cargo)));
    return cargosComMetricas.map((cargo) => {
      const metricasCargo = okrMetricas.filter((m) => m.cargo === cargo);
      const pessoasCargo = pessoas.filter(
        (p) => p.cargo === cargo && p.nivel_senioridade && p.nivel_v && p.ativo
      );
      const rank = pessoasCargo.map((p) => {
        let batidas = 0;
        metricasCargo.forEach((m) => {
          const meta = okrMetasRegua.find(
            (r) => r.metrica_id === m.id && r.nivel === p.nivel_senioridade && r.versao_v === p.nivel_v
          );
          const real = okrRealizados.find((r) => r.metrica_id === m.id && r.pessoa_id === p.id);
          if (!meta?.valor_meta || real?.valor_realizado == null) return;
          const menor = m.nome.toLowerCase().includes("churn") || m.nome.toLowerCase().includes("refação");
          if (menor ? real.valor_realizado <= meta.valor_meta : real.valor_realizado >= meta.valor_meta) {
            batidas++;
          }
        });
        const total = metricasCargo.length;
        const pct = total > 0 ? Math.round((batidas / total) * 100) : 0;
        return { pessoa: p, batidas, total, pct };
      }).sort((a, b) => b.pct - a.pct).slice(0, 3);
      return { cargo, top: rank };
    }).filter((c) => c.top.length > 0);
  }, [okrMetricas, okrMetasRegua, okrRealizados, pessoas]);


SUBSTITUI pelo bloco novo:

  const top3PorCargo = useMemo(() => {
    const cargosComMetricas = Array.from(new Set(okrMetricas.map((m) => m.cargo)));
    return cargosComMetricas.map((cargo) => {
      const metricasCargo = okrMetricas.filter((m) => m.cargo === cargo);
      const pessoasCargo = pessoas.filter(
        (p) => p.cargo === cargo && p.nivel_senioridade && p.nivel_v && p.ativo
      );
      const rank = pessoasCargo.map((p) => {
        let batidas = 0;
        let preenchidas = 0;
        metricasCargo.forEach((m) => {
          const meta = okrMetasRegua.find(
            (r) => r.metrica_id === m.id && r.nivel === p.nivel_senioridade && r.versao_v === p.nivel_v
          );
          const real = okrRealizados.find((r) => r.metrica_id === m.id && r.pessoa_id === p.id);
          // Só conta como "avaliada" se tem régua E realizado preenchidos
          if (!meta?.valor_meta || real?.valor_realizado == null) return;
          preenchidas++;
          const menor = m.nome.toLowerCase().includes("churn") || m.nome.toLowerCase().includes("refação");
          if (menor ? real.valor_realizado <= meta.valor_meta : real.valor_realizado >= meta.valor_meta) {
            batidas++;
          }
        });
        const total = metricasCargo.length;
        // Percentual sobre AVALIADAS (opção 3 - performance real de quem foi medido)
        const pct = preenchidas > 0 ? Math.round((batidas / preenchidas) * 100) : 0;
        return { pessoa: p, batidas, preenchidas, total, pct };
      })
      // Ordena: mais batidas absolutas primeiro; empate → maior %; empate → mais avaliadas
      .sort((a, b) => (b.batidas - a.batidas) || (b.pct - a.pct) || (b.preenchidas - a.preenchidas))
      .slice(0, 3);
      return { cargo, top: rank };
    }).filter((c) => c.top.length > 0);
  }, [okrMetricas, okrMetasRegua, okrRealizados, pessoas]);


────────────────────────────────────────────────────────────────────
MUDANÇA 2 — Rendering do card do investidor (perto da linha 417)
────────────────────────────────────────────────────────────────────

PROCURA por esse bloco no arquivo:

                          <div className="text-right">
                            <p className={`text-lg font-bold ${
                              r.pct >= 80 ? "text-emerald-300" :
                              r.pct >= 50 ? "text-amber-300" :
                              "text-red-300"
                            }`}>{r.pct}%</p>
                            <p className="text-[9px] text-brand-muted">{r.batidas}/{r.total}</p>
                          </div>


SUBSTITUI pelo bloco novo:

                          <div className="text-right">
                            <p className={`text-lg font-bold ${
                              r.preenchidas === 0 ? "text-brand-muted" :
                              r.pct >= 80 ? "text-emerald-300" :
                              r.pct >= 50 ? "text-amber-300" :
                              "text-red-300"
                            }`}>{r.preenchidas === 0 ? "—" : `${r.pct}%`}</p>
                            <p className="text-[9px] text-brand-muted leading-tight">
                              {r.batidas} batida{r.batidas !== 1 ? "s" : ""} · {r.preenchidas} avaliada{r.preenchidas !== 1 ? "s" : ""}
                            </p>
                            <p className="text-[9px] text-brand-muted leading-tight">
                              {r.total} no cargo
                            </p>
                          </div>


====================================================================
Pronto — commit as duas mudanças e aguarda o Vercel deployar.
====================================================================
