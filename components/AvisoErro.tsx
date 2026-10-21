"use client";

import { useEffect, useState } from "react";
import { EVENTO_ERRO_BANCO } from "@/lib/supabase/client";

type Aviso = { id: number; msg: string };

function traduzir(msg: string): string {
  if (/row-level security|permission denied/i.test(msg)) return "Sem permissão pra salvar esse dado.";
  if (/duplicate key/i.test(msg)) return "Esse registro já existe.";
  if (/violates foreign key/i.test(msg)) return "Esse registro está ligado a outros dados e não pode ser alterado/excluído.";
  if (/failed to fetch|network/i.test(msg)) return "Sem conexão com o servidor.";
  return msg;
}

/** Mostra no canto da tela qualquer falha ao gravar no banco (ver lib/supabase/client.ts). */
export default function AvisoErro() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);

  useEffect(() => {
    function onErro(e: Event) {
      const id = Date.now() + Math.random();
      const msg = traduzir(String((e as CustomEvent).detail ?? "Erro desconhecido"));
      setAvisos((a) => [...a, { id, msg }]);
      setTimeout(() => setAvisos((a) => a.filter((x) => x.id !== id)), 8000);
    }
    window.addEventListener(EVENTO_ERRO_BANCO, onErro);
    return () => window.removeEventListener(EVENTO_ERRO_BANCO, onErro);
  }, []);

  if (avisos.length === 0) return null;
  return (
    <div className="fixed bottom-4 left-1/2 z-[60] flex w-full max-w-md -translate-x-1/2 flex-col gap-2 px-4">
      {avisos.map((a) => (
        <div key={a.id} className="flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-950/90 p-3 text-sm text-red-100 shadow-lg">
          <span>⚠</span>
          <div className="flex-1">
            <p className="font-semibold">Não foi salvo</p>
            <p className="text-xs text-red-200/80">{a.msg}</p>
          </div>
          <button className="text-red-200/70 hover:text-white"
            onClick={() => setAvisos((x) => x.filter((y) => y.id !== a.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
