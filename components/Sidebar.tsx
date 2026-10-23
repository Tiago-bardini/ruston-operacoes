"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useUsuarioPerfil } from "@/lib/useUsuarioPerfil";
import { PERFIL_LABEL } from "@/lib/types";
import { podeAcessar } from "@/lib/permissoes";

// Quem vê cada item vem de lib/permissoes.ts (a mesma regra bloqueia a URL no middleware)
type NavItem = { href: string; label: string };

type NavGroup = { label: string; icon: string; items: NavItem[] };

const NAV_GROUPS: NavGroup[] = [
  {
    label: "Início", icon: "🏠", items: [
      { href: "/cockpit", label: "Cockpit" },
      { href: "/placar", label: "🏆 Placar dos Squads" },
      { href: "/log-alteracoes", label: "Log de alterações" },
    ],
  },
  {
    label: "Clientes", icon: "◎", items: [
      { href: "/clientes", label: "Carteira" },
      { href: "/planejamento", label: "Planejamento" },
      { href: "/churn", label: "Churn" },
      { href: "/reunioes", label: "Reuniões" },
      { href: "/entregas", label: "Entregas" },
    ],
  },
  {
    label: "Saúde da Carteira", icon: "♥", items: [
      { href: "/health-score", label: "Radar de Churn · SLA" },
      { href: "/radar-whatsapp", label: "Radar WhatsApp" },
      { href: "/fca", label: "FCA" },
    ],
  },
  {
    label: "Receita", icon: "💰", items: [
      { href: "/monetizacao", label: "Monetização" },
      { href: "/forecast", label: "Forecast" },
      { href: "/metas", label: "Metas" },
    ],
  },
  {
    label: "Operação", icon: "⚡", items: [
      { href: "/ekyte", label: "Ekyte" },
      { href: "/produtividade", label: "Produtividade" },
    ],
  },
  {
    label: "Time", icon: "👥", items: [
      { href: "/pessoas", label: "Pessoas" },
      { href: "/squads", label: "Squads" },
      { href: "/organograma", label: "Organograma" },
      { href: "/headcount", label: "Headcount" },
    ],
  },
  {
    label: "Comercial", icon: "🔍", items: [
      { href: "/auditoria-vendas", label: "Auditoria de Vendas" },
      { href: "/analise-reunioes", label: "Análise Reuniões IA" },
    ],
  },
];

const STORAGE_KEY = "ruston_sidebar_abertos";

export default function Sidebar({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();
  const { tipo, isGerente } = useUsuarioPerfil();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  function permitido(it: NavItem) {
    return podeAcessar(it.href, tipo);
  }

  const grupos = NAV_GROUPS
    .map((g) => ({ ...g, items: g.items.filter(permitido) }))
    .filter((g) => g.items.length > 0);

  // Grupos abertos: lembra a escolha do usuário e sempre abre o grupo da página atual
  const [abertos, setAbertos] = useState<string[]>([]);
  useEffect(() => {
    let salvos: string[] = [];
    try { salvos = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]"); } catch {}
    setAbertos(salvos);
  }, []);
  useEffect(() => {
    const atual = NAV_GROUPS.find((g) => g.items.some((it) => pathname.startsWith(it.href)));
    if (atual) setAbertos((a) => (a.includes(atual.label) ? a : [...a, atual.label]));
  }, [pathname]);

  function alternar(label: string) {
    setAbertos((a) => {
      const novo = a.includes(label) ? a.filter((x) => x !== label) : [...a, label];
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(novo)); } catch {}
      return novo;
    });
  }

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-white/5 bg-brand-panel/50 p-4">
      <div className="mb-8 flex items-center gap-2 px-2">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand text-sm font-black">R</div>
        <div className="leading-tight">
          <p className="text-sm font-bold">Ruston Operações</p>
          <p className="text-[10px] text-brand-muted">Painel interno</p>
        </div>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto">
        {grupos.map((g) => {
          const aberto = abertos.includes(g.label);
          const grupoAtivo = g.items.some((it) => pathname.startsWith(it.href));
          // Grupo com um item só vira link direto
          if (g.items.length === 1) {
            return (
              <Link
                key={g.label}
                href={g.items[0].href}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  grupoAtivo ? "bg-brand/15 text-white" : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <span className="w-4 text-center">{g.icon}</span>
                {g.label}
              </Link>
            );
          }
          return (
            <div key={g.label}>
              <button
                onClick={() => alternar(g.label)}
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
                  grupoAtivo ? "text-white" : "text-gray-300 hover:bg-white/5"
                }`}
              >
                <span className="w-4 text-center">{g.icon}</span>
                <span className="flex-1 text-left">{g.label}</span>
                <span className={`text-[10px] text-brand-muted transition ${aberto ? "rotate-90" : ""}`}>▶</span>
              </button>
              {aberto && (
                <div className="mb-1 ml-5 space-y-0.5 border-l border-white/5 pl-2">
                  {g.items.map((item) => {
                    const active = pathname.startsWith(item.href);
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm transition ${
                          active ? "bg-brand/15 text-white" : "text-brand-muted hover:bg-white/5 hover:text-gray-200"
                        }`}
                      >
                        {item.label}
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </nav>
      <div className="mt-4 border-t border-white/5 pt-4">
        {email && (
          <p className="mb-1 truncate px-2 text-xs text-brand-muted" title={email}>
            {email}
          </p>
        )}
        <p className="mb-2 px-2 text-[10px] text-brand">
          Perfil: {PERFIL_LABEL[tipo]}
        </p>
        <div className="flex gap-2">
          {isGerente && (
            <Link
              href="/usuarios"
              title="Gestão de Usuários"
              className={`btn-ghost px-3 text-xs ${pathname.startsWith("/usuarios") ? "border-brand text-white" : ""}`}
            >⚿</Link>
          )}
          <button onClick={signOut} className="btn-ghost flex-1 text-xs">Sair</button>
        </div>
      </div>
    </aside>
  );
}
