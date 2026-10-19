import { redirect } from "next/navigation";
import { auth } from "../lib/auth";
import { TerrainApp } from "../components/terrain-app";
import { SessionProvider } from "next-auth/react";

export default async function Home() {
  const session = await auth();
  if (!session?.accessToken) redirect("/connexion");
  return <SessionProvider refetchInterval={5 * 60}><TerrainApp initialSession={session} /></SessionProvider>;
}
