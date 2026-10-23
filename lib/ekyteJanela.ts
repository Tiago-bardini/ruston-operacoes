// O sistema só considera tarefas do eKyte criadas nos últimos 3 meses.
// Nada é apagado (nem no eKyte nem no nosso banco) — as telas só filtram.
export const JANELA_EKYTE_MESES = 3;

/** "YYYY-MM-DD" de hoje menos a janela. */
export function inicioJanelaEkyte(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - JANELA_EKYTE_MESES);
  return d.toISOString().slice(0, 10);
}
