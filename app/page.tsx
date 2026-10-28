import { redirect } from "next/navigation";
import { auth } from "../lib/auth";
import { TerrainApp } from "../components/terrain-app";
import { VitrineApp } from "../components/vitrine-app";
import { SessionProvider } from "next-auth/react";

export default async function Home() {
  const session = await auth();
  if (!session?.accessToken) redirect("/connexion");
  // Le droit commercial ouvre l'application terrain (avec la vitrine en plus si le compte y a droit) ;
  // un compte limité au site vitrine arrive directement dans son espace.
  return <SessionProvider refetchInterval={5 * 60} refetchWhenOffline={false}>
    {session.acces?.commercial ? <TerrainApp initialSession={session} /> : <VitrineApp initialSession={session} />}
  </SessionProvider>;
}
