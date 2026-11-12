// =====================================================================
// MCP — envios: autoria, prazo de correção, histórico e desfazer
// Tudo que o MCP grava passa por aqui: confere permissão, grava como o
// usuário e deixa uma linha em ruston_historico_envios (antes/depois).
// =====================================================================

import type { UsuarioMcp } from "@/lib/mcp/auth";
import { comPadraoPe } from "@/lib/planejamento";

/** Dias que o AUTOR tem para corrigir, desfazer ou apagar o que enviou pelo MCP.
 *  Mude aqui ou pela env MCP_PRAZO_EDICAO_DIAS. Gerente/Coordenador não têm prazo. */
export const PRAZO_EDICAO_DIAS = Number(process.env.MCP_PRAZO_EDICAO_DIAS ?? 7);

export type TipoEnvio = "fca" | "roi" | "ponto_equilibrio" | "tratativa_churn" | "acompanhamento_churn";

type Def = {
  tabela: string;
  rotulo: string;
  colCriado: string;           // coluna com a data de criação
  json?: "dados";              // campos ficam dentro de dados (jsonb)
  campos: string[];            // campos que editar_envio aceita
};

export const TIPOS: Record<TipoEnvio, Def> = {
  fca: {
    tabela: "ruston_fca", rotulo: "FCA", colCriado: "created_at",
    campos: ["nota_resultado", "nota_operacao_trafego", "nota_prazo", "nota_qualidade", "nota_relacionamento", "nota_roi", "fato", "causa", "acao", "observacoes", "status"],
  },
  roi: {
    tabela: "ruston_cliente_roi_mensal", rotulo: "ROI mensal", colCriado: "created_at", json: "dados",
    campos: ["faturamento", "margem_pct", "midia", "fee_v4"],
  },
  ponto_equilibrio: {
    tabela: "ruston_cliente_pe_mensal", rotulo: "Ponto de equilíbrio", colCriado: "created_at", json: "dados",
    campos: Object.keys(comPadraoPe({})),
  },
  tratativa_churn: {
    tabela: "ruston_churn_solicitacoes", rotulo: "Tratativa de churn", colCriado: "created_at",
    campos: ["motivo", "risco", "responsavel_id", "acoes_planejadas", "prazo", "observacoes", "status"],
  },
  acompanhamento_churn: {
    tabela: "ruston_tratativas_churn", rotulo: "Acompanhamento de churn", colCriado: "criado_em",
    campos: ["data_acao", "tipo", "descricao", "retorno_cliente", "resultado", "proximo_passo", "proximo_passo_data", "link_drive", "link_task"],
  },
};

export const tipoDaTabela = (tabela: string) =>
  (Object.keys(TIPOS) as TipoEnvio[]).find((k) => TIPOS[k].tabela === tabela) ?? null;

export const ehGestao = (u: UsuarioMcp) => u.papel === "gerente" || u.papel === "coordenador";
export const ABERTOS = ["solicitado", "em_retencao"];

const dataBr = (d: Date) => d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: "America/Sao_Paulo" });

export function prazoDe(tipo: TipoEnvio, row: any): Date {
  const criado = new Date(row[TIPOS[tipo].colCriado] ?? 0);
  return new Date(criado.getTime() + PRAZO_EDICAO_DIAS * 86_400_000);
}

function ok<T>(r: { data: T; error: any }): T {
  if (r.error) throw new Error(r.error.message);
  return r.data;
}

/** Acha o registro (por tipo, ou procurando em todos) e confere se o cliente é visível ao usuário. */
export async function carregarEnvio(u: UsuarioMcp, id: string, tipo?: TipoEnvio): Promise<{ tipo: TipoEnvio; row: any }> {
  const tipos = tipo ? [tipo] : (Object.keys(TIPOS) as TipoEnvio[]);
  for (const t of tipos) {
    const row = ok(await u.supabase.from(TIPOS[t].tabela).select("*").eq("id", id).maybeSingle()) as any;
    if (!row) continue;
    if (u.squadId) {
      const c = ok(await u.supabase.from("ruston_clientes").select("squad_id").eq("id", row.cliente_id).maybeSingle()) as any;
      if (c?.squad_id !== u.squadId) throw new Error("Esse registro é de um cliente fora do seu squad.");
    }
    return { tipo: t, row };
  }
  throw new Error(`Envio ${id} não encontrado. Use listar_meus_envios para ver os ids.`);
}

