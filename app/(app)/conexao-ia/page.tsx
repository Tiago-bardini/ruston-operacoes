"use client";

import { useEffect, useState } from "react";

type Token = { id: string; prefixo: string; nome: string | null; criado_em: string; ultimo_uso_em: string | null; revogado_em: string | null };

const dataHora = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—");

/** Conexão do Claude com o sistema (MCP): cada pessoa gera o próprio endereço. */
export default function ConexaoIaPage() {
  const [info, setInfo] = useState<{ pode_usar: boolean; papel: string | null; tokens: Token[] } | null>(null);
  const [novaUrl, setNovaUrl] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gerando, setGerando] = useState(false);
  const [copiado, setCopiado] = useState(false);

  async function load() {
    const r = await fetch("/api/mcp-token");
    const j = await r.json();
    if (!r.ok) setErro(j.error ?? "Erro ao carregar");
    else setInfo(j);
  }
  useEffect(() => { load(); }, []);

  async function gerar() {
    setGerando(true); setErro(null); setCopiado(false);
    const r = await fetch("/api/mcp-token", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome: "Claude" }) });
    const j = await r.json();
    setGerando(false);
    if (!r.ok) return setErro(j.error ?? "Erro ao gerar");
    setNovaUrl(j.url);
    load();
  }

  async function revogar(id: string) {
    if (!confirm("Revogar este acesso? O Claude conectado com ele para de funcionar na hora.")) return;
    const r = await fetch("/api/mcp-token", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) });
    if (!r.ok) setErro((await r.json()).error ?? "Erro ao revogar");
    load();
  }

  async function copiar() {
    if (!novaUrl) return;
    await navigator.clipboard.writeText(novaUrl);
    setCopiado(true);
  }

  const ativos = info?.tokens.filter((t) => !t.revogado_em) ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold">🤖 Conexão IA (Claude)</h1>
        <p className="text-brand-muted text-sm mt-1">
          Conecte o seu Claude ao sistema para consultar e preencher FCA, tratativas de churn, clientes, planejamento/ROI e pesquisas conversando.
          A IA age com o <b>seu</b> usuário: vale o mesmo acesso do painel e tudo fica no Log de alterações com o seu nome.
        </p>
      </div>

      {erro && <div className="card border-red-500/40 text-red-300 text-sm">{erro}</div>}

      {info && !info.pode_usar && (
        <div className="card text-sm text-amber-300">A conexão com IA é liberada só para Gerente, Coordenador e Gestor de Projetos. Fale com o gerente se você precisa de acesso.</div>
      )}

      {info?.pode_usar && (
        <div className="card space-y-3">
          <h2 className="font-semibold">1. Gere o seu endereço</h2>
          <button className="btn" onClick={gerar} disabled={gerando}>{gerando ? "Gerando..." : "Gerar endereço de conexão"}</button>
          {novaUrl && (
            <div className="space-y-2">
              <p className="text-sm text-amber-300">Copie agora: por segurança ele só aparece uma vez. Não compartilhe, ele dá acesso com o seu usuário.</p>
              <div className="flex gap-2">
                <input className="input flex-1 font-mono text-xs" readOnly value={novaUrl} onFocus={(e) => e.target.select()} />
                <button className="btn" onClick={copiar}>{copiado ? "Copiado ✓" : "Copiar"}</button>
              </div>
            </div>
          )}

          <h2 className="font-semibold pt-2">2. Adicione no Claude</h2>
          <ol className="text-sm list-decimal ml-5 space-y-1 text-brand-muted">
            <li>No Claude (site ou app), abra <b>Configurações → Conectores</b>.</li>
            <li>Clique em <b>Adicionar conector personalizado</b>.</li>
            <li>Nome: <b>Ruston Operações</b>. URL: cole o endereço gerado. Salve.</li>
            <li>Numa conversa, ative o conector no menu de ferramentas e peça, por exemplo: <i>&quot;Preenche o FCA desta semana da Belgo Cercas com base nesta transcrição&quot;</i>.</li>
          </ol>
          <p className="text-xs text-brand-muted">A IA sempre mostra o que vai gravar e espera você confirmar. Pelo Claude não é possível apagar nada.</p>
        </div>
      )}

      {info && info.tokens.length > 0 && (
        <div className="card">
          <h2 className="font-semibold mb-2">Meus acessos</h2>
          <table className="w-full text-sm">
            <thead className="text-brand-muted text-left">
              <tr><th className="py-1">Início</th><th>Criado</th><th>Último uso</th><th></th></tr>
            </thead>
            <tbody>
              {info.tokens.map((t) => (
                <tr key={t.id} className="border-t border-white/5">
                  <td className="py-1 font-mono">{t.prefixo}…</td>
                  <td>{dataHora(t.criado_em)}</td>
                  <td>{dataHora(t.ultimo_uso_em)}</td>
                  <td className="text-right">
                    {t.revogado_em
                      ? <span className="text-brand-muted text-xs">revogado</span>
                      : <button className="btn-ghost text-xs text-red-300" onClick={() => revogar(t.id)}>Revogar</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ativos.length > 1 && <p className="text-xs text-brand-muted mt-2">Você tem {ativos.length} acessos ativos. Revogue os que não usa mais.</p>}
        </div>
      )}
    </div>
  );
}
