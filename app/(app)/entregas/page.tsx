"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import type {
  TipoEntrega,
  EntregaPrevista,
  EntregaPrevistaView,
  CategoriaEntrega,
  Cliente,
} from "@/lib/types";
import { CATEGORIA_ENTREGA_LABEL, CATEGORIA_ENTREGA_COR } from "@/lib/types";

type Aba = "por_cliente" | "catalogo";

export default function EntregasPage() {
  const supabase = createClient();
  const { loading: loadingPerfil, podeEditar, escopo, squadId } = useUsuarioPerfil();

  const [aba, setAba] = useState<Aba>("por_cliente");
  const [loading, setLoading] = useState(true);
  const [tipos, setTipos] = useState<TipoEntrega[]>([]);
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [entregas, setEntregas] = useState<EntregaPrevistaView[]>([]);

  async function load() {
    setLoading(true);
    const [{ data: t }, { data: c }, { data: e }] = await Promise.all([
      supabase.from("ruston_tipos_entrega").select("*").order("ordem"),
      supabase.from("ruston_clientes_view").select("*").order("nome"),
      supabase.from("ruston_entregas_view").select("*"),
    ]);
    setTipos((t as TipoEntrega[]) ?? []);
    setClientes((c as Cliente[]) ?? []);
    setEntregas((e as EntregaPrevistaView[]) ?? []);
    setLoading(false);
  }

  useEffect(() => {
    if (!loadingPerfil) load();
    /* eslint-disable-next-line */
  }, [loadingPerfil]);

  // Filtra clientes por escopo (Investidor/Coordenador vê só do squad dele)
  const clientesFiltrados = useMemo(() => {
    if (escopo === "todos") return clientes;
    return clientes.filter((c) => c.squad_id === squadId);
  }, [clientes, escopo, squadId]);

  if (loadingPerfil) return <p className="text-brand-muted">Carregando...</p>;

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Entregas Contratadas</h1>
        <p className="text-sm text-brand-muted">
          Cadastro do que cada cliente tem contratado — cruze com Ekyte pra ver o que foi entregue
        </p>
      </div>

      {/* Abas */}
      <div className="mb-4 flex gap-2 border-b border-white/5">
        <button
          className={`px-4 py-2 text-sm ${aba === "por_cliente" ? "border-b-2 border-brand text-white" : "text-brand-muted hover:text-white"}`}
          onClick={() => setAba("por_cliente")}
        >
          Por Cliente
        </button>
        <button
          className={`px-4 py-2 text-sm ${aba === "catalogo" ? "border-b-2 border-brand text-white" : "text-brand-muted hover:text-white"}`}
          onClick={() => setAba("catalogo")}
        >
          Catálogo de Serviços
        </button>
      </div>

      {loading && <p className="text-brand-muted">Carregando dados...</p>}

      {!loading && aba === "por_cliente" && (
        <TabPorCliente
          clientes={clientesFiltrados}
          tipos={tipos}
          entregas={entregas}
          podeEditar={podeEditar}
          onChanged={load}
        />
      )}

      {!loading && aba === "catalogo" && (
        <TabCatalogo tipos={tipos} podeEditar={podeEditar} onChanged={load} />
      )}
    </div>
  );
}