/** Regra de quem pode alterar/apagar um registro pelo MCP. Lança erro com a mensagem para o usuário. */
export function conferirPermissao(u: UsuarioMcp, tipo: TipoEnvio, row: any, acao: "editar" | "apagar" | "desfazer") {
  if (u.somenteLeitura) throw new Error("Este acesso é somente leitura.");
  const gestao = ehGestao(u);

  if (tipo === "fca" && row.status === "validado" && !gestao) {
    throw new Error("Este FCA já foi validado. Só Coordenador/Gerente podem alterar (e ele volta para aguardando validação).");
  }

  if (tipo === "tratativa_churn") {
    const aberta = ABERTOS.includes(row.status);
    if (acao === "editar") {
      if (gestao) return;
      if (!aberta) throw new Error("Esta tratativa está encerrada. Só Coordenador/Gerente podem reabrir ou alterar.");
      if (u.pessoaId && row.responsavel_id === u.pessoaId) return;
      // autor dentro do prazo também pode corrigir
    } else if (!aberta) {
      throw new Error("Tratativa encerrada não pode ser apagada nem desfeita pelo MCP. Use reabrir_tratativa_churn (Coordenador/Gerente).");
    }
  }

  if (gestao) return;
  if (row.criado_por_id !== u.userId) {
    throw new Error("Você só pode alterar pelo MCP o que você mesmo enviou. Peça ao Coordenador/Gerente para ajustar pelo sistema.");
  }
  const limite = prazoDe(tipo, row);
  if (Date.now() > limite.getTime()) {
    throw new Error(`Prazo de ${PRAZO_EDICAO_DIAS} dias para alterar este envio encerrou em ${dataBr(limite)}. Peça ao Coordenador/Gerente para ajustar pelo sistema.`);
  }
}

/** Campos que mudaram entre dois estados (para mostrar antes/depois). */
export function diferenca(tipo: TipoEnvio, antes: any, depois: any) {
  const pega = (r: any) => (TIPOS[tipo].json ? r?.dados ?? {} : r ?? {});
  const a = pega(antes), d = pega(depois);
  const chaves = Array.from(new Set([...Object.keys(a), ...Object.keys(d)]))
    .filter((k) => !["updated_at", "atualizado_em", "created_at", "criado_em"].includes(k));
  const out: Record<string, { antes: unknown; depois: unknown }> = {};
  for (const k of chaves) {
    if (JSON.stringify(a[k] ?? null) !== JSON.stringify(d[k] ?? null)) out[k] = { antes: a[k] ?? null, depois: d[k] ?? null };
  }
  return out;
}

export async function registrarHistorico(u: UsuarioMcp, tipoOuTabela: TipoEnvio | string, acao: "criar" | "editar" | "apagar" | "desfazer", antes: any, depois: any) {
  const tabela = (TIPOS as any)[tipoOuTabela]?.tabela ?? tipoOuTabela;
  const reg = depois ?? antes;
  const { error } = await u.supabase.from("ruston_historico_envios").insert({
    tabela, registro_id: reg.id, cliente_id: reg.cliente_id ?? (tabela === "ruston_clientes" ? reg.id : null),
    acao, dados_antes: antes, dados_depois: depois, usuario_id: u.userId, usuario_email: u.email, origem: "mcp",
  });
  if (error) throw new Error("Gravou, mas falhou ao registrar no histórico: " + error.message);
}

/** Monta o patch de uma edição. `null` limpa o campo. */
export function montarPatch(tipo: TipoEnvio, row: any, campos: Record<string, unknown>) {
  const def = TIPOS[tipo];
  const invalidos = Object.keys(campos).filter((k) => !def.campos.includes(k));
  if (invalidos.length) throw new Error(`Campos que não existem em ${def.rotulo}: ${invalidos.join(", ")}. Válidos: ${def.campos.join(", ")}`);
  if (def.json) return { dados: { ...(row.dados ?? {}), ...campos } };
  return { ...campos };
}

/** Atualiza o registro, grava o histórico e devolve o antes/depois. */
export async function aplicarEdicao(u: UsuarioMcp, tipo: TipoEnvio, row: any, patch: Record<string, unknown>) {
  const def = TIPOS[tipo];
  const agora = new Date().toISOString();
  const carimbo = tipo === "acompanhamento_churn" ? { atualizado_em: agora } : { updated_at: agora };
  const novo = ok(await u.supabase.from(def.tabela).update({ ...patch, ...carimbo }).eq("id", row.id).select("*")) as any[];
  if (!novo.length) throw new Error("Sem permissão para alterar este registro.");
  await registrarHistorico(u, tipo, "editar", row, novo[0]);
  return { registro: novo[0], mudancas: diferenca(tipo, row, novo[0]) };
}

