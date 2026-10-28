import type { PerfilUsuario } from "@/lib/types";

// Fonte única de quem acessa o quê. Usada pelo menu (Sidebar) e pelo middleware,
// que bloqueia o acesso direto pela URL. Rota fora da lista = todos os perfis.
export const ROTAS_RESTRITAS: { prefixo: string; perfis: PerfilUsuario[] }[] = [
  { prefixo: "/painel-gerente", perfis: ["gerente"] },
  { prefixo: "/projecao", perfis: ["gerente"] },
  { prefixo: "/cockpit", perfis: ["gerente", "coordenador"] },
  { prefixo: "/usuarios", perfis: ["gerente"] },
  { prefixo: "/log-alteracoes", perfis: ["gerente"] },
  { prefixo: "/health-score", perfis: ["gerente", "coordenador"] },
  { prefixo: "/playbook-nps", perfis: ["gerente", "coordenador"] },
  { prefixo: "/sla", perfis: ["gerente", "coordenador"] },
  { prefixo: "/radar-whatsapp", perfis: ["gerente", "coordenador"] },
  { prefixo: "/forecast", perfis: ["gerente", "coordenador"] },
  { prefixo: "/produtividade", perfis: ["gerente", "coordenador"] },
  { prefixo: "/headcount", perfis: ["gerente", "coordenador"] },
  { prefixo: "/placar", perfis: ["gerente", "coordenador"] },
  { prefixo: "/auditoria-vendas", perfis: ["gerente", "coordenador"] },
  { prefixo: "/analise-reunioes", perfis: ["gerente", "coordenador"] },
];

export function podeAcessar(path: string, perfil: PerfilUsuario): boolean {
  const regra = ROTAS_RESTRITAS.find((r) => path === r.prefixo || path.startsWith(r.prefixo + "/"));
  return !regra || regra.perfis.includes(perfil);
}

export function rotaRestrita(path: string): boolean {
  return ROTAS_RESTRITAS.some((r) => path === r.prefixo || path.startsWith(r.prefixo + "/"));
}
