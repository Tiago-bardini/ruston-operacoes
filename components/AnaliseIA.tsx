"use client";

import type { AnaliseExtra } from "@/lib/analiseIA";

// Blocos da análise de IA que Reuniões e Radar WhatsApp mostram igual.

const corNivel = (bom: boolean, ruim: boolean) =>
  ruim ? "bg-red-500/15 text-red-300" : bom ? "bg-emerald-500/15 text-emerald-300" : "bg-amber-500/15 text-amber-300";

function Selo({ label, valor, cor }: { label: string; valor: string; cor: string }) {
  return (
    <span className={`rounded px-2 py-0.5 text-[10px] ${cor}`}>
      <span className="opacity-70">{label}:</span> <b>{valor}</b>
    </span>
  );
}

/** Selos curtos para listas (temperatura, estresse, reclamação, compra, resultado). */
export function SelosAnalise({ a, temperatura, risco }: { a: Partial<AnaliseExtra>; temperatura?: string | null; risco?: string | null }) {
  const compra = a.intencao_compra?.nivel ?? "nenhuma";
  const resultado = a.resultado_percebido?.avaliacao ?? "nao_mencionado";
  return (
    <div className="flex flex-wrap gap-1">
      {temperatura && (
        <Selo label="Temperatura" valor={temperatura} cor={corNivel(temperatura === "quente", temperatura === "fria")} />
      )}
      {risco && <Selo label="Churn" valor={risco} cor={corNivel(risco === "baixo", risco === "alto")} />}
      {a.estresse && <Selo label="Estresse" valor={a.estresse} cor={corNivel(a.estresse === "nenhum", a.estresse === "alto")} />}
      {a.reclamacao && (
        <Selo label="Reclamou" valor={a.reclamacao.houve ? "sim" : "não"} cor={corNivel(!a.reclamacao.houve, a.reclamacao.houve)} />
      )}
      {compra !== "nenhuma" && <Selo label="Quer comprar" valor={compra} cor="bg-emerald-500/15 text-emerald-300" />}
      {resultado !== "nao_mencionado" && (
        <Selo label="Resultado" valor={resultado} cor={corNivel(resultado === "satisfeito", resultado === "insatisfeito")} />
      )}
      {a.concorrencia?.mencionou && <Selo label="Concorrência" valor="citou" cor="bg-red-500/15 text-red-300" />}
    </div>
  );
}

function Bloco({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <div className="mt-2">
      <p className="text-[10px] uppercase tracking-wide text-brand-muted">{titulo}</p>
      <div className="text-xs">{children}</div>
    </div>
  );
}

function Lista({ itens }: { itens?: string[] }) {
  if (!itens?.length) return null;
  return <ul className="list-disc pl-4 space-y-0.5">{itens.map((x, i) => <li key={i}>{x}</li>)}</ul>;
}

/** Análise completa (detalhes). */
export function DetalhesAnalise({ a }: { a: Partial<AnaliseExtra> }) {
  const c = a.conducao;
  return (
    <div>
      {!!a.insights?.length && (
        <Bloco titulo="💡 Insights"><Lista itens={a.insights} /></Bloco>
      )}
      {a.estresse && a.estresse !== "nenhum" && a.estresse_detalhe && (
        <Bloco titulo="Estresse do cliente">{a.estresse_detalhe}</Bloco>
      )}
      {a.reclamacao?.houve && (
        <Bloco titulo="Reclamações"><Lista itens={a.reclamacao.motivos} /></Bloco>
      )}
      {a.intencao_compra && a.intencao_compra.nivel !== "nenhuma" && (
        <Bloco titulo="Intenção de compra">
          {a.intencao_compra.produtos?.length ? <b>{a.intencao_compra.produtos.join(", ")}</b> : null}
          {a.intencao_compra.evidencia && <p className="text-brand-muted">“{a.intencao_compra.evidencia}”</p>}
        </Bloco>
      )}
      {a.resultado_percebido && a.resultado_percebido.avaliacao !== "nao_mencionado" && (
        <Bloco titulo="Resultado percebido">{a.resultado_percebido.detalhe}</Bloco>
      )}
      {!!a.mudancas_negocio?.length && (
        <Bloco titulo="Mudanças no negócio do cliente">
          <ul className="list-disc pl-4">
            {a.mudancas_negocio.map((m, i) => <li key={i}><b>{m.tipo}:</b> {m.descricao}</li>)}
          </ul>
        </Bloco>
      )}
      {a.concorrencia?.mencionou && (
        <Bloco titulo="Concorrência">{a.concorrencia.detalhe}</Bloco>
      )}
      {!!a.compromissos?.length && (
        <Bloco titulo="Compromissos">
          <ul className="space-y-0.5">
            {a.compromissos.map((m, i) => (
              <li key={i}>
                <span className={m.lado === "ruston" ? "text-brand" : "text-sky-300"}>{m.lado === "ruston" ? "Ruston" : "Cliente"}</span>
                {" · "}{m.o_que}
                {m.responsavel && <span className="text-brand-muted"> — {m.responsavel}</span>}
                {m.prazo && <span className="text-amber-300"> · até {m.prazo}</span>}
              </li>
            ))}
          </ul>
        </Bloco>
      )}
      {c && c.nota > 0 && (
        <Bloco titulo={`Condução do time · nota ${c.nota}/5`}>
          <p className="text-brand-muted">
            {c.teve_pauta ? "✓" : "✗"} pauta · {c.apresentou_dados ? "✓" : "✗"} dados · {c.fechou_proximos_passos ? "✓" : "✗"} próximos passos
          </p>
          {c.comentario && <p>{c.comentario}</p>}
        </Bloco>
      )}
    </div>
  );
}
