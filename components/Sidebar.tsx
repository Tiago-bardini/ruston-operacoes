"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const NAV_ACTIVE = [
  { href: "/cockpit", label: "Cockpit", icon: "★" },
  { href: "/clientes", label: "Clientes", icon: "◎" },
  { href: "/pessoas", label: "Pessoas", icon: "◆" },
  { href: "/squads", label: "Squads", icon: "◇" },
  { href: "/metas", label: "Metas", icon: "◈" },
  { href: "/fca", label: "FCA", icon: "▤" },
  { href: "/headcount", label: "Headcount", icon: "☰" },
  { href: "/forecast", label: "Forecast", icon: "↗" },
  { href: "/reunioes", label: "Reuniões", icon: "☎" },
];

type NavSoonItem = { label: string; icon: string; subitems?: string[] };

const NAV_SOON: NavSoonItem[] = [
  { label: "Entregas Mensais", icon: "✓", subitems: ["Análise Ekyte"] },
  { label: "Radar de Clientes", icon: "◉" },
];

export default function Sidebar({ email }: { email?: string }) {
  const pathname = usePathname();
  const router = useRouter();
  const supabase = createClient();

  async function signOut() {
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
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

      <nav className="flex-1 space-y-1">
        {NAV_ACTIVE.map((item) => {
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${
                active ? "bg-brand/15 text-white" : "text-brand-muted hover:bg-white/5 hover:text-gray-200"
              }`}
            >
              <span className="w-4 text-center">{item.icon}</span>
              {item.label}
            </Link>
          );
        })}

        <div className="my-4 border-t border-white/5" />
        <p className="mb-2 px-3 text-[10px] uppercase tracking-wide text-brand-muted">Em breve</p>
        {NAV_SOON.map((item) => (
          <div key={item.label}>
            <div className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm text-brand-muted/50">
              <span className="w-4 text-center">{item.icon}</span>
              {item.label}
            </div>
            {item.subitems?.map((sub) => (
              <div
                key={sub}
                className="ml-7 flex cursor-not-allowed items-center gap-2 rounded-lg px-3 py-1.5 text-xs text-brand-muted/40"
              >
                <span className="text-[10px]">└</span>
                {sub}
              </div>
            ))}
          </div>
        ))}
      </nav>

      <div className="mt-4 border-t border-white/5 pt-4">
        {email && (
          <p className="mb-2 truncate px-2 text-xs text-brand-muted" title={email}>
            {email}
          </p>
        )}
        <button onClick={signOut} className="btn-ghost w-full text-xs">Sair</button>
      </div>
    </aside>
  );
}