/** Insere um registro novo do MCP (autor + origem) e grava o histórico. */
export async function criarRegistro(u: UsuarioMcp, tipo: TipoEnvio, payload: Record<string, unknown>) {
  if (u.somenteLeitura) throw new Error("Este acesso é somente leitura.");
  const novo = ok(await u.supabase.from(TIPOS[tipo].tabela)
    .insert({ ...payload, criado_por_id: u.userId, origem: "mcp" }).select("*").single()) as any;
  await registrarHistorico(u, tipo, "criar", null, novo);
  return novo;
}

export async function apagarRegistro(u: UsuarioMcp, tipo: TipoEnvio, row: any) {
  const apagados = ok(await u.supabase.from(TIPOS[tipo].tabela).delete().eq("id", row.id).select("id")) as any[];
  if (!apagados.length) throw new Error("Sem permissão para apagar este registro.");
  await registrarHistorico(u, tipo, "apagar", row, null);
}

/** Volta o registro ao estado anterior à última alteração do usuário. */
export async function desfazer(u: UsuarioMcp, registroId: string, confirmar: boolean) {
  const hist = ok(await u.supabase.from("ruston_historico_envios").select("*")
    .eq("registro_id", registroId).is("desfeito_em", null).neq("acao", "desfazer")
    .order("criado_em", { ascending: false }).limit(20)) as any[];
  const minha = hist.find((h) => h.usuario_id === u.userId);
  if (!minha) throw new Error("Não achei alteração sua neste registro para desfazer.");
  const depois = hist.filter((h) => h.criado_em > minha.criado_em && h.usuario_id !== u.userId);
  if (depois.length) throw new Error(`Este registro foi alterado depois por ${depois[0].usuario_email}. Desfazer apagaria a alteração dele; ajuste com editar_envio.`);

  const tipo = tipoDaTabela(minha.tabela);
  if (!tipo) throw new Error("Esse tipo de registro não pode ser desfeito pelo MCP.");
  const referencia = minha.dados_depois ?? minha.dados_antes;
  conferirPermissao(u, tipo, referencia, "desfazer");
  if (tipo === "tratativa_churn" && minha.dados_depois && !ABERTOS.includes(minha.dados_depois.status) && minha.dados_antes && ABERTOS.includes(minha.dados_antes.status)) {
    throw new Error("Encerramento de tratativa não se desfaz por aqui. Use reabrir_tratativa_churn (Coordenador/Gerente).");
  }

  const plano = minha.acao === "criar" ? "apagar o registro criado"
    : minha.acao === "apagar" ? "recriar o registro apagado"
    : "voltar os campos ao valor anterior";
  const mudancas = minha.acao === "editar" ? diferenca(tipo, minha.dados_depois, minha.dados_antes) : null;
  if (!confirmar) {
    return { previa: true, tipo: TIPOS[tipo].rotulo, alteracao_de: minha.criado_em, vai: plano, mudancas, registro: minha.acao === "criar" ? minha.dados_depois : minha.dados_antes };
  }

  const def = TIPOS[tipo];
  if (minha.acao === "criar") {
    const atual = ok(await u.supabase.from(def.tabela).select("*").eq("id", registroId).maybeSingle());
    if (atual) {
      const r = ok(await u.supabase.from(def.tabela).delete().eq("id", registroId).select("id")) as any[];
      if (!r.length) throw new Error("Sem permissão para apagar este registro.");
    }
    await registrarHistorico(u, tipo, "desfazer", atual ?? minha.dados_depois, null);
  } else if (minha.acao === "apagar") {
    const r = ok(await u.supabase.from(def.tabela).insert(minha.dados_antes).select("*").single());
    await registrarHistorico(u, tipo, "desfazer", null, r);
  } else {
    const atual = ok(await u.supabase.from(def.tabela).select("*").eq("id", registroId).single()) as any;
    const patch: Record<string, unknown> = {};
    for (const k of Object.keys(minha.dados_antes)) {
      if (["id", "created_at", "criado_em", "updated_at", "atualizado_em"].includes(k)) continue;
      if (JSON.stringify(minha.dados_antes[k]) !== JSON.stringify(atual[k])) patch[k] = minha.dados_antes[k];
    }
    const r = ok(await u.supabase.from(def.tabela).update(patch).eq("id", registroId).select("*")) as any[];
    if (!r.length) throw new Error("Sem permissão para alterar este registro.");
    await registrarHistorico(u, tipo, "desfazer", atual, r[0]);
  }
  ok(await u.supabase.from("ruston_historico_envios").update({ desfeito_em: new Date().toISOString() }).eq("id", minha.id));
  return { ok: true, tipo: def.rotulo, feito: plano, mudancas };
}
