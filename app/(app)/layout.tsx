import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import Sidebar from "@/components/Sidebar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  return (
    <div className="flex min-h-screen">
      <Sidebar email={user.email ?? undefined} />
      <main className="flex-1 overflow-y-auto p-8">{children}</main>
    </div>
  );
}
