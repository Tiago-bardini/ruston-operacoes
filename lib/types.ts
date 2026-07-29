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

export type NivelSenioridade = "junior" | "pleno" | "senior" | "especialista";
export type VersaoV = "v1" | "v2" | "v3" | "v4";

export const NIVEL_LABEL: Record<NivelSenioridade, string> = {
  junior: "Junior",
  pleno: "Pleno",
  senior: "Sênior",
  especialista: "Especialista",
};

export const V_LABEL: Record<VersaoV, string> = {
  v1: "V1",
  v2: "V2",
  v3: "V3",
  v4: "V4",
};

export interface Pessoa {
  id: string;
  nome: string;
  email: string | null;
  cargo: Cargo;
  squad_id: string | null;
  foto_url: string | null;
  ativo: boolean;
  observacoes: string | null;
  nivel_senioridade: NivelSenioridade | null;
  nivel_v: VersaoV | null;
  created_at: string;
  updated_at: string;
}

export type UnidadeMeta = "percentual" | "nota" | "reais" | "quantidade";

export const UNIDADE_LABEL: Record<UnidadeMeta, string> = {
  percentual: "%",
  nota: "nota",
  reais: "R$",
  quantidade: "qtde",
};

export interface MetaEmpresa {
  id: string;
  ano: number;
  mes: number;
  metrica: string;
  metrica_label: string;
  unidade: UnidadeMeta;
  valor_meta: number;
  valor_realizado: number | null;
  observacoes: string | null;
  responsavel_id: string | null;
  ordem: number;
  created_at: string;
  updated_at: string;
}

export interface MetaSquad extends MetaEmpresa {
  squad_id: string;
}

export function formatMeta(valor: number | null | undefined, unidade: UnidadeMeta): string {
  if (valor == null) return "—";
  if (unidade === "percentual") return `${valor}%`;
  if (unidade === "reais") return formatBRL(valor);
  if (unidade === "nota") return String(valor);
  return String(valor);
}

export const MESES_LABEL = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

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
  prazo_contrato_meses: number | null;
  data_vencimento_contrato: string | null;
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

/** Status de vencimento do contrato — usado pra colorir badges e alertas */
export type StatusVencimento = "vencido" | "critico" | "atencao" | "ok" | "sem_data";

export function statusVencimento(dataVencimento: string | null | undefined): StatusVencimento {
  if (!dataVencimento) return "sem_data";
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(dataVencimento + "T00:00:00");
  const diasRestantes = Math.floor((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
  if (diasRestantes < 0) return "vencido";
  if (diasRestantes <= 30) return "critico";
  if (diasRestantes <= 60) return "atencao";
  return "ok";
}

export function diasParaVencimento(dataVencimento: string | null | undefined): number | null {
  if (!dataVencimento) return null;
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const venc = new Date(dataVencimento + "T00:00:00");
  return Math.floor((venc.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24));
}

export const STATUS_VENCIMENTO_LABEL: Record<StatusVencimento, string> = {
  vencido: "Vencido",
  critico: "Crítico (≤30 dias)",
  atencao: "Atenção (≤60 dias)",
  ok: "OK",
  sem_data: "Sem data",
};

export const STATUS_VENCIMENTO_COLOR: Record<StatusVencimento, string> = {
  vencido:  "bg-red-500/20 text-red-300 border-red-500/40",
  critico:  "bg-orange-500/20 text-orange-300 border-orange-500/40",
  atencao:  "bg-amber-500/20 text-amber-300 border-amber-500/40",
  ok:       "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  sem_data: "bg-white/5 text-brand-muted border-white/10",
};
