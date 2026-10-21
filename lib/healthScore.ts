// Health Score 0-10 — fórmula única usada pela aba Health Score, Painel Gerente
// e resumo diário do WhatsApp.
// Base = nota do FCA (já ponderada: resultado x7, roi x8, trafego x5, prazo x5,
// qualidade x4, relacionamento x4). Sem FCA, usa 5 (neutro).
// Ajustes: WhatsApp (máx +/- 1.5) e Tarefas (máx +/- 0.5).

export type HealthScoreInput = {
  fca_nota: number | null;
  wa_sentimento: string | null;
  wa_risco_churn: string | null;
  wa_dias_sem_contato: number | null;
  tarefas_taxa: number | null; // % de tarefas concluídas no prazo (0-100)
};

export function calcHealthScore(d: HealthScoreInput): number {
  const base = d.fca_nota ?? 5;

  let ajusteWa = 0;
  if (d.wa_sentimento === "positivo") ajusteWa += 0.5;
  else if (d.wa_sentimento === "negativo") ajusteWa -= 0.5;

  if (d.wa_risco_churn === "baixo") ajusteWa += 0.5;
  else if (d.wa_risco_churn === "alto") ajusteWa -= 1.0;
  else if (d.wa_risco_churn === "medio") ajusteWa -= 0.3;

  if (d.wa_dias_sem_contato != null) {
    if (d.wa_dias_sem_contato > 14) ajusteWa -= 0.5;
    else if (d.wa_dias_sem_contato > 7) ajusteWa -= 0.2;
    else if (d.wa_dias_sem_contato <= 2) ajusteWa += 0.3;
  }

  let ajusteTarefas = 0;
  if (d.tarefas_taxa != null) {
    if (d.tarefas_taxa >= 90) ajusteTarefas = 0.5;
    else if (d.tarefas_taxa >= 70) ajusteTarefas = 0.2;
    else if (d.tarefas_taxa < 50) ajusteTarefas = -0.5;
  }

  const score = base + ajusteWa + ajusteTarefas;
  return Math.max(0, Math.min(10, Math.round(score * 10) / 10));
}

/** % de tarefas concluídas por cliente, a partir de ruston_ekyte_tasks_view
 *  (select "cliente_id, situation, esta_atrasada"). situation 30 = concluída. */
export function taxaTarefasPorCliente(
  tasks: { cliente_id: string | null; situation: number | null; esta_atrasada: boolean | null }[],
): Record<string, { total: number; concluidas: number; atrasadas: number; taxa: number | null }> {
  const map: Record<string, { total: number; concluidas: number; atrasadas: number; taxa: number | null }> = {};
  for (const t of tasks) {
    if (!t.cliente_id) continue;
    const m = (map[t.cliente_id] ??= { total: 0, concluidas: 0, atrasadas: 0, taxa: null });
    m.total++;
    if (t.situation === 30) m.concluidas++;
    if (t.esta_atrasada) m.atrasadas++;
  }
  for (const m of Object.values(map)) {
    m.taxa = m.concluidas + m.atrasadas > 0 ? Math.round((m.concluidas / (m.concluidas + m.atrasadas)) * 100) : null;
  }
  return map;
}

/** Bandeira igual ao FCA: verde (>=8), amarelo (>=6), vermelho (<6) */
export function healthScoreNivel(s: number): "verde" | "amarelo" | "vermelho" {
  if (s >= 8) return "verde";
  if (s >= 6) return "amarelo";
  return "vermelho";
}
