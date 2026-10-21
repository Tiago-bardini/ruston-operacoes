import { redirect } from "next/navigation";

// Página unificada: agora é uma subaba
export default function Page() {
  redirect("/cockpit?aba=gerente");
}
