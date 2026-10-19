"use client";

import Image from "next/image";
import { createClient } from "@supabase/supabase-js";
import type { Session } from "next-auth";
import { signOut, useSession } from "next-auth/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, ChevronRight, CirclePlus,
  Clock3, Compass, Crosshair, Home, LogOut, MapPin, MapPinned,
  Phone, RefreshCw, Search, SlidersHorizontal, Sparkles, TrendingUp, Users, X,
} from "lucide-react";
import { ProspectForm } from "./prospect-form";
import { ManagerLocalities } from "./manager-localities";
import { ManagerWorkspace } from "./manager-workspace";
import { DesktopDossierTable } from "./desktop-dossier-table";
import { actions, services, sources, type Contact, type Localite, type ProspectPayload } from "../lib/crm";

type Dossier = {
  id: string;
  contact_id: string;
  owner_id: string | null;
  service: string;
  services: string[];
  source: string;
  etape: string;
  temperature: string | null;
  besoin: string | null;
  type_bien: string | null;
  adresse_bien: string | null;
  agence_en_place: string | null;
  localite_id: string | null;
  gps_latitude: number | null;
  gps_longitude: number | null;
  created_at: string;
};
type Tache = { id: string; opportunite_id: string; titre: string; echeance_at: string; notes: string | null };
type Activite = { id: string; type_activite: string; resultat: string | null; notes: string | null; decision: string | null; etape_classee: string | null; effectuee_at: string };
type Vue = "accueil" | "dossiers" | "agenda" | "pilotage" | "compte" | "localites";
type FiltresDesktop = { etape: string; service: string; source: string; temperature: string; localite: string; agent: string; debut: string; fin: string };
const filtresDesktopVides: FiltresDesktop = { etape: "", service: "", source: "", temperature: "", localite: "", agent: "", debut: "", fin: "" };

const etapes = [
  ["nouveau", "Nouveau"], ["contacte", "Contact établi"], ["rdv", "Rendez-vous"],
  ["proposition", "Proposition"], ["negociation", "Négociation"],
  ["gagne", "Gagné"], ["perdu", "Perdu"], ["reporte", "Reporté"],
] as const;
const contactFields = "id,owner_id,nom,telephone,localisation,role_contact,telephone_normalise";
const dossierFields = "id,contact_id,owner_id,service,services,source,etape,temperature,besoin,type_bien,adresse_bien,agence_en_place,localite_id,gps_latitude,gps_longitude,created_at";
const taillePageDossiers = 500;
const label = (options: readonly (readonly [string, string])[], value: string) =>
  options.find(([key]) => key === value)?.[1] ?? value;
const day = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Abidjan", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));
const dateTime = (value: string) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));
const nextReminder = () => {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setUTCHours(9, 0, 0, 0);
  return date.toISOString().slice(0, 16);
};