// ====================================================================
// ABA POR CLIENTE
// ====================================================================
function TabPorCliente({
  clientes,
  tipos,
  entregas,
  podeEditar,
  onChanged,
}: {
  clientes: Cliente[];
  tipos: TipoEntrega[];
  entregas: EntregaPrevistaView[];
  podeEditar: boolean;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [clienteSel, setClienteSel] = useState<string>("");
  const [modalAberto, setModalAberto] = useState(false);
  const [entregaEditando, setEntregaEditando] = useState<EntregaPrevistaView | null>(null);

  useEffect(() => {
    if (clientes.length > 0 && !clienteSel) setClienteSel(clientes[0].id);
  }, [clientes, clienteSel]);

  const entregasDoCliente = entregas.filter((e) => e.cliente_id === clienteSel);
  const clienteAtual = clientes.find((c) => c.id === clienteSel);

  async function remover(e: EntregaPrevistaView) {
    if (!confirm(`Remover "${e.tipo_entrega_nome}" do cliente ${e.cliente_nome}?`)) return;
    await supabase.from("ruston_entregas_previstas").delete().eq("id", e.id);
    onChanged();
  }

  function abrirNovo() {
    setEntregaEditando(null);
    setModalAberto(true);
  }

  function abrirEdicao(e: EntregaPrevistaView) {
    setEntregaEditando(e);
    setModalAberto(true);
  }

  // Agrupa por categoria
  const agrupado: Record<CategoriaEntrega, EntregaPrevistaView[]> = {
    recorrente: [],
    pontual_saber: [],
    pontual_ter: [],
    componente: [],
  };
  entregasDoCliente.forEach((e) => agrupado[e.tipo_entrega_categoria]?.push(e));

  return (
    <div>
      <div className="mb-4 flex items-end gap-3">
        <div className="flex-1">
          <label className="label">Cliente</label>
          <select
            className="input"
            value={clienteSel}
            onChange={(e) => setClienteSel(e.target.value)}
          >
            {clientes.length === 0 && <option value="">— nenhum cliente disponível —</option>}
            {clientes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        </div>
        {podeEditar && clienteSel && (
          <button className="btn" onClick={abrirNovo}>
            + Adicionar entrega
          </button>
        )}
      </div>

      {clienteAtual && (
        <div className="mb-6 rounded-lg border border-white/5 bg-white/[0.02] p-4">
          <p className="text-sm text-brand-muted">
            <strong className="text-white">{clienteAtual.nome}</strong> ·{" "}
            {entregasDoCliente.length} entregas cadastradas
          </p>
        </div>
      )}

      {(Object.keys(agrupado) as CategoriaEntrega[]).map((cat) => {
        const items = agrupado[cat];
        if (items.length === 0) return null;
        return (
          <div key={cat} className="mb-6">
            <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-brand-muted">
              {CATEGORIA_ENTREGA_LABEL[cat]} · {items.length}
            </h2>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                    <th className="px-4 py-3">Serviço</th>
                    <th className="px-4 py-3 w-32">Qtd/mês</th>
                    <th className="px-4 py-3 w-32">% aloc.</th>
                    <th className="px-4 py-3 w-32 text-right">R$/mês</th>
                    <th className="px-4 py-3">Observações</th>
                    <th className="px-4 py-3 w-24"></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((e) => (
                    <tr key={e.id} className="border-b border-white/5 last:border-0">
                      <td className="px-4 py-3 font-medium">{e.tipo_entrega_nome}</td>
                      <td className="px-4 py-3">
                        {e.quantidade_texto || e.quantidade_mensal || "—"}
                      </td>
                      <td className="px-4 py-3">{e.percentual_alocacao || "—"}</td>
                      <td className="px-4 py-3 text-right tabular-nums">
                        {e.valor_mensal
                          ? `R$ ${e.valor_mensal.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
                          : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs text-brand-muted">
                        {e.observacoes || "—"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {podeEditar && (
                          <>
                            <button
                              onClick={() => abrirEdicao(e)}
                              className="text-xs text-brand hover:text-brand/80"
                            >
                              editar
                            </button>
                            {" · "}
                            <button
                              onClick={() => remover(e)}
                              className="text-xs text-red-300 hover:text-red-400"
                            >
                              remover
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      {entregasDoCliente.length === 0 && clienteAtual && (
        <div className="card text-center">
          <p className="text-brand-muted">
            Nenhuma entrega cadastrada para este cliente ainda.
          </p>
          {podeEditar && (
            <button className="btn mt-3" onClick={abrirNovo}>
              + Cadastrar primeira entrega
            </button>
          )}
        </div>
      )}

      {modalAberto && clienteAtual && (
        <ModalEntrega
          cliente={clienteAtual}
          tipos={tipos}
          entrega={entregaEditando}
          onClose={() => {
            setModalAberto(false);
            setEntregaEditando(null);
          }}
          onSaved={() => {
            setModalAberto(false);
            setEntregaEditando(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
}

// ====================================================================
// MODAL DE EDIÇÃO DE ENTREGA
// ====================================================================
function ModalEntrega({
  cliente,
  tipos,
  entrega,
  onClose,
  onSaved,
}: {
  cliente: Cliente;
  tipos: TipoEntrega[];
  entrega: EntregaPrevistaView | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const supabase = createClient();
  const [form, setForm] = useState({
    tipo_entrega_id: entrega?.tipo_entrega_id ?? "",
    quantidade_mensal: entrega?.quantidade_mensal?.toString() ?? "",
    quantidade_texto: entrega?.quantidade_texto ?? "",
    percentual_alocacao: entrega?.percentual_alocacao ?? "",
    valor_mensal: entrega?.valor_mensal?.toString() ?? "",
    observacoes: entrega?.observacoes ?? "",
  });
  const [saving, setSaving] = useState(false);

  async function salvar() {
    if (!form.tipo_entrega_id) {
      alert("Selecione o tipo de entrega");
      return;
    }
    setSaving(true);
    const payload = {
      cliente_id: cliente.id,
      tipo_entrega_id: form.tipo_entrega_id,
      quantidade_mensal: form.quantidade_mensal ? Number(form.quantidade_mensal) : null,
      quantidade_texto: form.quantidade_texto || null,
      percentual_alocacao: form.percentual_alocacao || null,
      valor_mensal: form.valor_mensal ? Number(form.valor_mensal) : null,
      observacoes: form.observacoes || null,
    };
    if (entrega) {
      await supabase.from("ruston_entregas_previstas").update(payload).eq("id", entrega.id);
    } else {
      await supabase.from("ruston_entregas_previstas").insert(payload);
    }
    setSaving(false);
    onSaved();
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-white/10 bg-brand-bg p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 text-lg font-semibold">
          {entrega ? "Editar entrega" : "Nova entrega"}
        </h3>
        <p className="mb-4 text-xs text-brand-muted">Cliente: {cliente.nome}</p>

        <div className="space-y-3">
          <div>
            <label className="label">Tipo de serviço *</label>
            <select
              className="input"
              value={form.tipo_entrega_id}
              onChange={(e) => setForm({ ...form, tipo_entrega_id: e.target.value })}
              disabled={!!entrega}
            >
              <option value="">— selecione —</option>
              {tipos.filter((t) => t.ativo).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.nome}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Quantidade mensal (número)</label>
              <input
                type="number"
                className="input"
                value={form.quantidade_mensal}
                onChange={(e) => setForm({ ...form, quantidade_mensal: e.target.value })}
                placeholder="ex: 8"
              />
            </div>
            <div>
              <label className="label">Quantidade (texto)</label>
              <input
                type="text"
                className="input"
                value={form.quantidade_texto}
                onChange={(e) => setForm({ ...form, quantidade_texto: e.target.value })}
                placeholder="ex: 6-8 ou 25 posts PT + 10 ES"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">% alocação</label>
              <input
                type="text"
                className="input"
                value={form.percentual_alocacao}
                onChange={(e) => setForm({ ...form, percentual_alocacao: e.target.value })}
                placeholder="ex: 10% ou 25% (40h)"
              />
            </div>
            <div>
              <label className="label">R$ / mês</label>
              <input
                type="number"
                step="0.01"
                className="input"
                value={form.valor_mensal}
                onChange={(e) => setForm({ ...form, valor_mensal: e.target.value })}
                placeholder="ex: 3000"
              />
            </div>
          </div>

          <div>
            <label className="label">Observações</label>
            <textarea
              className="input min-h-[70px]"
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              placeholder="ex: cláusula especial de criativos ilimitados"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancelar
          </button>
          <button className="btn" onClick={salvar} disabled={saving}>
            {saving ? "Salvando..." : "Salvar"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ====================================================================
// ABA CATÁLOGO DE SERVIÇOS
// ====================================================================
function TabCatalogo({
  tipos,
  podeEditar,
  onChanged,
}: {
  tipos: TipoEntrega[];
  podeEditar: boolean;
  onChanged: () => void;
}) {
  const supabase = createClient();
  const [novo, setNovo] = useState(false);
  const [form, setForm] = useState({
    nome: "",
    categoria: "recorrente" as CategoriaEntrega,
    descricao: "",
    unidade_padrao: "un",
    ordem: "",
  });

  async function criar() {
    if (!form.nome.trim()) {
      alert("Nome é obrigatório");
      return;
    }
    await supabase.from("ruston_tipos_entrega").insert({
      nome: form.nome.trim(),
      categoria: form.categoria,
      descricao: form.descricao || null,
      unidade_padrao: form.unidade_padrao,
      ordem: form.ordem ? Number(form.ordem) : 0,
    });
    setForm({ nome: "", categoria: "recorrente", descricao: "", unidade_padrao: "un", ordem: "" });
    setNovo(false);
    onChanged();
  }

  async function atualizar(t: TipoEntrega, campo: keyof TipoEntrega, valor: any) {
    await supabase.from("ruston_tipos_entrega").update({ [campo]: valor }).eq("id", t.id);
    onChanged();
  }

  async function toggleAtivo(t: TipoEntrega) {
    await supabase.from("ruston_tipos_entrega").update({ ativo: !t.ativo }).eq("id", t.id);
    onChanged();
  }

  // Agrupa por categoria
  const agrupado: Record<CategoriaEntrega, TipoEntrega[]> = {
    recorrente: [],
    pontual_saber: [],
    pontual_ter: [],
    componente: [],
  };
  tipos.forEach((t) => agrupado[t.categoria]?.push(t));

  return (
    <div>
      {podeEditar && (
        <div className="mb-4 flex justify-end">
          <button className="btn" onClick={() => setNovo(!novo)}>
            {novo ? "Fechar" : "+ Novo tipo de serviço"}
          </button>
        </div>
      )}

      {novo && (
        <div className="mb-6 card border border-brand/40 bg-brand/5">
          <p className="mb-3 text-sm font-semibold">Novo tipo de serviço</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">Nome *</label>
              <input
                className="input"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="ex: Podcast"
              />
            </div>
            <div>
              <label className="label">Categoria *</label>
              <select
                className="input"
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value as CategoriaEntrega })}
              >
                <option value="recorrente">Recorrente</option>
                <option value="pontual_saber">Pontual (Diagnóstico)</option>
                <option value="pontual_ter">Pontual (Implementação)</option>
                <option value="componente">Componente / Comissão</option>
              </select>
            </div>
            <div>
              <label className="label">Unidade</label>
              <input
                className="input"
                value={form.unidade_padrao}
                onChange={(e) => setForm({ ...form, unidade_padrao: e.target.value })}
                placeholder="un, criativo, post, lp, disparo"
              />
            </div>
            <div>
              <label className="label">Ordem de exibição</label>
              <input
                type="number"
                className="input"
                value={form.ordem}
                onChange={(e) => setForm({ ...form, ordem: e.target.value })}
                placeholder="ex: 100"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="label">Descrição</label>
              <textarea
                className="input min-h-[60px]"
                value={form.descricao}
                onChange={(e) => setForm({ ...form, descricao: e.target.value })}
                placeholder="O que engloba esse serviço"
              />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn" onClick={criar}>Salvar</button>
            <button className="btn-ghost" onClick={() => setNovo(false)}>Cancelar</button>
          </div>
        </div>
      )}

      {(Object.keys(agrupado) as CategoriaEntrega[]).map((cat) => {
        const items = agrupado[cat];
        return (
          <div key={cat} className="mb-6">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-brand-muted">
              <span className={`badge ${CATEGORIA_ENTREGA_COR[cat]}`}>
                {CATEGORIA_ENTREGA_LABEL[cat]}
              </span>
              <span>{items.length}</span>
            </h2>
            <div className="card overflow-x-auto p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/5 text-left text-xs uppercase tracking-wide text-brand-muted">
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">Descrição</th>
                    <th className="px-4 py-3 w-24">Unidade</th>
                    <th className="px-4 py-3 w-20">Ativo</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((t) => (
                    <tr
                      key={t.id}
                      className={`border-b border-white/5 last:border-0 ${!t.ativo ? "opacity-40" : ""}`}
                    >
                      <td className="px-4 py-3">
                        {podeEditar ? (
                          <input
                            type="text"
                            className="input py-1 text-sm"
                            defaultValue={t.nome}
                            onBlur={(e) => {
                              if (e.target.value !== t.nome) atualizar(t, "nome", e.target.value);
                            }}
                          />
                        ) : (
                          <span className="font-medium">{t.nome}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {podeEditar ? (
                          <textarea
                            className="input py-1 text-xs min-h-[40px]"
                            defaultValue={t.descricao ?? ""}
                            onBlur={(e) => {
                              if (e.target.value !== t.descricao)
                                atualizar(t, "descricao", e.target.value || null);
                            }}
                          />
                        ) : (
                          <span className="text-brand-muted">{t.descricao}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {podeEditar ? (
                          <input
                            type="text"
                            className="input py-1 text-xs"
                            defaultValue={t.unidade_padrao}
                            onBlur={(e) => {
                              if (e.target.value !== t.unidade_padrao)
                                atualizar(t, "unidade_padrao", e.target.value);
                            }}
                          />
                        ) : (
                          <span className="text-brand-muted">{t.unidade_padrao}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {podeEditar ? (
                          <button
                            onClick={() => toggleAtivo(t)}
                            className={`badge ${t.ativo ? "bg-emerald-500/15 text-emerald-300 border-emerald-500/30" : "bg-white/5 text-brand-muted border-white/10"}`}
                          >
                            {t.ativo ? "Sim" : "Não"}
                          </button>
                        ) : (
                          <span className="text-brand-muted">{t.ativo ? "Sim" : "Não"}</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}
