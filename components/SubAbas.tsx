"use client";

import { useEffect } from "react";

export type SubAba<T extends string> = { v: T; label: string };

/** Barra de subabas no topo da página (mesmo visual dos toggles de Clientes/Churn).
 *  Lê ?aba= da URL ao abrir e mantém a URL atualizada ao trocar, pra dar pra
 *  compartilhar link direto de uma subaba. */
export default function SubAbas<T extends string>({ abas, ativa, onChange }: {
  abas: SubAba<T>[];
  ativa: T;
  onChange: (v: T) => void;
}) {
  useEffect(() => {
    const daUrl = new URLSearchParams(window.location.search).get("aba");
    const valida = abas.find((a) => a.v === daUrl);
    if (valida && valida.v !== ativa) onChange(valida.v);
    // eslint-disable-next-line
  }, []);

  function trocar(v: T) {
    onChange(v);
    const url = new URL(window.location.href);
    if (v === abas[0].v) url.searchParams.delete("aba");
    else url.searchParams.set("aba", v);
    window.history.replaceState(null, "", url.toString());
  }

  if (abas.length < 2) return null;
  return (
    <div className="mb-6 inline-flex rounded-lg border border-white/10 bg-brand-panel/50 p-1">
      {abas.map((it) => (
        <button
          key={it.v}
          onClick={() => trocar(it.v)}
          className={`rounded-md px-4 py-1.5 text-xs font-medium transition ${
            ativa === it.v ? "bg-brand text-white" : "text-brand-muted hover:text-gray-200"
          }`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
