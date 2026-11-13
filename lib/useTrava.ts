"use client";

import { useRef, useState } from "react";

/** Evita gravar duas vezes quando a pessoa clica várias vezes em Salvar.
 *  O ref bloqueia na hora (antes do React re-renderizar); `ocupado` serve para desabilitar o botão. */
export function useTrava() {
  const travado = useRef(false);
  const [ocupado, setOcupado] = useState(false);
  async function travar(fn: () => Promise<void>) {
    if (travado.current) return;
    travado.current = true; setOcupado(true);
    try { await fn(); } finally { travado.current = false; setOcupado(false); }
  }
  return { ocupado, travar };
}
