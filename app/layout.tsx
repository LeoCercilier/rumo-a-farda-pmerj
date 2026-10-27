
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/components/AuthProvider";

const siteUrl = "https://rumo-a-farda-pmerj.vercel.app";
const siteTitle = "Rumo à Farda — Soldado PMERJ";
const siteDescription =
  "Organize seus estudos para a carreira de Soldado da Polícia Militar do Estado do Rio de Janeiro.";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: "Rumo à Farda | Preparação Soldado PMERJ",
  description: siteDescription,
  applicationName: "Rumo à Farda",
  openGraph: {
    type: "website",
    locale: "pt_BR",
    url: siteUrl,
    siteName: "Rumo à Farda",
    title: siteTitle,
    description: siteDescription,
    images: [
      {
        url: "/rumo-a-farda-pmerj-og.jpg",
        alt: "Rumo à Farda — preparação para Soldado PMERJ"
      }
    ]
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
    images: ["/rumo-a-farda-pmerj-og.jpg"]
  }
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
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
