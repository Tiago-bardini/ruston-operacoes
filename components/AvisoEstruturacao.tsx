"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { ehEstruturacao, semanaNoTitulo, SEMANAS_EE } from "@/lib/analiseIA";
import { formatDate } from "@/lib/types";
import { Form1a1 } from "@/components/reunioes/Form1a1";

// Pop-up para gerente e coordenador: cada semana da Estruturação Estratégica entregue
// pede uma ligação do gerente (GE - EE). O aviso some sozinho quando o GE - EE do
// cliente é registrado com data igual ou depois da entrega. "Ver depois" esconde só nesta sessão.

type Entrega = {
  id: string;
  cliente_id: string;
  cliente_nome: string;
  data_reuniao: string;
  semana: number | null;
};

const CHAVE_SESSAO = "ruston_aviso_ee_adiado";
const DIAS = 30;

export default function AvisoEstruturacao() {
  const supabase = createClient();
  const { loading, isGerente, podeEditar, squadId } = useUsuarioPerfil();
  const [entregas, setEntregas] = useState<Entrega[]>([]);
  const [aberto, setAberto] = useState(false);
  const [registrando, setRegistrando] = useState<Entrega | null>(null);

  async function carregar() {
    const desde = new Date(Date.now() - DIAS * 86400000).toISOString().slice(0, 10);
    const [{ data: rs }, { data: ge }] = await Promise.all([
      supabase.from("ruston_reunioes_cliente")
        .select("id, cliente_id, titulo, data_reuniao, analise_ia, cliente:ruston_clientes(nome, squad_id)")
        .not("cliente_id", "is", null)
        .gte("data_reuniao", desde)
        .order("data_reuniao", { ascending: false }),
      supabase.from("ruston_reunioes_cliente")
        .select("cliente_id, data_reuniao")
        .eq("origem", "ge_ee")
        .gte("data_reuniao", desde),
    ]);
    // Último GE - EE de cada cliente
    const ultimoGe = new Map<string, string>();
    (ge ?? []).forEach((g: any) => {
      if (!ultimoGe.has(g.cliente_id) || g.data_reuniao > ultimoGe.get(g.cliente_id)!) ultimoGe.set(g.cliente_id, g.data_reuniao);
    });
    const lista = ((rs ?? []) as any[])
      // Preparo interno do time ([FOC] / "Preparo") não é entrega. Não dá para usar a flag "interna":
      // a entrega com o cliente às vezes vem marcada como interna (cliente entra com e-mail pessoal)
      .filter((r) => ehEstruturacao(r.titulo) && !/\[foc\]|preparo/i.test(r.titulo ?? ""))
      .filter((r) => isGerente || !squadId || r.cliente?.squad_id === squadId)
      .filter((r) => !(ultimoGe.get(r.cliente_id) && ultimoGe.get(r.cliente_id)! >= r.data_reuniao))
      .map((r) => ({
        id: r.id,
        cliente_id: r.cliente_id,
        cliente_nome: r.cliente?.nome ?? "Cliente",
        data_reuniao: r.data_reuniao,
        semana: semanaNoTitulo(r.titulo) ?? r.analise_ia?.estruturacao?.semana ?? null,
      }));
    setEntregas(lista);
    let adiados: string[] = [];
    try { adiados = JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) ?? "[]"); } catch { /* sem storage */ }
    setAberto(lista.some((e) => !adiados.includes(e.id)));
  }

  useEffect(() => {
    if (!loading && podeEditar) carregar();
  // eslint-disable-next-line
  }, [loading, podeEditar]);

  function verDepois() {
    try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify(entregas.map((e) => e.id))); } catch { /* sem storage */ }
    setAberto(false);
    setRegistrando(null);
  }

  if (!aberto || !entregas.length) return null;

  const nomeSemana = (s: number | null) => (s ? SEMANAS_EE.find((x) => x.semana === s)?.nome : null);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4 overflow-y-auto" onClick={verDepois}>
      <div className="w-full max-w-xl rounded-xl border border-emerald-500/30 bg-brand-panel p-6 shadow-lg my-8"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h3 className="text-lg font-bold text-emerald-300">🧭 Estruturação Estratégica entregue</h3>
            <p className="text-xs text-brand-muted">
              {isGerente ? "Ligue para o cliente e registre o GE - EE" : "O gerente precisa ligar para o cliente (GE - EE)"}
            </p>
          </div>
          <button onClick={verDepois} className="text-brand-muted hover:text-gray-200 text-xl">×</button>
        </div>

        {registrando ? (
          <Form1a1 variante="ge_ee" clienteId={registrando.cliente_id} clienteNome={registrando.cliente_nome}
            onSalvo={() => { setRegistrando(null); carregar(); }}
            onCancelar={() => setRegistrando(null)} />
        ) : (
          <ul className="space-y-2">
            {entregas.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-lg border border-white/5 bg-white/5 p-3">
                <div>
                  <p className="text-sm font-semibold">
                    Estruturação Estratégica Entregue{e.semana ? ` - Semana ${e.semana}` : ""}
                  </p>
                  <p className="text-xs">
                    <b>{e.cliente_nome}</b>
                    <span className="text-brand-muted">
                      {nomeSemana(e.semana) ? ` · ${nomeSemana(e.semana)}` : ""} · {formatDate(e.data_reuniao)}
                    </span>
                  </p>
                </div>
                {isGerente && (
                  <button className="btn shrink-0 text-xs" onClick={() => setRegistrando(e)}>📞 Registrar GE - EE</button>
                )}
              </li>
            ))}
          </ul>
        )}

        <div className="mt-4 flex items-center justify-between">
          <p className="text-[10px] text-brand-muted">O aviso some quando o GE - EE do cliente é registrado.</p>
          <button className="btn-ghost text-xs" onClick={verDepois}>Ver depois</button>
        </div>
      </div>
    </div>
  );
}
