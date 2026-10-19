import type { Metadata, Viewport } from "next";
import { InstallApp } from "../components/install-app";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trabad Commercial",
  description: "Votre activité commerciale, toujours à portée de main.",
  applicationName: "Trabad Commercial",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, title: "Trabad Commercial", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = { themeColor: "#0d2146", width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="fr"><body>{children}<InstallApp /></body></html>;
}
