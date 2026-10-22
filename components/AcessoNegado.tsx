import Link from "next/link";

// Tela de acesso negado: usada quando o perfil não pode ver a página (middleware)
// e também no lugar do 404 padrão.
export default function AcessoNegado() {
  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-brand-dark px-4">
      <svg
        viewBox="0 0 200 220"
        aria-hidden="true"
        className="pointer-events-none absolute h-[90vh] max-h-[900px] w-auto text-red-600/20"
        fill="currentColor"
      >
        <path
          fillRule="evenodd"
          d="M100 6C48 6 14 42 14 92c0 30 13 52 30 64v26c0 8 6 14 14 14h10v-18h12v18h14v-18h12v18h14v-18h12v18h10c8 0 14-6 14-14v-26c17-12 30-34 30-64C186 42 152 6 100 6ZM66 82c14 0 24 10 24 22s-10 22-24 22-24-10-24-22 10-22 24-22Zm68 0c14 0 24 10 24 22s-10 22-24 22-24-10-24-22 10-22 24-22Zm-34 50 14 26H86l14-26Z"
        />
      </svg>

      <div className="relative z-10 text-center">
        <h1 className="text-4xl font-black uppercase tracking-tight text-white drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)] md:text-6xl">
          Você não deveria estar aqui
        </h1>
        <p className="mt-4 text-xl font-bold uppercase tracking-widest text-red-400 drop-shadow-[0_2px_8px_rgba(0,0,0,0.8)] md:text-3xl">
          Volte a fazer suas tasks
        </p>
        <Link href="/clientes" className="btn mt-10">
          Voltar para o início
        </Link>
      </div>
    </main>
  );
}
