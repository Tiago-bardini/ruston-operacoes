export type Cargo =
  | "coordenador"
  | "gestor_projetos"
  | "gestor_trafego"
  | "designer"
  | "social_media"
  | "copy"
  | "gerente"
  | "coo"
  | "tech"
  | "outro";

export const CARGO_LABEL: Record<Cargo, string> = {
  coordenador: "Coordenador",
  gestor_projetos: "Gestor de Projetos",
  gestor_trafego: "Gestor de Tráfego",
  designer: "Designer",
  social_media: "Social Media",
  copy: "Copy",
  gerente: "Gerente",
  coo: "COO",
  tech: "TECH",
  outro: "Outro",
};

export type EtapaCliente =
  | "onboarding"
  | "estruturacao_estrategica"
  | "byline"
  | "em_recuperacao"
  | "suspenso"
  | "cancelado";

export const ETAPA_LABEL: Record<EtapaCliente, string> = {
  onboarding: "Onboarding",
  estruturacao_estrategica: "Estruturação Estratégica",
  byline: "By-line",
  em_recuperacao: "Em Recuperação",
  suspenso: "Suspenso",
  cancelado: "Cancelado",
};

export const ETAPA_COLOR: Record<EtapaCliente, string> = {
  onboarding: "bg-sky-500/20 text-sky-300 border-sky-500/30",
  estruturacao_estrategica: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  byline: "bg-purple-500/20 text-purple-300 border-purple-500/30",
  em_recuperacao: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  suspenso: "bg-orange-500/20 text-orange-300 border-orange-500/30",
  cancelado: "bg-red-500/20 text-red-300 border-red-500/30",
};

export type TierCliente = "tiny" | "small" | "medium" | "large";

export const TIER_LABEL: Record<TierCliente, string> = {
  tiny: "TINY",
  small: "SMALL",
  medium: "MEDIUM",
  large: "LARGE",
};

export interface Squad {
  id: string;
  nome: string;
  label: string | null;
  cor: string | null;
  logo_url: string | null;
  coordenador_id: string | null;
  ativo: boolean;
  created_at: string;
}

export interface Pessoa {
  id: string;
  nome: string;
  email: string | null;
  cargo: Cargo;
  squad_id: string | null;
  foto_url: string | null;
  ativo: boolean;
  observacoes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Cliente {
  id: string;
  codigo_interno: string | null;
  nome: string;
  etapa: EtapaCliente;
  mrr: number;
  fee: number | null;
  tier: TierCliente | null;
  data_assinatura: string | null;
  data_ultima_alteracao_fee: string | null;
  data_churn: string | null;
  contrato_url: string | null;
  churn_realizado: boolean;
  coordenador_id: string | null;
  account_id: string | null;
  gestor_trafego_id: string | null;
  designer_id: string | null;
  squad_id: string | null;
  observacoes: string | null;
  ativo: boolean;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

export interface ClienteView extends Cliente {
  lt_meses: number | null;
  coordenador_nome: string | null;
  account_nome: string | null;
  gestor_trafego_nome: string | null;
  designer_nome: string | null;
  squad_nome: string | null;
}

export function formatBRL(value: number | null | undefined): string {
  if (value == null) return "—";
  return Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso + "T00:00:00").toLocaleDateString("pt-BR");
}
