import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Rumo à Farda | Preparação Soldado PMERJ",
  description:
    "Organize seus estudos para a carreira de Soldado da Polícia Militar do Estado do Rio de Janeiro.",
  applicationName: "Rumo à Farda"
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#10251e"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
