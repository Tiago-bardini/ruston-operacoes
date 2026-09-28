// =====================================================================
// TIPOS DE ENTREGAS — cole ESSE BLOCO no FIM do arquivo lib/types.ts
// (não substitua nada, só adiciona no final, antes do último `}` se houver)
// =====================================================================

export type CategoriaEntrega = "recorrente" | "pontual_saber" | "pontual_ter" | "componente";

export const CATEGORIA_ENTREGA_LABEL: Record<CategoriaEntrega, string> = {
  recorrente: "Recorrente",
  pontual_saber: "Pontual (Diagnóstico)",
  pontual_ter: "Pontual (Implementação)",
  componente: "Componente / Comissão",
};

export const CATEGORIA_ENTREGA_COR: Record<CategoriaEntrega, string> = {
  recorrente:    "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  pontual_saber: "bg-sky-500/20 text-sky-300 border-sky-500/40",
  pontual_ter:   "bg-purple-500/20 text-purple-300 border-purple-500/40",
  componente:    "bg-amber-500/20 text-amber-300 border-amber-500/40",
};

export interface TipoEntrega {
  id: string;
  nome: string;
  categoria: CategoriaEntrega;
  descricao: string | null;
  unidade_padrao: string;
  ordem: number;
  ativo: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface EntregaPrevista {
  id: string;
  cliente_id: string;
  tipo_entrega_id: string;
  quantidade_mensal: number | null;
  quantidade_texto: string | null;
  percentual_alocacao: string | null;
  valor_mensal: number | null;
  observacoes: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface EntregaPrevistaView extends EntregaPrevista {
  cliente_nome: string;
  tipo_entrega_nome: string;
  tipo_entrega_categoria: CategoriaEntrega;
  tipo_entrega_unidade: string;
}
