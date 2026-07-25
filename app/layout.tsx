import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Ruston Operações",
  description: "Painel operacional da Ruston & Co",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