export function TerrainApp({ initialSession }: { initialSession: Session }) {
  const { data: refreshedSession, status: sessionStatus } = useSession();
  const session = refreshedSession ?? initialSession;
  const client = useMemo(() => createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: `Bearer ${session.accessToken}` } }, auth: { persistSession: false } },
  ), [session.accessToken]);
  const [vue, setVue] = useState<Vue>("accueil");
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [dossiers, setDossiers] = useState<Dossier[]>([]);
  const [dossiersSuivants, setDossiersSuivants] = useState(false);
  const [chargementSuite, setChargementSuite] = useState(false);
  const [taches, setTaches] = useState<Tache[]>([]);
  const [localites, setLocalites] = useState<Localite[]>([]);
  const [profilActif, setProfilActif] = useState(false);
  const [manager, setManager] = useState(false);
  const [agents, setAgents] = useState<{ user_id: string; nom: string }[]>([]);
  const [agentsTous, setAgentsTous] = useState<{ user_id: string; nom: string; actif: boolean }[]>([]);
  const [selection, setSelection] = useState<string | null>(null);
  const [completion, setCompletion] = useState<Tache | null>(null);
  const [historique, setHistorique] = useState<Activite[]>([]);
  const [completionDecision, setCompletionDecision] = useState("programmer");
  const [creation, setCreation] = useState(false);
  const [recherche, setRecherche] = useState("");
  const [filtresDesktop, setFiltresDesktop] = useState<FiltresDesktop>(filtresDesktopVides);
  const [brouillonFiltres, setBrouillonFiltres] = useState<FiltresDesktop>(filtresDesktopVides);
  const [filtresOuverts, setFiltresOuverts] = useState(false);
  const boutonFiltresRef = useRef<HTMLButtonElement>(null);
  const boutonFiltresMobileRef = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [managerRefreshKey, setManagerRefreshKey] = useState(0);
  const [gestionAvancee, setGestionAvancee] = useState(false);
  const [agentGestion, setAgentGestion] = useState("");
  const [desktopLayout, setDesktopLayout] = useState(false);
  const requestVersions = useRef({ contacts: 0, dossiers: 0, taches: 0, localites: 0, access: 0 });
  const pageDossiers = useRef(1);
  const suiteEnCours = useRef(false);
  const premierChargement = useRef(true);

  const chargerContactsManquants = useCallback(async (items: Dossier[], connus: Set<string>) => {
    const manquants = [...new Set(items.map((item) => item.contact_id))].filter((id) => !connus.has(id));
    for (let offset = 0; offset < manquants.length; offset += 75) {
      try {
        const { data, error } = await client.from("crm_contacts").select(contactFields).in("id", manquants.slice(offset, offset + 75));
        if (error) throw error;
        if (data?.length) setContacts((courants) => {
          const ids = new Set(courants.map((contact) => contact.id));
          return [...courants, ...data.filter((contact) => !ids.has(contact.id))];
        });
      } catch {
        setMessage("Certains contacts n’ont pas pu être chargés. Actualisez pour réessayer.");
        return;
      }
    }
  }, [client]);
  const chercherContacts = useCallback(async (telephone: string) => {
    const digits = telephone.replace(/\D/g, "");
    if (digits.length < 8) return [];
    const { data, error } = await client.from("crm_contacts").select(contactFields)
      .eq("organisation_id", session.user.organisationId)
      .ilike("telephone_normalise", `%${digits.slice(-8)}`)
      .limit(10);
    if (error) throw error;
    return (data ?? []) as Contact[];
  }, [client, session.user.organisationId]);

  const charger = useCallback(async (initial = false, scope: "all" | "crm" | "localites" | "dossiers" | "taches" = "all") => {
    if (initial) setLoading(true);
    const organisationId = session.user.organisationId;
    const chargerContacts = scope === "all" || scope === "crm";
    const chargerDossiers = chargerContacts || scope === "dossiers";
    const chargerTaches = chargerContacts || scope === "taches";
    const chargerLocalites = scope === "all" || scope === "localites";
    const versions = {
      contacts: chargerContacts ? ++requestVersions.current.contacts : 0,
      dossiers: chargerDossiers ? ++requestVersions.current.dossiers : 0,
      taches: chargerTaches ? ++requestVersions.current.taches : 0,
      localites: chargerLocalites ? ++requestVersions.current.localites : 0,
      access: scope === "all" ? ++requestVersions.current.access : 0,
    };
    try {
      const [contactsResult, dossiersResult, tachesResult, localiteResult, accessResults] = await Promise.all([
        chargerContacts ? client.from("crm_contacts").select(contactFields).eq("organisation_id", organisationId).order("created_at", { ascending: false }).limit(500) : null,
        chargerDossiers ? client.from("crm_opportunites").select(dossierFields).eq("organisation_id", organisationId).is("archived_at", null).order("created_at", { ascending: false }).order("id").limit(taillePageDossiers + 1) : null,
        chargerTaches ? client.from("crm_taches").select("id,opportunite_id,titre,echeance_at,notes").eq("organisation_id", organisationId).eq("responsable_id", session.user.id).eq("statut", "a_faire").order("echeance_at").limit(500) : null,
        chargerLocalites ? client.from("crm_localites").select("id,nom,type,actif").eq("organisation_id", organisationId).order("nom") : null,
        scope === "all" ? Promise.all([
          client.from("crm_profiles").select("user_id").eq("user_id", session.user.id).maybeSingle(),
          client.rpc("crm_is_manager", { p_organisation_id: organisationId }),
        ]) : null,
      ]);
      const failure = [contactsResult, dossiersResult, tachesResult, localiteResult, ...(accessResults ?? [])]
        .find((result) => result?.error)?.error;
      const derniereRequete = (!contactsResult || versions.contacts === requestVersions.current.contacts)
        && (!dossiersResult || versions.dossiers === requestVersions.current.dossiers)
        && (!tachesResult || versions.taches === requestVersions.current.taches)
        && (!localiteResult || versions.localites === requestVersions.current.localites)
        && (!accessResults || versions.access === requestVersions.current.access);
      if (failure && derniereRequete) setMessage(`Certaines données n’ont pas pu être chargées : ${failure.message}`);
      if (contactsResult && versions.contacts === requestVersions.current.contacts && !contactsResult.error) setContacts(contactsResult.data ?? []);
      if (dossiersResult && versions.dossiers === requestVersions.current.dossiers && !dossiersResult.error) {
        const premiers = (dossiersResult.data ?? []).slice(0, taillePageDossiers);
        setDossiers(premiers);
        setDossiersSuivants((dossiersResult.data?.length ?? 0) > taillePageDossiers);
        pageDossiers.current = 1;
        if (contactsResult && !contactsResult.error) {
          void chargerContactsManquants(premiers, new Set((contactsResult.data ?? []).map((contact) => contact.id)));
        }
      }
      if (tachesResult && versions.taches === requestVersions.current.taches && !tachesResult.error) setTaches(tachesResult.data ?? []);
      if (localiteResult && versions.localites === requestVersions.current.localites && !localiteResult.error) setLocalites((localiteResult.data ?? []) as Localite[]);
      if (accessResults && versions.access === requestVersions.current.access) {
        if (!accessResults[0].error) setProfilActif(!!accessResults[0].data);
        if (!accessResults[1].error) setManager(!!accessResults[1].data);
      }
    } catch {
      if (versions.dossiers === 0 || versions.dossiers === requestVersions.current.dossiers) {
        setMessage("Connexion indisponible. Vérifiez votre réseau puis actualisez.");
      }
    } finally {
      if (initial) setLoading(false);
    }
  }, [chargerContactsManquants, client, session.user.id, session.user.organisationId]);

  async function chargerSuiteDossiers() {
    if (suiteEnCours.current || !dossiersSuivants) return;
    suiteEnCours.current = true;
    setChargementSuite(true);
    const version = requestVersions.current.dossiers;
    const debut = pageDossiers.current * taillePageDossiers;
    try {
      const { data, error } = await client.from("crm_opportunites").select(dossierFields)
        .eq("organisation_id", session.user.organisationId).is("archived_at", null)
        .order("created_at", { ascending: false }).order("id")
        .range(debut, debut + taillePageDossiers);
      if (error) throw error;
      if (version !== requestVersions.current.dossiers) return;
      const suivants = (data ?? []).slice(0, taillePageDossiers);
      await chargerContactsManquants(suivants, new Set(contacts.map((contact) => contact.id)));
      if (version !== requestVersions.current.dossiers) return;
      setDossiers((courants) => {
        const ids = new Set(courants.map((dossier) => dossier.id));
        return [...courants, ...suivants.filter((dossier) => !ids.has(dossier.id))];
      });
      setDossiersSuivants((data?.length ?? 0) > taillePageDossiers);
      pageDossiers.current += 1;
    } catch (error) {
      setMessage(error && typeof error === "object" && "message" in error ? String(error.message) : "Chargement des dossiers impossible.");
    } finally {
      suiteEnCours.current = false;
      setChargementSuite(false);
    }
  }

  useEffect(() => {
    const initial = premierChargement.current;
    premierChargement.current = false;
    void charger(initial);
  }, [charger]);
  useEffect(() => {
    if (!manager) return;
    let active = true;
    void Promise.resolve(client.rpc("crm_utilisateurs_eligibles", { p_organisation_id: session.user.organisationId }))
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(`Agents indisponibles : ${error.message}`);
        else {
          setAgentsTous((data ?? []) as { user_id: string; nom: string; actif: boolean }[]);
          setAgents((data ?? []).filter((item: { actif: boolean; profil_existant: boolean }) => item.actif && item.profil_existant));
        }
      }).catch(() => { if (active) setMessage("Agents indisponibles. Vérifiez votre connexion."); });
    return () => { active = false; };
  }, [client, manager, managerRefreshKey, session.user.organisationId]);
  useEffect(() => {
    if (!selection) { setHistorique([]); return; }
    let active = true;
    void Promise.resolve(client.from("crm_activites").select("id,type_activite,resultat,notes,decision,etape_classee,effectuee_at")
      .eq("opportunite_id", selection).order("effectuee_at", { ascending: false }).limit(50))
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(`Historique indisponible : ${error.message}`);
        else setHistorique((data ?? []) as Activite[]);
      }).catch(() => { if (active) setMessage("Historique indisponible. Vérifiez votre connexion."); });
    return () => { active = false; };
  }, [client, selection]);
  useEffect(() => {
    if (sessionStatus === "unauthenticated" || !session.accessToken) window.location.assign("/connexion");
  }, [session.accessToken, sessionStatus]);
  useEffect(() => {
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
  }, []);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const actualiser = () => setDesktopLayout(media.matches);
    actualiser();
    media.addEventListener("change", actualiser);
    return () => media.removeEventListener("change", actualiser);
  }, []);
  useEffect(() => {
    if (!filtresOuverts) return;
    const fermerEchap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setFiltresOuverts(false);
        (window.matchMedia("(min-width: 1024px)").matches ? boutonFiltresRef : boutonFiltresMobileRef).current?.focus();
      }
    };
    document.addEventListener("keydown", fermerEchap);
    return () => document.removeEventListener("keydown", fermerEchap);
  }, [filtresOuverts]);
  useEffect(() => {
    if (!filtresOuverts && !selection && !completion && !creation) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [filtresOuverts, selection, completion, creation]);

  const contactParId = useMemo(() => new Map(contacts.map((contact) => [contact.id, contact])), [contacts]);
  const dossierParId = useMemo(() => new Map(dossiers.map((dossier) => [dossier.id, dossier])), [dossiers]);
  const localiteParId = useMemo(() => new Map(localites.map((localite) => [localite.id, localite])), [localites]);
  const agentParId = useMemo(() => new Map(agentsTous.map((agent) => [agent.user_id, agent.nom])), [agentsTous]);
  const aujourdHui = day(new Date().toISOString());
  const retard = taches.filter((tache) => day(tache.echeance_at) < aujourdHui);
  const duJour = taches.filter((tache) => day(tache.echeance_at) === aujourdHui);
  const prochaines = taches.filter((tache) => day(tache.echeance_at) > aujourdHui);
  const dossierActif = selection ? dossierParId.get(selection) : null;
  const contactActif = dossierActif ? contactParId.get(dossierActif.contact_id) : null;
  const prenom = session.user.name?.split(/[\s@._-]/)[0] || "vous";
  const filtrerDossiersDesktop = useCallback((criteres: FiltresDesktop) => dossiers.filter((dossier) => {
    const contact = contactParId.get(dossier.contact_id);
    const localite = dossier.localite_id ? localiteParId.get(dossier.localite_id)?.nom : contact?.localisation;
    const texte = `${contact?.nom ?? ""} ${contact?.telephone ?? ""} ${(dossier.services ?? [dossier.service]).join(" ")} ${localite ?? ""}`;
    const jour = dossier.created_at.slice(0, 10);
    return texte.toLocaleLowerCase("fr-FR").includes(recherche.toLocaleLowerCase("fr-FR"))
      && (!criteres.etape || dossier.etape === criteres.etape)
      && (!criteres.service || (dossier.services ?? [dossier.service]).includes(criteres.service))
      && (!criteres.source || dossier.source === criteres.source)
      && (!criteres.temperature || (dossier.temperature ?? "sans_temperature") === criteres.temperature)
      && (!criteres.localite || (dossier.localite_id ?? "sans_localite") === criteres.localite)
      && (!manager || !criteres.agent || (dossier.owner_id ?? "sans_agent") === criteres.agent)
      && (!criteres.debut || jour >= criteres.debut)
      && (!criteres.fin || jour <= criteres.fin);
  }), [dossiers, contactParId, localiteParId, recherche, manager]);
  const dossiersVisiblesDesktop = useMemo(() => filtrerDossiersDesktop(filtresDesktop), [filtrerDossiersDesktop, filtresDesktop]);
  const dossiersVisibles = dossiersVisiblesDesktop;
  const apercuFiltresDesktop = filtresOuverts ? filtrerDossiersDesktop(brouillonFiltres).length : dossiersVisiblesDesktop.length;
  const nombreFiltresDesktop = Object.values(filtresDesktop).filter(Boolean).length;
  const modifierFiltreDesktop = (champ: keyof FiltresDesktop, valeur: string) =>
    setBrouillonFiltres((courants) => ({ ...courants, [champ]: valeur }));
  const ouvrirFiltres = () => { setBrouillonFiltres(filtresDesktop); setFiltresOuverts(true); };
  const fermerFiltres = () => {
    setFiltresOuverts(false);
    (window.matchMedia("(min-width: 1024px)").matches ? boutonFiltresRef : boutonFiltresMobileRef).current?.focus();
  };

  async function executer(operation: () => PromiseLike<{ error: { message: string } | null }>, succes: string, scope: "crm" | "taches" | "none" = "crm") {
    setBusy(true);
    setMessage("");
    try {
      const { error } = await operation();
      if (error) throw error;
      setMessage(succes);
      if (scope !== "none") await charger(false, scope);
      return true;
    } catch (error) {
      setMessage(error && typeof error === "object" && "message" in error
        ? String(error.message) : "L’opération a échoué.");
      return false;
    } finally { setBusy(false); }
  }

  async function creerDossier(payload: ProspectPayload) {
    const success = await executer(() => client.rpc("crm_creer_dossier_multi", {
      p_nom: payload.nom, p_telephone: payload.telephone,
      p_contact_id: payload.contactId, p_services: payload.services, p_source: payload.source,
      p_owner_id: manager ? payload.ownerId : null,
      p_localite_id: payload.localiteId, p_role_contact: payload.roleContact,
      p_type_bien: payload.typeBien, p_adresse_bien: payload.adresseBien,
      p_agence_en_place: payload.agenceEnPlace, p_besoin: payload.besoin,
      p_temperature: payload.temperature, p_action: payload.action,
      p_echeance_at: payload.echeanceAt,
      p_gps_latitude: payload.gpsLatitude, p_gps_longitude: payload.gpsLongitude,
      p_gps_precision_m: payload.gpsPrecisionM, p_gps_source: payload.gpsSource,
    }), "Prospect ajouté avec succès.");
    if (success) { setCreation(false); setVue("dossiers"); setManagerRefreshKey((value) => value + 1); }
    return success;
  }

  async function terminerTache(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!completion) return;
    const form = new FormData(event.currentTarget);
    const decision = String(form.get("decision") || "programmer");
    const success = await executer(() => client.rpc("crm_clore_action", {
      p_tache_id: completion.id,
      p_type_activite: String(form.get("type")),
      p_resultat: String(form.get("resultat") ?? "") || null,
      p_notes: String(form.get("notes") ?? "") || null,
      p_decision: decision,
      p_prochaine_action: decision === "programmer" ? String(form.get("prochaine_action") || "") : null,
      p_echeance_at: decision === "programmer" ? new Date(`${String(form.get("echeance"))}:00Z`).toISOString() : null,
      p_etape: decision === "classer" ? String(form.get("etape")) : null,
    }), "Action terminée et suite enregistrée dans l’historique.");
    if (success) setCompletion(null);
  }

  function ajouterGps(dossier: Dossier) {
    if (!navigator.geolocation) { setMessage("GPS indisponible sur cet appareil."); return; }
    setMessage("Recherche de votre position…");
    navigator.geolocation.getCurrentPosition((position) => {
      void executer(() => client.from("crm_opportunites").update({
        gps_latitude: position.coords.latitude,
        gps_longitude: position.coords.longitude,
        gps_precision_m: Math.round(position.coords.accuracy),
        gps_source: "automatique", gps_captured_at: new Date().toISOString(),
      }).eq("id", dossier.id), "Position GPS ajoutée au dossier.", "none").then((success) => {
        if (success) setDossiers((courants) => courants.map((item) => item.id === dossier.id
          ? { ...item, gps_latitude: position.coords.latitude, gps_longitude: position.coords.longitude } : item));
      });
    }, () => setMessage("Position non obtenue. Autorisez l’accès GPS puis réessayez."),
    { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
  }

  function carteTache(tache: Tache) {
    const dossier = dossierParId.get(tache.opportunite_id);
    const contact = dossier ? contactParId.get(dossier.contact_id) : null;
    return <article className="task-card" key={tache.id}>
      <div className="task-leading"><span className="task-icon"><CalendarDays size={18} /></span><div><strong>{tache.titre}</strong><small>{contact?.nom ?? "Dossier"} · {dateTime(tache.echeance_at)}</small></div></div>
      {tache.notes && <p className="task-note">{tache.notes}</p>}
      <div className="task-actions">
        {contact?.telephone && <a href={`tel:${contact.telephone}`}><Phone size={16} /> Appeler</a>}
        <button onClick={() => setSelection(tache.opportunite_id)}>Voir la fiche <ChevronRight size={15} /></button>
        <button className="finish-action" onClick={() => { setCompletionDecision("programmer"); setMessage(""); setCompletion(tache); }}><Check size={16} /> Terminer</button>
      </div>
    </article>;
  }

  const navigation = [
    ["accueil", Home, "Accueil"], ["dossiers", Users, "Dossiers"],
    ["agenda", CalendarDays, "Agenda"],
    ...(manager ? [["pilotage", TrendingUp, "Performance"]] as const : []),
    ["compte", Compass, "Compte"],
  ] as const;

  return <div className="app-frame">
    <header className="topbar"><div className="topbar-inner"><div className="brand"><Image src="/trabad-logo.png" alt="Trabad Commercial" width={116} height={32} priority /></div><button className="icon-button" onClick={() => vue === "pilotage" || vue === "dossiers" && gestionAvancee ? setManagerRefreshKey((value) => value + 1) : void charger()} aria-label="Actualiser"><RefreshCw size={19} /></button></div></header>
    <aside className="desktop-sidebar" aria-label="Espace commercial"><div className="desktop-sidebar-inner"><p className="desktop-sidebar-label">ESPACE COMMERCIAL</p><nav aria-label="Navigation principale">{navigation.map(([key, Icon, title]) => <button key={key} type="button" className={vue === key || key === "compte" && vue === "localites" ? "active" : ""} aria-current={vue === key ? "page" : undefined} onClick={() => { setVue(key); setSelection(null); }}><Icon size={19} /><span>{title}</span><ChevronRight size={16} className="desktop-nav-chevron" /></button>)}</nav><div className="desktop-sidebar-foot"><span className="desktop-sidebar-avatar">{(session.user.name ?? "C").slice(0, 1).toUpperCase()}</span><span><strong>{session.user.name || "Commercial"}</strong><small>{manager ? "Responsable commercial" : "Agent commercial"}</small></span></div></div></aside>
    <main className={`content view-${vue}`}>
      {message && !creation && !selection && !completion && <div className="toast" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Fermer"><X size={16} /></button></div>}
      {loading ? <div className="loading"><Sparkles size={23} /> Votre espace se prépare…</div> : <>
        {vue === "accueil" && <>
          <section className="hero"><div className="hero-decoration" /><p className="eyebrow light">AUJOURD’HUI SUR LE TERRAIN</p><h1>Bonjour, {prenom}<span>✦</span></h1><p>Chaque rencontre est une opportunité.</p><div className="hero-bottom"><span><CalendarDays size={15} /> {new Intl.DateTimeFormat("fr-FR", { dateStyle: "full", timeZone: "Africa/Abidjan" }).format(new Date())}</span></div></section>
          <div className="stats"><div className="stat-card"><span className="stat-symbol blue"><Users size={19} /></span><strong>{dossiers.length}{dossiersSuivants ? "+" : ""}</strong><small>Dossiers chargés</small></div><div className="stat-card"><span className="stat-symbol violet"><CalendarDays size={19} /></span><strong>{duJour.length}</strong><small>Aujourd’hui</small></div><div className="stat-card"><span className="stat-symbol orange"><Clock3 size={19} /></span><strong>{retard.length}</strong><small>En retard</small></div></div>
          <button className="new-cta" disabled={!profilActif && !manager} onClick={() => { setMessage(""); setCreation(true); }}><span><CirclePlus size={22} /> Nouveau prospect</span><ArrowRight size={19} /></button>
          {!profilActif && !manager && <div className="warning">Votre profil commercial doit être lié par un responsable avant toute nouvelle saisie.</div>}
          <div className="section-heading"><div><p className="eyebrow">VOS PRIORITÉS</p><h2>À faire</h2></div><button onClick={() => setVue("agenda")}>Tout voir <ArrowRight size={16} /></button></div>
          {[...retard, ...duJour, ...prochaines].slice(0, 3).map(carteTache)}
          {taches.length === 0 && <div className="empty"><CalendarDays size={26} /><strong>Programme à jour</strong><p>Vos prochaines actions apparaîtront ici.</p></div>}
        </>}
        {vue === "dossiers" && <>
          {manager && <div className="dossier-mode-switch" role="group" aria-label="Mode des dossiers"><button type="button" className={!gestionAvancee ? "active" : ""} aria-pressed={!gestionAvancee} onClick={() => setGestionAvancee(false)}>Vue rapide</button><button type="button" className={gestionAvancee ? "active" : ""} aria-pressed={gestionAvancee} onClick={() => { setAgentGestion(""); setGestionAvancee(true); }}>Gestion avancée</button></div>}
          {manager && gestionAvancee ? <ManagerWorkspace mode="prospects" initialAgent={agentGestion} agentsDisponibles={agentsTous} client={client} organisationId={session.user.organisationId} refreshKey={managerRefreshKey} localites={localites} onCreate={() => { setMessage(""); setCreation(true); }} onTeamChanged={() => setManagerRefreshKey((value) => value + 1)} /> : <>
          <div className="page-title"><p className="eyebrow">{manager ? "PORTEFEUILLE DE L’ÉQUIPE" : "VOTRE PORTEFEUILLE"}</p><h1>Les dossiers <span>{dossiers.length}{dossiersSuivants ? "+" : ""}</span></h1><p>Retrouvez vite un contact et poursuivez le suivi.</p></div>
          <div className="search-field"><Search size={18} /><input value={recherche} onChange={(event) => setRecherche(event.target.value)} placeholder="Nom, téléphone, commune…" aria-label="Rechercher un dossier" /></div>
          <div className="desktop-dossier-filters"><button ref={boutonFiltresRef} type="button" className="desktop-filter-trigger" aria-haspopup="dialog" aria-expanded={filtresOuverts} onClick={ouvrirFiltres}><SlidersHorizontal size={17} /> Filtres {nombreFiltresDesktop > 0 && <em>{nombreFiltresDesktop}</em>}<ChevronDown size={16} /></button><button ref={boutonFiltresMobileRef} type="button" className="mobile-filter-trigger" aria-haspopup="dialog" aria-expanded={filtresOuverts} onClick={ouvrirFiltres}><SlidersHorizontal size={17} /> Filtres {nombreFiltresDesktop > 0 && <em>{nombreFiltresDesktop}</em>}<ChevronDown size={16} /></button>{filtresOuverts && <div className="desktop-filter-backdrop" onClick={fermerFiltres}><section className="desktop-filter-dialog" role="dialog" aria-modal="true" aria-labelledby="dossier-filters-title" onClick={(event) => event.stopPropagation()}><div className="desktop-filter-dialog-head"><div><p className="eyebrow">AFFINER LA LISTE</p><h2 id="dossier-filters-title">Filtrer les dossiers</h2><span>{apercuFiltresDesktop} résultat{apercuFiltresDesktop > 1 ? "s" : ""} correspondant{apercuFiltresDesktop > 1 ? "s" : ""}</span></div><button type="button" onClick={fermerFiltres} aria-label="Fermer les filtres"><X size={19} /></button></div><div className="desktop-filter-grid">
            <label>Étape<select autoFocus value={brouillonFiltres.etape} onChange={(event) => modifierFiltreDesktop("etape", event.target.value)}><option value="">Toutes les étapes</option>{etapes.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
            <label>Service<select value={brouillonFiltres.service} onChange={(event) => modifierFiltreDesktop("service", event.target.value)}><option value="">Tous les services</option>{services.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
            <label>Source<select value={brouillonFiltres.source} onChange={(event) => modifierFiltreDesktop("source", event.target.value)}><option value="">Toutes les sources</option><option value="manuel">Saisie manuelle</option>{sources.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
            <label>Température<select value={brouillonFiltres.temperature} onChange={(event) => modifierFiltreDesktop("temperature", event.target.value)}><option value="">Toutes</option><option value="chaud">Chaud</option><option value="tiede">Tiède</option><option value="froid">Froid</option><option value="sans_temperature">Non qualifié</option></select></label>
            <label>Commune ou localité<select value={brouillonFiltres.localite} onChange={(event) => modifierFiltreDesktop("localite", event.target.value)}><option value="">Toutes les localités</option><option value="sans_localite">Non sélectionnée</option>{localites.map((item) => <option key={item.id} value={item.id}>{item.nom}</option>)}</select></label>
            {manager && <label>Agent<select value={brouillonFiltres.agent} onChange={(event) => modifierFiltreDesktop("agent", event.target.value)}><option value="">Tous les agents</option><option value="sans_agent">Non attribué</option>{agentsTous.map((item) => <option key={item.user_id} value={item.user_id}>{item.nom}{item.actif ? "" : " (inactif)"}</option>)}</select></label>}
            <label>Créé depuis<input type="date" value={brouillonFiltres.debut} max={brouillonFiltres.fin || undefined} onChange={(event) => modifierFiltreDesktop("debut", event.target.value)} /></label>
            <label>Créé jusqu’au<input type="date" value={brouillonFiltres.fin} min={brouillonFiltres.debut || undefined} onChange={(event) => modifierFiltreDesktop("fin", event.target.value)} /></label>
          </div><div className="desktop-filter-dialog-footer"><button type="button" className="desktop-filter-reset" onClick={() => setBrouillonFiltres(filtresDesktopVides)}>Réinitialiser</button><div><button type="button" className="desktop-filter-cancel" onClick={fermerFiltres}>Annuler</button><button type="button" className="desktop-filter-apply" disabled={!!brouillonFiltres.debut && !!brouillonFiltres.fin && brouillonFiltres.debut > brouillonFiltres.fin} onClick={() => { setFiltresDesktop(brouillonFiltres); fermerFiltres(); }}>Afficher {apercuFiltresDesktop} dossier{apercuFiltresDesktop > 1 ? "s" : ""}</button></div></div></section></div>}</div>
          {desktopLayout ? <DesktopDossierTable dossiers={dossiersVisiblesDesktop} contacts={contactParId} localites={localiteParId} agents={agentParId} manager={manager} onOpen={setSelection} />
            : <div className="dossier-list">{dossiersVisibles.map((dossier) => { const contact = contactParId.get(dossier.contact_id); const commune = dossier.localite_id ? localiteParId.get(dossier.localite_id)?.nom : contact?.localisation; return <button className="dossier-card" key={dossier.id} onClick={() => setSelection(dossier.id)}><span className="avatar">{(contact?.nom ?? "?").slice(0, 1).toUpperCase()}</span><span className="dossier-main"><strong>{contact?.nom ?? "Contact"}</strong><span>{(dossier.services ?? [dossier.service]).map((service) => label(services, service)).join(" · ")}</span><small><MapPin size={12} /> {commune || "Commune à préciser"}</small></span><span className="dossier-right"><span className="stage" data-stage={dossier.etape}>{label(etapes, dossier.etape)}</span><ChevronRight size={18} /></span></button>; })}</div>}
          {dossiersVisibles.length === 0 && <div className="empty mobile-dossier-empty"><Users size={26} /><strong>Aucun dossier trouvé</strong><p>{dossiersSuivants ? "Chargez les dossiers suivants pour poursuivre la recherche." : "Changez de filtre ou ajoutez un prospect."}</p></div>}
          {dossiersSuivants && <div className="dossier-load-more"><span>La recherche porte sur les {dossiers.length} dossiers chargés.</span><button type="button" disabled={chargementSuite} onClick={() => void chargerSuiteDossiers()}>{chargementSuite ? "Chargement…" : "Charger les dossiers suivants"}<ArrowRight size={16} /></button></div>}
          </>}
        </>}
        {vue === "agenda" && <><div className="page-title"><p className="eyebrow">LE BON MOMENT</p><h1>Mon agenda</h1><p>{taches.length} action{taches.length > 1 ? "s" : ""} à suivre, classées par priorité.</p></div>{[
          { title: "En retard", items: retard, tone: "late" },
          { title: "Aujourd’hui", items: duJour, tone: "today" },
          { title: "À venir", items: prochaines, tone: "future" },
        ].map((group) => <section className="agenda-group" key={group.title}><h2><span className={`group-dot ${group.tone}`} />{group.title}<small>{group.items.length}</small></h2>{group.items.length ? group.items.map(carteTache) : <p className="group-empty">Aucune action</p>}</section>)}</>}
        {vue === "pilotage" && manager && <ManagerWorkspace mode="performance" client={client} organisationId={session.user.organisationId} refreshKey={managerRefreshKey} localites={localites} onCreate={() => { setMessage(""); setCreation(true); }} onTeamChanged={() => setManagerRefreshKey((value) => value + 1)} onOpenAgentDossiers={(agentId) => { setAgentGestion(agentId); setGestionAvancee(true); setVue("dossiers"); }} />}
        {vue === "compte" && <><div className="page-title"><p className="eyebrow">VOTRE ESPACE</p><h1>Mon compte</h1></div><div className="account-card"><div className="account-avatar">{(session.user.name ?? "C").slice(0, 1).toUpperCase()}</div><strong>{session.user.name}</strong><span>Équipe commerciale Trabad</span><div className="account-status"><span>● En ligne</span><span>{profilActif ? "Profil actif" : "Profil non lié"}</span></div></div>{manager && <button className="manager-link" onClick={() => setVue("localites")}><span className="manager-icon"><MapPinned size={20} /></span><span><strong>Communes & localités</strong><small>Ajouter, activer ou désactiver des lieux</small></span><ChevronRight size={19} /></button>}<div className="account-note"><Compass size={20} /><p>Cette application fonctionne en ligne. Le GPS n’est ajouté qu’avec l’autorisation de votre appareil.</p></div><button className="logout" onClick={() => void signOut({ callbackUrl: "/connexion" })}><LogOut size={18} /> Se déconnecter</button></>}
        {vue === "localites" && manager && <ManagerLocalities client={client} organisationId={session.user.organisationId} localites={localites} reload={() => charger(false, "localites")} onBack={() => setVue("compte")} />}
      </>}
    </main>
    {(profilActif || manager) && (vue === "dossiers" || vue === "agenda") && <button className="fab" onClick={() => { setMessage(""); setCreation(true); }} aria-label="Nouveau prospect"><CirclePlus size={26} /></button>}
    <nav className={`bottom-nav ${manager ? "manager-nav" : ""}`} aria-label="Navigation principale">{navigation.map(([key, Icon, title]) => <button key={key} className={vue === key || key === "compte" && vue === "localites" ? "active" : ""} onClick={() => { setVue(key); setSelection(null); }}><Icon size={21} /><span>{title}</span></button>)}</nav>

    {selection && dossierActif && <div className="sheet-backdrop" onClick={() => setSelection(null)}><section className="sheet" role="dialog" aria-modal="true" aria-label="Détail du dossier" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-head"><button className="icon-button" onClick={() => setSelection(null)} aria-label="Retour"><ArrowLeft size={20} /></button><span>DÉTAIL DU DOSSIER</span><button className="icon-button" onClick={() => setSelection(null)} aria-label="Fermer"><X size={20} /></button></div><div className="sheet-body">
      {message && <div className="toast" role="status">{message}</div>}
      <div className="detail-avatar">{(contactActif?.nom ?? "?").slice(0, 1).toUpperCase()}</div><h2>{contactActif?.nom ?? "Contact"}</h2><p>{(dossierActif.services ?? [dossierActif.service]).map((service) => label(services, service)).join(" · ")}</p>
      <div className="detail-chips"><span className="stage" data-stage={dossierActif.etape}>{label(etapes, dossierActif.etape)}</span>{dossierActif.localite_id && <span className="place-chip"><MapPin size={13} /> {localiteParId.get(dossierActif.localite_id)?.nom ?? contactActif?.localisation}</span>}</div>
      <div className="detail-block"><small>QUALIFICATION</small><p>Source : {label(sources, dossierActif.source)} · Température : {label([["froid", "Froid"], ["tiede", "Tiède"], ["chaud", "Chaud"]], dossierActif.temperature ?? "À qualifier")}</p></div>
      {contactActif?.telephone && <a className="call-button" href={`tel:${contactActif.telephone}`}><Phone size={18} /> Appeler {contactActif.telephone}</a>}
      {dossierActif.besoin && <div className="detail-block"><small>BESOIN EXPRIMÉ</small><p>{dossierActif.besoin}</p></div>}
      {(dossierActif.type_bien || dossierActif.adresse_bien) && <div className="detail-block"><small>BIEN CONCERNÉ</small><p>{[dossierActif.type_bien, dossierActif.adresse_bien].filter(Boolean).join(" · ")}</p></div>}
      <div className="detail-block"><small>POSITION GPS</small>{dossierActif.gps_latitude !== null && dossierActif.gps_longitude !== null ? <p><a className="map-link" href={`https://www.google.com/maps?q=${dossierActif.gps_latitude},${dossierActif.gps_longitude}`} target="_blank" rel="noopener noreferrer"><MapPinned size={16} /> Ouvrir sur la carte ↗</a></p> : <p>Non renseignée</p>}<button className="text-action" onClick={() => ajouterGps(dossierActif)}><Crosshair size={15} /> {dossierActif.gps_latitude === null ? "Ajouter ma position" : "Actualiser la position"}</button></div>
      <label className="field">Étape du dossier<select value={dossierActif.etape} disabled={busy} onChange={(event) => { const etape = event.target.value; void executer(() => client.from("crm_opportunites").update({ etape }).eq("id", dossierActif.id), "Étape mise à jour.", "none").then((success) => { if (success) setDossiers((courants) => courants.map((item) => item.id === dossierActif.id ? { ...item, etape } : item)); }); }}>{etapes.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <div className="detail-block"><small>HISTORIQUE DU SUIVI</small>{historique.length ? historique.map((item) => <p key={item.id}><strong>{dateTime(item.effectuee_at)} · {item.type_activite}</strong><br />{item.resultat || "Compte rendu"}{item.decision && ` · ${item.decision === "programmer" ? "prochaine action programmée" : item.decision === "archiver" ? "dossier archivé" : `classé ${label(etapes, item.etape_classee ?? "")}`}`}{item.notes && <><br />{item.notes}</>}</p>) : <p>Aucun échange enregistré.</p>}</div>
      <h3>Programmer une action</h3>{dossierActif.owner_id ? <form className="new-form" onSubmit={(event) => { event.preventDefault(); const formElement = event.currentTarget; const form = new FormData(formElement); void executer(() => client.from("crm_taches").insert({ organisation_id: session.user.organisationId, opportunite_id: dossierActif.id, responsable_id: dossierActif.owner_id, createur_id: session.user.id, titre: String(form.get("titre")), echeance_at: new Date(`${form.get("echeance")}:00Z`).toISOString() }), "Action programmée.", "taches").then((success) => { if (success) formElement.reset(); }); }}><label className="field">Action<select name="titre" defaultValue="Rappeler">{actions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="field">Date et heure (Abidjan)<input name="echeance" type="datetime-local" defaultValue={nextReminder()} required /></label><button className="primary-button" disabled={busy}>Ajouter au programme <ArrowRight size={17} /></button></form> : <p className="field-help">Attribuez d’abord ce dossier à un commercial depuis Loc Manager.</p>}
    </div></section></div>}

    {completion && <div className="sheet-backdrop" onClick={() => setCompletion(null)}><section className="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Terminer l’action" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-head"><button className="icon-button" onClick={() => setCompletion(null)} aria-label="Retour"><ArrowLeft size={20} /></button><span>COMPTE RENDU</span><button className="icon-button" onClick={() => setCompletion(null)} aria-label="Fermer"><X size={20} /></button></div><div className="sheet-body"><h2>{completion.titre}</h2><p>Notez le résultat et choisissez la suite. Tout sera conservé dans l’historique.</p>{message && <div className="toast" role="status">{message}</div>}<form className="new-form" onSubmit={(event) => void terminerTache(event)}><label className="field">Type d’échange<select name="type"><option value="appel">Appel</option><option value="visite">Visite</option><option value="rendez_vous">Rendez-vous</option><option value="message">Message</option><option value="note">Note</option></select></label><label className="field">Résultat<input name="resultat" required autoFocus placeholder="Ex. rendez-vous confirmé" /></label><label className="field">Note complémentaire<textarea name="notes" rows={2} placeholder="Facultatif" /></label><label className="field">Suite à donner<select name="decision" value={completionDecision} onChange={(event) => setCompletionDecision(event.target.value)}><option value="programmer">Programmer la prochaine action</option><option value="archiver">Archiver le dossier</option><option value="classer">Classer le dossier</option></select></label>{completionDecision === "programmer" && <><label className="field">Prochaine action<select name="prochaine_action" required>{actions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label><label className="field">Date et heure<input name="echeance" type="datetime-local" defaultValue={nextReminder()} required /></label></>}{completionDecision === "classer" && <label className="field">Classer à l’étape<select name="etape">{etapes.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>}{completionDecision === "archiver" && <p className="field-help">Les autres actions ouvertes de ce dossier seront annulées.</p>}<button className="primary-button" disabled={busy}>Terminer l’action <Check size={18} /></button></form></div></section></div>}

    {creation && <div className="sheet-backdrop" onClick={() => setCreation(false)}><section className="sheet" role="dialog" aria-modal="true" aria-label="Nouveau prospect" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-head"><button className="icon-button" onClick={() => setCreation(false)} aria-label="Retour"><ArrowLeft size={20} /></button><span>NOUVEAU PROSPECT</span><button className="icon-button" onClick={() => setCreation(false)} aria-label="Fermer"><X size={20} /></button></div><div className="sheet-body"><ProspectForm contacts={contacts} localites={localites} busy={busy} message={message} onClose={() => setCreation(false)} onSave={creerDossier} onSearchContacts={chercherContacts} manager={manager} agents={agents} /></div></section></div>}
  </div>;
}
