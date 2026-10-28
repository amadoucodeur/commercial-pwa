"use client";

import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useEffect, useMemo, useState } from "react";
import { Building2, ChevronRight, CloudOff, Compass, ExternalLink, FileText, KeyRound, Layers3, LogOut, RefreshCw } from "lucide-react";
import { VitrineWorkspace } from "./vitrine-workspace";
import { SITE_URL, type SectionVitrine } from "../lib/vitrine";

type Vue = SectionVitrine | "compte";

// Espace des comptes qui ont seulement le droit « site vitrine » : même cadre que l'application commerciale.
export function VitrineApp({ initialSession }: { initialSession: Session }) {
  const { data: refreshedSession, status, update: actualiserSession } = useSession();
  const session = refreshedSession ?? initialSession;
  const client = useMemo(() => createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${session.accessToken}` } }, auth: { persistSession: false } },
  ), [session.accessToken]);
  const [vue, setVue] = useState<Vue>("biens");
  const [actualisation, setActualisation] = useState(0);
  const [enLigne, setEnLigne] = useState(true);
  const niveau = session.acces?.vitrine;

  useEffect(() => {
    const majReseau = () => { setEnLigne(navigator.onLine); if (navigator.onLine) void actualiserSession(); };
    setEnLigne(navigator.onLine);
    window.addEventListener("online", majReseau);
    window.addEventListener("offline", majReseau);
    return () => { window.removeEventListener("online", majReseau); window.removeEventListener("offline", majReseau); };
  }, [actualiserSession]);
  // Droits modifiés ou session expirée : on repasse par l'accueil, qui choisit le bon espace.
  useEffect(() => {
    if (!enLigne || status === "loading") return;
    if (status === "unauthenticated" || !session.accessToken) window.location.assign("/connexion");
    else if (session.acces?.commercial || !session.acces?.vitrine) window.location.assign("/");
  }, [enLigne, session.accessToken, session.acces?.commercial, session.acces?.vitrine, status]);

  const navigation = [
    ["biens", KeyRound, "Location"], ["ventes", Building2, "Ventes"], ["formules", Layers3, "Formules"],
    ["contenus", FileText, "Contenus"], ["compte", Compass, "Compte"],
  ] as const;
  const initiale = (session.user.name ?? "T").slice(0, 1).toUpperCase();

  return <div className="app-frame">
    <header className="topbar"><div className="topbar-inner">
      <div className="brand"><Image src="/icon-192.png" alt="" width={38} height={38} priority /><span>Trabad Vitrine</span></div>
      <div className="topbar-actions">
        {!enLigne && <span className="sync-chip offline" role="status"><CloudOff size={15} /> Hors ligne</span>}
        <button className="icon-button" onClick={() => setActualisation((valeur) => valeur + 1)} aria-label="Actualiser"><RefreshCw size={19} /></button>
      </div>
    </div></header>
    <aside className="desktop-sidebar" aria-label="Site vitrine"><div className="desktop-sidebar-inner">
      <p className="desktop-sidebar-label">SITE VITRINE</p>
      <nav aria-label="Navigation principale">{navigation.map(([cle, Icone, titre]) => <button key={cle} type="button" className={vue === cle ? "active" : ""} aria-current={vue === cle ? "page" : undefined} onClick={() => setVue(cle)}><Icone size={19} /><span>{titre}</span><ChevronRight size={16} className="desktop-nav-chevron" /></button>)}</nav>
      <div className="desktop-sidebar-foot"><span className="desktop-sidebar-avatar">{initiale}</span><span><strong>{session.user.name || "Équipe Trabad"}</strong><small>{niveau === "editor" ? "Éditeur du site" : "Lecteur du site"}</small></span></div>
    </div></aside>
    <main className={`content view-${vue === "compte" ? "compte" : "vitrine"}`}>
      {vue === "compte" ? <>
        <div className="page-title"><p className="eyebrow">VOTRE ESPACE</p><h1>Mon compte</h1></div>
        <div className="account-card"><div className="account-avatar">{initiale}</div><strong>{session.user.name}</strong><span>Site vitrine Trabad</span><div className="account-status"><span className={enLigne ? "" : "offline"}>● {enLigne ? "En ligne" : "Hors ligne"}</span><span>{niveau === "editor" ? "Éditeur" : "Lecture seule"}</span></div></div>
        <a className="manager-link" href={SITE_URL} target="_blank" rel="noopener noreferrer"><span className="manager-icon"><ExternalLink size={20} /></span><span><strong>Ouvrir trabad.com</strong><small>Voir le site tel que le public le voit</small></span><ChevronRight size={19} /></a>
        <div className="account-note"><Compass size={20} /><p>Les modifications enregistrées ici sont visibles sur le site public en quelques instants. Les annonces en brouillon restent invisibles.</p></div>
        <button className="logout" disabled={!enLigne} onClick={() => void signOut({ callbackUrl: "/connexion" })}><LogOut size={18} /> Se déconnecter</button>
      </> : <VitrineWorkspace client={client} canEdit={niveau === "editor"} section={vue} onglets={false} refreshKey={actualisation} enLigne={enLigne} />}
    </main>
    <nav className="bottom-nav vitrine-nav" aria-label="Navigation principale">{navigation.map(([cle, Icone, titre]) => <button key={cle} className={vue === cle ? "active" : ""} onClick={() => setVue(cle)}><Icone size={21} /><span>{titre}</span></button>)}</nav>
  </div>;
}
