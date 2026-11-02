"use client";

import { useEffect, useState } from "react";
import { perguntaVisivel, type Formulario, type Pergunta } from "@/lib/pesquisas";

/* ============================== PÁGINA PÚBLICA DA PESQUISA ==============================
   O cliente abre /p/<token> (QR Code ou link no grupo) e responde sem login. */

type Resposta = string | number | string[];

export default function ResponderPesquisa({ params }: { params: { token: string } }) {
  const [estado, setEstado] = useState<"carregando" | "erro" | "respondendo" | "ja_respondida" | "enviada">("carregando");
  const [erro, setErro] = useState("");
  const [cliente, setCliente] = useState("");
  const [form, setForm] = useState<Formulario | null>(null);
  const [respostas, setRespostas] = useState<Record<string, Resposta>>({});
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/pesquisa/${params.token}`);
        const j = await res.json();
        if (!res.ok) throw new Error(j.error ?? "Pesquisa não encontrada");
        setCliente(j.cliente);
        setForm(j.formulario);
        setEstado(j.respondida ? "ja_respondida" : "respondendo");
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Pesquisa não encontrada");
        setEstado("erro");
      }
    })();
  }, [params.token]);

  const set = (id: string, v: Resposta) => setRespostas((r) => ({ ...r, [id]: v }));

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const faltando = form.perguntas.find((p) => p.obrigatoria && perguntaVisivel(p, respostas) &&
      (respostas[p.id] == null || respostas[p.id] === "" || (Array.isArray(respostas[p.id]) && !(respostas[p.id] as string[]).length)));
    if (faltando) {
      setErro("Responda as perguntas obrigatórias (marcadas com *).");
      document.getElementById(`q-${faltando.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setEnviando(true);
    setErro("");
    try {
      const res = await fetch(`/api/pesquisa/${params.token}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ respostas }),
      });
      const j = await res.json();
      if (res.status === 409) { setEstado("ja_respondida"); return; }
      if (!res.ok) throw new Error(j.error ?? "Não foi possível enviar");
      setEstado("enviada");
      window.scrollTo({ top: 0 });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível enviar");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="min-h-screen px-4 py-8 sm:py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-black">R</div>
          <div className="leading-tight">
            <p className="text-sm font-bold">Ruston & Co</p>
            <p className="text-[10px] text-brand-muted">V4 Company</p>
          </div>
        </div>

        {estado === "carregando" && <p className="text-brand-muted">Carregando pesquisa...</p>}

        {estado === "erro" && (
          <div className="card text-center">
            <p className="font-semibold">Pesquisa não encontrada</p>
            <p className="mt-1 text-sm text-brand-muted">{erro || "Confira o link recebido."}</p>
          </div>
        )}

        {(estado === "enviada" || estado === "ja_respondida") && (
          <div className="card py-10 text-center">
            <p className="text-4xl">🙏</p>
            <p className="mt-3 text-lg font-bold">{estado === "enviada" ? "Obrigado pela sua resposta!" : "Esta pesquisa já foi respondida"}</p>
            <p className="mt-1 text-sm text-brand-muted">Sua opinião ajuda o time a ajustar o trabalho com você. Pode fechar esta página.</p>
          </div>
        )}

        {estado === "respondendo" && form && (
          <form onSubmit={enviar} className="space-y-4">
            <div className="card">
              {cliente && <p className="text-xs font-semibold uppercase tracking-wide text-brand">{cliente}</p>}
              <h1 className="mt-1 text-xl font-bold">{form.titulo}</h1>
              <p className="mt-2 text-sm text-gray-300">{form.abertura}</p>
            </div>

            {form.perguntas.filter((p) => perguntaVisivel(p, respostas)).map((p) => (
              <CampoPergunta key={p.id} p={p} valor={respostas[p.id]} onChange={(v) => set(p.id, v)} />
            ))}

            {erro && <p className="text-sm text-red-300">{erro}</p>}
            <button type="submit" className="btn w-full py-3 text-base" disabled={enviando}>
              {enviando ? "Enviando..." : "Enviar resposta"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function CampoPergunta({ p, valor, onChange }: { p: Pergunta; valor: Resposta | undefined; onChange: (v: Resposta) => void }) {
  return (
    <div id={`q-${p.id}`} className="card">
      {p.titulo && <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-brand-muted">{p.titulo}</p>}
      <p className="mb-3 font-medium">{p.texto}{p.obrigatoria && <span className="text-brand"> *</span>}</p>

      {p.tipo === "escala" && p.escala && (() => {
        const { min, max, minLabel, maxLabel, labels } = p.escala;
        const valores = Array.from({ length: max - min + 1 }, (_, i) => min + i);
        return (
          <div>
            <div className="flex gap-2">
              {valores.map((v) => (
                <button key={v} type="button" onClick={() => onChange(v)}
                  className={`h-12 flex-1 rounded-lg border text-base font-bold transition ${
                    valor === v ? "border-brand bg-brand text-white" : "border-white/10 bg-black/30 text-gray-200 hover:border-brand/60"}`}>
                  {v}
                </button>
              ))}
            </div>
            {labels ? (
              typeof valor === "number" && labels[valor] && <p className="mt-2 text-center text-sm text-gray-300">{labels[valor]}</p>
            ) : (
              <div className="mt-1.5 flex justify-between text-[11px] text-brand-muted">
                <span>{minLabel}</span><span>{maxLabel}</span>
              </div>
            )}
          </div>
        );
      })()}

      {p.tipo === "unica" && (
        <div className="space-y-2">
          {p.opcoes?.map((o) => (
            <label key={o} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
              valor === o ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/20"}`}>
              <input type="radio" name={p.id} checked={valor === o} onChange={() => onChange(o)} className="accent-[#e11d2a]" />
              {o}
            </label>
          ))}
        </div>
      )}

      {p.tipo === "multipla" && (
        <div className="space-y-2">
          {p.opcoes?.map((o) => {
            const lista = Array.isArray(valor) ? valor : [];
            const marcado = lista.includes(o);
            return (
              <label key={o} className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 text-sm transition ${
                marcado ? "border-brand bg-brand/10" : "border-white/10 hover:border-white/20"}`}>
                <input type="checkbox" checked={marcado} className="accent-[#e11d2a]"
                  onChange={() => onChange(marcado ? lista.filter((x) => x !== o) : [...lista, o])} />
                {o}
              </label>
            );
          })}
        </div>
      )}

      {p.tipo === "texto" && (
        <textarea className="input min-h-[90px]" maxLength={3000} placeholder="Sua resposta"
          value={typeof valor === "string" ? valor : ""} onChange={(e) => onChange(e.target.value)} />
      )}
    </div>
  );
}
