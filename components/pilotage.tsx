"use client";

// Pilotage commercial « à la Odoo » : agents regroupables, synthèse sobre, actions à mener par priorité
// ou par chaleur, fenêtre de lecture d'un dossier. Tout est calculé ici à partir des tables lues sous RLS
// (un agent ne voit que ses dossiers ; un responsable voit l'équipe).
// Même fichier dans Loc Manager (components/commercial/pilotage.tsx) et Trabad Commercial
// (components/pilotage.tsx) : styles intégrés (préfixe pl-), aucune dépendance à Tailwind ni à shadcn.
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AlarmClock, ArrowDownRight, Hourglass, ArrowUpRight, Flame, Inbox, MapPin, Phone, PhoneCall,
  Snowflake, Sparkles, Sun, Trophy, UserRound, UsersRound, X,
} from "lucide-react";

type Dossier = {
  id: string; contact_id: string; owner_id: string | null; etape: string; temperature: string | null;
  source: string; created_at: string; cloture_at: string | null; archived_at: string | null;
};
type Tache = { id: string; opportunite_id: string; responsable_id: string; titre: string; echeance_at: string };
type Echange = { id: string; opportunite_id: string; auteur_id: string | null; type_activite: string; effectuee_at: string };
type Contact = { id: string; nom: string; telephone: string | null };
export type AgentPilotage = { user_id: string; nom: string; actif: boolean };

const ETAPES: Record<string, string> = {
  nouveau: "Nouveau", contacte: "Contact établi", rdv: "Rendez-vous", proposition: "Proposition",
  negociation: "Négociation", gagne: "Gagné", perdu: "Perdu", reporte: "Reporté",
};
const SOURCES: Record<string, string> = {
  manuel: "Saisie", terrain: "Terrain", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", ads: "Publicité",
  whatsapp: "WhatsApp", site: "Site web", recommandation: "Recommandation", appel: "Appel entrant", autre: "Autre",
};
const CHALEURS = [
  { cle: "chaud", libelle: "Chaud", Icone: Flame },
  { cle: "tiede", libelle: "Tiède", Icone: Sun },
  { cle: "froid", libelle: "Froid", Icone: Snowflake },
  { cle: "non_qualifie", libelle: "Non qualifié", Icone: Sparkles },
] as const;
const rangChaleur = (t: string | null) => ({ chaud: 0, tiede: 1, froid: 2 } as Record<string, number>)[t ?? ""] ?? 3;
const chaleurDe = (t: string | null) => CHALEURS.find((c) => c.cle === (t ?? "non_qualifie")) ?? CHALEURS[3];

const JOUR = 86_400_000;
const LIMITE = 10_000;
const PAR_COLONNE = 25;
/**
 * Dossiers « endormis » (idée de Pipedrive) : chaque étape a une durée normale sans contact.
 * Au-delà, le dossier s'endort. Le dernier contact est le dernier échange noté, ou la création du dossier.
 * Gagnés, perdus et reportés ne s'endorment pas. Règle partagée avec l'application terrain.
 */
export const DELAIS_ETAPE: Record<string, number> = { nouveau: 2, contacte: 7, rdv: 5, proposition: 7, negociation: 5 };
/** Recul pour retrouver le dernier échange : au-delà, on retient la création du dossier ou on le dit endormi. */
export const RECUL_CONTACTS_JOURS = 60;
export function joursEndormi(etape: string, dernierContact: string, maintenant: number): number | null {
  const delai = DELAIS_ETAPE[etape];
  if (!delai) return null;
  const jours = Math.floor((maintenant - Date.parse(dernierContact)) / 86_400_000);
  return jours > delai ? jours : null;
}
const actif = (d: Dossier) => !d.archived_at && d.etape !== "gagne" && d.etape !== "perdu";
const nombre = (n: number) => new Intl.NumberFormat("fr-FR").format(n);
const pourcent = (n: number) => new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 }).format(n);
const initiales = (nom: string) => nom.split(/\s+/).filter(Boolean).slice(0, 2).map((m) => m[0]).join("").toUpperCase() || "?";
const jourAbidjan = (date: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Abidjan", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);

/** « aujourd’hui à 14:30 », « hier », « dans 3 j », « il y a 5 j ». */
function quand(iso: string, maintenant: number) {
  const date = new Date(iso);
  const jours = Math.round((Date.parse(`${jourAbidjan(date)}T00:00:00Z`) - Date.parse(`${jourAbidjan(new Date(maintenant))}T00:00:00Z`)) / JOUR);
  const heure = new Intl.DateTimeFormat("fr-FR", { timeZone: "Africa/Abidjan", hour: "2-digit", minute: "2-digit" }).format(date);
  if (jours === 0) return `aujourd’hui ${heure}`;
  if (jours === -1) return "hier";
  if (jours === 1) return `demain ${heure}`;
  return jours < 0 ? `il y a ${-jours} j` : `dans ${jours} j`;
}

/** « aujourd’hui », « 7 derniers jours », « du 3 nov. au 9 nov. » : la période en mots, pour dire ce qui en dépend. */
function libellePeriode(debut: string, fin: string) {
  const jour = (iso: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "short" }).format(new Date(`${iso}T00:00:00Z`));
  const jours = Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / JOUR) + 1;
  if (fin === jourAbidjan(new Date())) return jours === 1 ? "aujourd’hui" : `${jours} derniers jours`;
  return debut === fin ? `le ${jour(debut)}` : `du ${jour(debut)} au ${jour(fin)}`;
}

async function toutesLesPages<T>(requete: (de: number, a: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const lignes: T[] = [];
  for (let page = 0; lignes.length < LIMITE; page += 1) {
    const { data, error } = await requete(page * 1000, page * 1000 + 999);
    if (error) throw new Error(error.message);
    lignes.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return lignes;
}

type Onglet = "priorite" | "chaleur";
const ACTIVITES: Record<string, string> = { appel: "Appel", visite: "Visite", rendez_vous: "Rendez-vous", message: "Message", note: "Note" };
const SERVICES: Record<string, string> = {
  gestion_locative: "Gestion locative", location: "Location", vente: "Vente", achat: "Achat", syndic: "Syndic", partenaire: "Partenaire",
};
type Fiche = {
  dossier: { besoin: string | null; type_bien: string | null; adresse_bien: string | null; notes: string | null; services: string[] | null; service: string } | null;
  contact: { telephone: string | null; localisation: string | null; role_contact: string | null } | null;
  echanges: { id: string; type_activite: string; resultat: string | null; notes: string | null; effectuee_at: string; auteur_id: string | null }[];
};

export function CommercialPilotage({ client, organisationId, debut, fin, agents, equipe, refreshKey }: {
  client: SupabaseClient; organisationId: string; debut: string; fin: string;
  agents: AgentPilotage[]; equipe: boolean; refreshKey: number;
}) {
  const [donnees, setDonnees] = useState<{ dossiers: Dossier[]; taches: Tache[]; echanges: Echange[]; recents: { opportunite_id: string; effectuee_at: string }[] } | null>(null);
  const [contacts, setContacts] = useState<Map<string, Contact>>(new Map());
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [choisis, setChoisis] = useState<string[]>([]);
  const [onglet, setOnglet] = useState<Onglet>("priorite");
  // Fenêtre de lecture d'un dossier ; fiches chargées à la demande et gardées.
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [fiches, setFiches] = useState<Map<string, Fiche | "erreur">>(new Map());
  const requete = useRef(0);
  const maintenant = useMemo(() => Date.now(), [donnees]);

  // Bornes : période choisie et période précédente de même durée (pour les évolutions).
  const bornes = useMemo(() => {
    const d = Date.parse(`${debut}T00:00:00Z`);
    const f = Date.parse(`${fin}T00:00:00Z`) + JOUR;
    return { debut: d, fin: f, debutPrec: d - (f - d) };
  }, [debut, fin]);

  useEffect(() => {
    const courante = ++requete.current;
    setChargement(true);
    setErreur("");
    const depuis = new Date(bornes.debutPrec).toISOString();
    const jusqua = new Date(bornes.fin).toISOString();
    void Promise.all([
      toutesLesPages<Dossier>((de, a) => client.from("crm_opportunites")
        .select("id,contact_id,owner_id,etape,temperature,source,created_at,cloture_at,archived_at")
        .eq("organisation_id", organisationId)
        .or(`and(archived_at.is.null,etape.not.in.(gagne,perdu)),created_at.gte."${depuis}",cloture_at.gte."${depuis}"`)
        .order("created_at", { ascending: false }).order("id").range(de, a)),
      toutesLesPages<Tache>((de, a) => client.from("crm_taches")
        .select("id,opportunite_id,responsable_id,titre,echeance_at")
        .eq("organisation_id", organisationId).eq("statut", "a_faire")
        .order("echeance_at").order("id").range(de, a)),
      toutesLesPages<Echange>((de, a) => client.from("crm_activites")
        .select("id,opportunite_id,auteur_id,type_activite,effectuee_at")
        .eq("organisation_id", organisationId).gte("effectuee_at", depuis).lt("effectuee_at", jusqua)
        .order("effectuee_at", { ascending: false }).order("id").range(de, a)),
      // Derniers contacts, quelle que soit la période : pour repérer les dossiers endormis.
      toutesLesPages<{ opportunite_id: string; effectuee_at: string }>((de, a) => client.from("crm_activites")
        .select("opportunite_id,effectuee_at")
        .eq("organisation_id", organisationId).gte("effectuee_at", new Date(Date.now() - RECUL_CONTACTS_JOURS * JOUR).toISOString())
        .order("effectuee_at", { ascending: false }).order("id").range(de, a)),
    ]).then(([dossiers, taches, echanges, recents]) => {
      if (courante === requete.current) setDonnees({ dossiers, taches, echanges, recents });
    }).catch((e: Error) => {
      if (courante === requete.current) setErreur(`Pilotage indisponible : ${e.message}`);
    }).finally(() => {
      if (courante === requete.current) setChargement(false);
    });
  }, [client, organisationId, bornes, refreshKey]);

  const nomAgent = useMemo(() => new Map(agents.map((a) => [a.user_id, a.nom])), [agents]);
  const selection = useMemo(() => new Set(choisis), [choisis]);
  const dans = (id: string | null) => !selection.size || (!!id && selection.has(id));
  const basculer = (id: string) => setChoisis((liste) => liste.includes(id) ? liste.filter((x) => x !== id) : [...liste, id]);

  // ── Tous les calculs, pour la sélection d'agents. ─────────────────────────────────────────────
  const vue = useMemo(() => {
    if (!donnees) return null;
    const { debut: d, fin: f, debutPrec: p } = bornes;
    const t = (iso: string | null) => (iso ? Date.parse(iso) : Number.NaN);
    const dossiers = donnees.dossiers.filter((x) => dans(x.owner_id));
    const taches = donnees.taches.filter((x) => dans(x.responsable_id));
    const echanges = donnees.echanges.filter((x) => dans(x.auteur_id));
    const dossierParId = new Map(donnees.dossiers.map((x) => [x.id, x]));
    const tachesOuvertes = new Map<string, Tache>(); // prochaine action de chaque dossier
    for (const tache of donnees.taches) if (!tachesOuvertes.has(tache.opportunite_id)) tachesOuvertes.set(tache.opportunite_id, tache);
    const dernierEchange = new Map<string, string>();
    for (const e of donnees.echanges) if (!dernierEchange.has(e.opportunite_id)) dernierEchange.set(e.opportunite_id, e.effectuee_at);
    const dernierContact = new Map<string, string>();
    for (const e of donnees.recents) if (!dernierContact.has(e.opportunite_id)) dernierContact.set(e.opportunite_id, e.effectuee_at);
    const endormis = new Map<string, number>();
    for (const x of donnees.dossiers) {
      if (!actif(x)) continue;
      const contact = dernierContact.get(x.id);
      const jours = joursEndormi(x.etape, contact && contact > x.created_at ? contact : x.created_at, maintenant);
      if (jours !== null) endormis.set(x.id, jours);
    }

    const periode = (iso: string | null) => t(iso) >= d && t(iso) < f;
    const precedente = (iso: string | null) => t(iso) >= p && t(iso) < d;
    const actions = echanges.filter((e) => periode(e.effectuee_at));
    const finJour = Date.parse(`${jourAbidjan(new Date(maintenant))}T00:00:00Z`) + JOUR;
    const retard = taches.filter((x) => t(x.echeance_at) < maintenant);
    const nouveaux = dossiers.filter((x) => periode(x.created_at));
    // Dossiers ayant eu au moins un échange depuis leur création (calculé une fois).
    const dejaContactes = new Set<string>();
    for (const e of donnees.echanges) {
      const dossier = dossierParId.get(e.opportunite_id);
      if (dossier && t(e.effectuee_at) >= t(dossier.created_at)) dejaContactes.add(dossier.id);
    }
    const contactes = (x: Dossier) => dejaContactes.has(x.id);
    const gagnes = dossiers.filter((x) => x.etape === "gagne" && periode(x.cloture_at)).length;
    const perdus = dossiers.filter((x) => x.etape === "perdu" && periode(x.cloture_at)).length;
    const actifs = dossiers.filter(actif);

    const indicateurs = {
      actions: actions.length,
      actionsPrec: echanges.filter((e) => precedente(e.effectuee_at)).length,
      retard: retard.length,
      nouveaux: nouveaux.length,
      nouveauxPrec: dossiers.filter((x) => precedente(x.created_at)).length,
      nonContactes: nouveaux.filter((x) => !contactes(x)).length,
      gagnes, perdus,
      gagnesPrec: dossiers.filter((x) => x.etape === "gagne" && precedente(x.cloture_at)).length,
      chauds: actifs.filter((x) => x.temperature === "chaud").length,
      sansAction: actifs.filter((x) => !tachesOuvertes.has(x.id)).length,
      actifs: actifs.length,
      repartition: CHALEURS.map((c) => ({ ...c, n: actifs.filter((x) => (x.temperature ?? "non_qualifie") === c.cle).length })),
      agents: new Set(actifs.map((x) => x.owner_id).filter(Boolean)).size,
      endormis: actifs.filter((x) => endormis.has(x.id)).length,
    };

    // Priorité : actions ouvertes par échéance ; dossiers actifs sans action à part.
    const triChaleur = (a: Tache, b: Tache) =>
      rangChaleur(dossierParId.get(a.opportunite_id)?.temperature ?? null) - rangChaleur(dossierParId.get(b.opportunite_id)?.temperature ?? null)
      || t(a.echeance_at) - t(b.echeance_at);
    const finSemaine = finJour + 6 * JOUR;
    const priorite = {
      retard: retard.sort(triChaleur),
      aujourdhui: taches.filter((x) => t(x.echeance_at) >= maintenant && t(x.echeance_at) < finJour).sort(triChaleur),
      semaine: taches.filter((x) => t(x.echeance_at) >= finJour && t(x.echeance_at) < finSemaine).sort(triChaleur),
      plusTard: taches.filter((x) => t(x.echeance_at) >= finSemaine).sort(triChaleur),
      sansAction: actifs.filter((x) => !tachesOuvertes.has(x.id))
        .sort((a, b) => rangChaleur(a.temperature) - rangChaleur(b.temperature) || t(b.created_at) - t(a.created_at)),
    };

    const parChaleur = Object.fromEntries(CHALEURS.map((c) => [c.cle, actifs
      .filter((x) => (x.temperature ?? "non_qualifie") === c.cle)
      // Sans action prévue d'abord (à reprendre), puis prochaine échéance la plus proche.
      .sort((a, b) => Number(tachesOuvertes.has(a.id)) - Number(tachesOuvertes.has(b.id))
        || (t(tachesOuvertes.get(a.id)?.echeance_at ?? null) || 0) - (t(tachesOuvertes.get(b.id)?.echeance_at ?? null) || 0))])) as Record<string, Dossier[]>;

    const listeNouveaux = nouveaux
      .map((x) => ({ dossier: x, contacte: contactes(x) }))
      .sort((a, b) => Number(a.contacte) - Number(b.contacte) || rangChaleur(a.dossier.temperature) - rangChaleur(b.dossier.temperature)
        || t(b.dossier.created_at) - t(a.dossier.created_at));

    // Tableau des agents (tous, même hors sélection : on coche pour regrouper).
    const lignes = agents.map((agent) => {
      const a = agent.user_id;
      const sesActions = donnees.echanges.filter((e) => e.auteur_id === a && periode(e.effectuee_at));
      const sesDossiers = donnees.dossiers.filter((x) => x.owner_id === a);
      const sesNouveaux = sesDossiers.filter((x) => periode(x.created_at));
      const g = sesDossiers.filter((x) => x.etape === "gagne" && periode(x.cloture_at)).length;
      const pe = sesDossiers.filter((x) => x.etape === "perdu" && periode(x.cloture_at)).length;
      const parType = (type: string) => sesActions.filter((e) => e.type_activite === type).length;
      return {
        agent, actions: sesActions.length, appels: parType("appel"), visites: parType("visite"), rdv: parType("rendez_vous"),
        messages: parType("message") + parType("note"),
        retard: donnees.taches.filter((x) => x.responsable_id === a && t(x.echeance_at) < maintenant).length,
        nouveaux: sesNouveaux.length, nonContactes: sesNouveaux.filter((x) => !contactes(x)).length,
        portefeuille: sesDossiers.filter(actif).length, chauds: sesDossiers.filter((x) => actif(x) && x.temperature === "chaud").length,
        gagnes: g, perdus: pe,
      };
    }).filter((l) => l.agent.actif || l.actions || l.portefeuille);

    return { indicateurs, priorite, parChaleur, listeNouveaux, lignes, tachesOuvertes, dernierEchange, dossierParId, endormis };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [donnees, bornes, selection, agents, maintenant]);

  // Noms des contacts : chargés seulement pour les cartes affichées.
  const idsAffiches = useMemo(() => {
    if (!vue) return [] as string[];
    const ids = new Set<string>();
    const ajouterDossier = (id: string) => { const c = vue.dossierParId.get(id)?.contact_id; if (c) ids.add(c); };
    if (onglet === "priorite") {
      vue.listeNouveaux.slice(0, PAR_COLONNE).forEach((x) => ids.add(x.dossier.contact_id));
      for (const liste of [vue.priorite.retard, vue.priorite.aujourdhui, vue.priorite.semaine, vue.priorite.plusTard]) liste.slice(0, PAR_COLONNE).forEach((x) => ajouterDossier(x.opportunite_id));
      vue.priorite.sansAction.slice(0, PAR_COLONNE).forEach((x) => ids.add(x.contact_id));
    } else if (onglet === "chaleur") {
      Object.values(vue.parChaleur).forEach((liste) => liste.slice(0, PAR_COLONNE).forEach((x) => ids.add(x.contact_id)));
    }
    return [...ids];
  }, [vue, onglet]);

  useEffect(() => {
    const manquants = idsAffiches.filter((id) => !contacts.has(id));
    if (!manquants.length) return;
    let annule = false;
    void (async () => {
      const trouves: Contact[] = [];
      for (let i = 0; i < manquants.length; i += 150) {
        const { data } = await client.from("crm_contacts").select("id,nom,telephone").in("id", manquants.slice(i, i + 150));
        trouves.push(...((data ?? []) as Contact[]));
      }
      if (!annule) setContacts((avant) => new Map([...avant, ...trouves.map((c) => [c.id, c] as const)]));
    })();
    return () => { annule = true; };
  }, [idsAffiches, client, contacts]);
  // Fiche d'un dossier : chargée à l'ouverture de la fenêtre.
  async function ouvrir(dossierId: string) {
    setOuvert(dossierId);
    if (fiches.get(dossierId) && fiches.get(dossierId) !== "erreur") return;
    const contactId = vue?.dossierParId.get(dossierId)?.contact_id;
    const [dossier, contact, echanges] = await Promise.all([
      client.from("crm_opportunites").select("besoin,type_bien,adresse_bien,notes,services,service").eq("id", dossierId).maybeSingle(),
      contactId ? client.from("crm_contacts").select("telephone,localisation,role_contact").eq("id", contactId).maybeSingle() : Promise.resolve({ data: null, error: null }),
      client.from("crm_activites").select("id,type_activite,resultat,notes,effectuee_at,auteur_id").eq("opportunite_id", dossierId)
        .order("effectuee_at", { ascending: false }).limit(5),
    ]);
    setFiches((avant) => new Map(avant).set(dossierId, dossier.error || echanges.error ? "erreur"
      : { dossier: dossier.data as Fiche["dossier"], contact: contact.data as Fiche["contact"], echanges: (echanges.data ?? []) as Fiche["echanges"] }));
  }

  if (erreur) return <div className="pl"><style>{styles}</style><p role="status" className="pl-avis">{erreur}</p></div>;
  if (chargement && !vue) return <div className="pl"><style>{styles}</style><div className="pl-squelettes">{Array.from({ length: 5 }, (_, i) => <span key={i} />)}</div></div>;
  if (!vue) return null;

  const { indicateurs: k } = vue;
  const nomContact = (dossierId: string) => contacts.get(vue.dossierParId.get(dossierId)?.contact_id ?? "")?.nom ?? "…";
  const libelleSelection = !selection.size ? (equipe ? "Toute l’équipe" : "Mes dossiers")
    : selection.size === 1 ? nomAgent.get(choisis[0]) ?? "1 agent" : `${selection.size} agents regroupés`;
  const taux = k.gagnes + k.perdus ? k.gagnes / (k.gagnes + k.perdus) : null;
  const agentDe = (id: string | null) => (id ? nomAgent.get(id) : "Non attribué");
  const dossierOuvert = ouvert ? vue.dossierParId.get(ouvert) : undefined;
  const periode = libellePeriode(debut, fin);

  const carteAction = (x: Tache, retard = false) => <Carte key={x.id} contact={nomContact(x.opportunite_id)} dossier={vue.dossierParId.get(x.opportunite_id)}
    titre={x.titre} ligne={quand(x.echeance_at, maintenant)} alerte={retard} agent={nomAgent.get(x.responsable_id)} endormi={vue.endormis.get(x.opportunite_id)} onOuvrir={() => void ouvrir(x.opportunite_id)} />;
  const carteDossier = (x: Dossier, ligne: string, alerte: boolean) => <Carte key={x.id} contact={contacts.get(x.contact_id)?.nom ?? "…"} dossier={x}
    ligne={ligne} alerte={alerte} agent={agentDe(x.owner_id)} endormi={vue.endormis.get(x.id)} onOuvrir={() => void ouvrir(x.id)} />;

  return <section className={`pl${chargement ? " pl-occupe" : ""}`} aria-busy={chargement}>
    <style>{styles}</style>

    {/* Sélection d'agents : on coche, les chiffres se regroupent. */}
    {equipe && agents.length > 1 && <div className="pl-agents" role="group" aria-label="Agents">
      <button type="button" onClick={() => setChoisis([])} aria-pressed={!selection.size} className={`pl-puce${!selection.size ? " pl-puce-equipe" : ""}`}>Toute l’équipe</button>
      {agents.filter((a) => a.actif || selection.has(a.user_id)).map((a) => {
        const on = selection.has(a.user_id);
        return <button key={a.user_id} type="button" onClick={() => basculer(a.user_id)} aria-pressed={on} className={`pl-puce${on ? " pl-puce-on" : ""}`}>
          <span className="pl-initiales">{initiales(a.nom)}</span>{a.nom}{on && <X size={12} />}
        </button>;
      })}
    </div>}

    {/* Synthèse : le portefeuille en un chiffre et une barre, puis 4 chiffres d'activité. */}
    <div className="pl-synthese">
      <div className="pl-bloc pl-portefeuille">
        <p className="pl-surtitre"><UsersRound size={14} /> {libelleSelection}<span className="pl-portee">à ce jour</span></p>
        <p className="pl-portefeuille-total"><strong>{nombre(k.actifs)}</strong> dossier{k.actifs > 1 ? "s" : ""} en cours{equipe && k.agents > 1 ? <span> · {k.agents} agents</span> : null}</p>
        <div className="pl-barre" aria-hidden="true">{k.repartition.filter((r) => r.n).map((r) => <span key={r.cle} className={`pl-c-${r.cle}`} style={{ width: `${(r.n / Math.max(1, k.actifs)) * 100}%` }} />)}</div>
        <ul className="pl-legende">{k.repartition.map((r) => <li key={r.cle}><span className={`pl-point pl-c-${r.cle}`} />{r.libelle} <strong>{nombre(r.n)}</strong></li>)}</ul>
        <p className={`pl-endormis${k.endormis ? "" : " pl-vert"}`} title="Sans contact depuis plus longtemps que la durée normale de leur étape (Nouveau 2 j, Contact établi 7 j, Rendez-vous 5 j, Proposition 7 j, Négociation 5 j)">
          <Hourglass size={13} />{k.endormis ? `${nombre(k.endormis)} dossier${k.endormis > 1 ? "s" : ""} endormi${k.endormis > 1 ? "s" : ""} : sans contact depuis trop longtemps` : "Aucun dossier endormi"}
        </p>
      </div>
      <div className="pl-tuiles">
        <Tuile titre="Actions faites" portee={periode} valeur={k.actions} precedent={k.actionsPrec} Icone={PhoneCall} aide="Appels, visites, rendez-vous, messages sur la période" />
        <Tuile titre="En retard" portee="à ce jour" valeur={k.retard} Icone={AlarmClock} alerte={k.retard > 0} aide="Actions dont l’échéance est passée, quelle que soit la période"  sous={k.retard ? "à traiter en premier" : "rien en retard"} sousTon={k.retard ? undefined : "ok"} />
        <Tuile titre="Nouveaux" portee={periode} aide="Dossiers créés sur la période" valeur={k.nouveaux} precedent={k.nouveauxPrec} Icone={Inbox}
          sous={k.nonContactes ? `${k.nonContactes} à contacter` : k.nouveaux ? "tous contactés" : undefined} sousTon={k.nonContactes ? "alerte" : "ok"} />
        <Tuile titre="Gagnés" portee={periode} aide="Dossiers gagnés sur la période" valeur={k.gagnes} precedent={k.gagnesPrec} Icone={Trophy} sous={taux === null ? "aucun dossier clos" : `${pourcent(taux)} de réussite`} />
      </div>
    </div>

    {/* Actions à mener : une carte = un dossier ; la toucher ouvre sa fiche. */}
    <div className="pl-bloc pl-tableau">
      <div className="pl-tableau-tete">
        <div><h3>À mener <span className="pl-portee">à ce jour</span></h3><p>Le travail en cours, toutes dates confondues ; seule la colonne Nouveaux suit la période. Touchez une carte pour lire le dossier.</p></div>
        <div className="pl-onglets" role="tablist">
          {([["priorite", "Par priorité"], ["chaleur", "Par chaleur"]] as const).map(([cle, titre]) =>
            <button key={cle} type="button" role="tab" aria-selected={onglet === cle} onClick={() => setOnglet(cle)}>{titre}</button>)}
        </div>
      </div>
      {onglet === "priorite" ? <div className="pl-colonnes">
        <Colonne titre="Nouveaux" portee={periode} nombre={vue.listeNouveaux.length} ton="teal" vide="Aucun nouveau dossier sur la période">
          {vue.listeNouveaux.slice(0, PAR_COLONNE).map(({ dossier: x, contacte }) => carteDossier(x, `${contacte ? "Contacté" : "Pas encore contacté"} · créé ${quand(x.created_at, maintenant)}`, !contacte))}
        </Colonne>
        <Colonne titre="En retard" nombre={vue.priorite.retard.length} ton="rose" vide="Aucune action en retard 👍">{vue.priorite.retard.slice(0, PAR_COLONNE).map((x) => carteAction(x, true))}</Colonne>
        <Colonne titre="Aujourd’hui" nombre={vue.priorite.aujourdhui.length} ton="ambre" vide="Rien de prévu aujourd’hui">{vue.priorite.aujourdhui.slice(0, PAR_COLONNE).map((x) => carteAction(x))}</Colonne>
        <Colonne titre="7 prochains jours" nombre={vue.priorite.semaine.length} ton="ciel" vide="Rien de prévu cette semaine">{vue.priorite.semaine.slice(0, PAR_COLONNE).map((x) => carteAction(x))}</Colonne>
        <Colonne titre="Plus tard" nombre={vue.priorite.plusTard.length} ton="gris" vide="Rien de prévu plus tard">{vue.priorite.plusTard.slice(0, PAR_COLONNE).map((x) => carteAction(x))}</Colonne>
        <Colonne titre="Sans suite" nombre={vue.priorite.sansAction.length} ton="violet" vide="Chaque dossier a sa prochaine action 👍">
          {vue.priorite.sansAction.slice(0, PAR_COLONNE).map((x) => carteDossier(x, vue.dernierEchange.get(x.id) ? `Dernier échange ${quand(vue.dernierEchange.get(x.id)!, maintenant)}` : "Aucune action prévue", true))}
        </Colonne>
      </div> : <div className="pl-colonnes">
        {CHALEURS.map((c) => <Colonne key={c.cle} titre={c.libelle} nombre={vue.parChaleur[c.cle]?.length ?? 0} ton={c.cle} vide="Aucun dossier">
          {(vue.parChaleur[c.cle] ?? []).slice(0, PAR_COLONNE).map((x) => {
            const prochaine = vue.tachesOuvertes.get(x.id);
            return carteDossier(x, prochaine ? `${prochaine.titre} · ${quand(prochaine.echeance_at, maintenant)}` : "Aucune action prévue", !prochaine || Date.parse(prochaine.echeance_at) < maintenant);
          })}
        </Colonne>)}
      </div>}
    </div>

    {equipe && vue.lignes.length > 0 && <TableauAgents lignes={vue.lignes} selection={selection} basculer={basculer} />}

    {ouvert && <FenetreDossier dossier={dossierOuvert} contact={contacts.get(dossierOuvert?.contact_id ?? "")?.nom ?? "Dossier"}
      agent={agentDe(dossierOuvert?.owner_id ?? null)} fiche={fiches.get(ouvert)} prochaine={vue.tachesOuvertes.get(ouvert)}
      nomAgent={nomAgent} maintenant={maintenant} endormi={vue.endormis.get(ouvert)} onFermer={() => setOuvert(null)} onReessayer={() => void ouvrir(ouvert)} />}
  </section>;
}

function Tuile({ titre, portee, valeur, precedent, Icone, aide, sous, alerte = false, sousTon }: {
  titre: string; portee?: string; valeur: number; precedent?: number; Icone: typeof Flame; aide?: string; sous?: string; alerte?: boolean; sousTon?: "alerte" | "ok";
}) {
  const evolution = precedent === undefined ? 0 : valeur - precedent;
  return <div className="pl-bloc pl-tuile" title={aide}>
    <p className="pl-tuile-titre"><span>{titre}</span><Icone size={15} /></p>
    {portee && <p className="pl-tuile-portee">{portee}</p>}
    <p className={`pl-tuile-valeur${alerte ? " pl-rouge" : ""}`}>{nombre(valeur)}
      {evolution !== 0 && <span className={evolution > 0 ? "pl-hausse" : "pl-baisse"} title="Par rapport à la période précédente de même durée">
        {evolution > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{evolution > 0 ? "+" : ""}{nombre(evolution)}</span>}
    </p>
    {sous && <p className={`pl-tuile-sous${sousTon === "alerte" ? " pl-rouge" : sousTon === "ok" ? " pl-vert" : ""}`}>{sous}</p>}
  </div>;
}

function Colonne({ titre, portee, nombre: n, ton, vide, children }: { titre: string; portee?: string; nombre: number; ton: string; vide: string; children: React.ReactNode }) {
  return <div className={`pl-colonne pl-t-${ton}`}>
    <div className="pl-colonne-tete"><h4>{titre}{portee && <small>{portee}</small>}</h4><span>{nombre(n)}</span></div>
    <div className="pl-colonne-corps">
      {n === 0 ? <p className="pl-vide">{vide}</p> : children}
      {n > PAR_COLONNE && <p className="pl-plus">+ {nombre(n - PAR_COLONNE)} autres</p>}
    </div>
  </div>;
}

function Initiales({ nom }: { nom?: string }) {
  return <span className="pl-agent" title={nom}><span className="pl-initiales">{nom ? initiales(nom) : <UserRound size={11} />}</span><span>{nom ?? "Agent"}</span></span>;
}

function Pastille({ temperature }: { temperature: string | null }) {
  const c = chaleurDe(temperature);
  return <span className={`pl-pastille pl-p-${c.cle}`}><c.Icone size={11} />{c.libelle}</span>;
}

function Carte({ contact, dossier, titre, ligne, alerte, agent, endormi, onOuvrir }: {
  contact: string; dossier?: Dossier; titre?: string; ligne: string; alerte: boolean; agent?: string; endormi?: number; onOuvrir: () => void;
}) {
  return <button type="button" className={`pl-carte${endormi ? " pl-carte-endormie" : ""}`} onClick={onOuvrir} aria-haspopup="dialog">
    <span className="pl-carte-haut"><strong>{contact}</strong><Pastille temperature={dossier?.temperature ?? null} /></span>
    {titre && <span className="pl-carte-titre">{titre}</span>}
    <span className={`pl-carte-ligne${alerte ? " pl-rouge" : ""}`}>{ligne}</span>
    {endormi && <span className="pl-endormi" title="Sans contact depuis plus longtemps que la durée normale de cette étape"><Hourglass size={11} />Endormi · {endormi} j sans contact</span>}
    <span className="pl-carte-bas"><span>{dossier ? ETAPES[dossier.etape] ?? dossier.etape : ""}</span><Initiales nom={agent} /></span>
  </button>;
}

/** Fenêtre de lecture d'un dossier : panneau à droite sur grand écran, feuille du bas sur téléphone. */
/** Les échanges importés du tableur gardent la ligne brute (JSON) : on affiche seulement sa provenance. */
function texteEchange(notes: string | null | undefined) {
  const texte = notes?.trim();
  if (!texte || !texte.startsWith("{")) return texte || "";
  try {
    const brut = JSON.parse(texte) as { sheet?: unknown; row?: unknown };
    if (brut && typeof brut === "object" && ("sheet" in brut || "row" in brut)) {
      return `Importé du tableur${brut.sheet ? ` « ${String(brut.sheet)} »` : ""}${brut.row ? `, ligne ${String(brut.row)}` : ""}.`;
    }
  } catch { /* texte ordinaire */ }
  return texte;
}

function FenetreDossier({ dossier, contact, agent, fiche, prochaine, nomAgent, maintenant, endormi, onFermer, onReessayer }: {
  dossier?: Dossier; contact: string; agent?: string; fiche?: Fiche | "erreur"; prochaine?: Tache;
  nomAgent: Map<string, string>; maintenant: number; endormi?: number; onFermer: () => void; onReessayer: () => void;
}) {
  const fermerRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const precedent = document.activeElement as HTMLElement | null;
    fermerRef.current?.focus();
    const debordement = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const echap = (e: KeyboardEvent) => { if (e.key === "Escape") onFermer(); };
    document.addEventListener("keydown", echap);
    return () => { document.removeEventListener("keydown", echap); document.body.style.overflow = debordement; precedent?.focus?.(); };
  }, [onFermer]);

  const d = fiche && fiche !== "erreur" ? fiche.dossier : null;
  const services = (d?.services?.length ? d.services : d?.service ? [d.service] : []).map((s) => SERVICES[s] ?? s).join(" · ");
  const bien = [d?.type_bien, d?.adresse_bien].filter(Boolean).join(" · ");
  const telephone = fiche && fiche !== "erreur" ? fiche.contact?.telephone : null;

  return <div className="pl-fond" onClick={onFermer}>
    <section className="pl-fenetre" role="dialog" aria-modal="true" aria-labelledby="pl-fenetre-titre" onClick={(e) => e.stopPropagation()}>
      <header className="pl-fenetre-tete">
        <div>
          <h3 id="pl-fenetre-titre">{contact}</h3>
          <p>{dossier && <Pastille temperature={dossier.temperature} />}{dossier && <span>{ETAPES[dossier.etape] ?? dossier.etape}</span>}<Initiales nom={agent} /></p>
          {endormi && <p className="pl-endormi"><Hourglass size={12} />Endormi · {endormi} j sans contact</p>}
        </div>
        <button ref={fermerRef} type="button" className="pl-fermer" onClick={onFermer} aria-label="Fermer"><X size={18} /></button>
      </header>
      <div className="pl-fenetre-corps">
        <div className={`pl-prochaine${prochaine ? "" : " pl-prochaine-vide"}`}>
          <small>Prochaine action</small>
          <strong>{prochaine ? prochaine.titre : "Aucune action prévue"}</strong>
          {prochaine && <span className={Date.parse(prochaine.echeance_at) < maintenant ? "pl-rouge" : ""}>{quand(prochaine.echeance_at, maintenant)}</span>}
        </div>
        {telephone && <a className="pl-appeler" href={`tel:${telephone}`}><Phone size={16} /> Appeler {telephone}</a>}

        {!fiche ? <p className="pl-chargement">Chargement du dossier…</p>
          : fiche === "erreur" ? <p className="pl-avis">Dossier illisible pour l’instant. <button type="button" onClick={onReessayer}>Réessayer</button></p>
            : <>
              <dl className="pl-infos">
                {services && <Info titre="Service" valeur={services} />}
                {dossier && <Info titre="Source" valeur={`${SOURCES[dossier.source] ?? dossier.source} · créé ${quand(dossier.created_at, maintenant)}`} />}
                {d?.besoin && <Info titre="Besoin" valeur={d.besoin} />}
                {bien && <Info titre="Bien" valeur={bien} />}
                {fiche.contact?.localisation && <Info titre="Commune" valeur={fiche.contact.localisation} icone />}
                {d?.notes && <Info titre="Notes" valeur={d.notes} />}
              </dl>
              <h4 className="pl-intertitre">Derniers échanges</h4>
              {fiche.echanges.length === 0 ? <p className="pl-vide">Aucun échange enregistré.</p>
                : <ol className="pl-echanges">{fiche.echanges.map((e) => <li key={e.id}>
                  <p><strong>{ACTIVITES[e.type_activite] ?? e.type_activite}</strong> · {quand(e.effectuee_at, maintenant)}{e.auteur_id && nomAgent.get(e.auteur_id) ? ` · ${nomAgent.get(e.auteur_id)}` : ""}</p>
                  {(e.resultat || e.notes) && <p className="pl-echange-texte">{[e.resultat, texteEchange(e.notes)].filter(Boolean).join(" — ")}</p>}
                </li>)}</ol>}
            </>}
      </div>
    </section>
  </div>;
}

function Info({ titre, valeur, icone = false }: { titre: string; valeur: string; icone?: boolean }) {
  return <div><dt>{titre}</dt><dd>{icone && <MapPin size={12} />}{valeur}</dd></div>;
}

type LigneAgent = {
  agent: AgentPilotage; actions: number; appels: number; visites: number; rdv: number; messages: number; retard: number;
  nouveaux: number; nonContactes: number; portefeuille: number; chauds: number; gagnes: number; perdus: number;
};

/** Agents : 5 chiffres lisibles ; le détail (appels, visites…) en petit sous le chiffre principal. */
function TableauAgents({ lignes, selection, basculer }: { lignes: LigneAgent[]; selection: Set<string>; basculer: (id: string) => void }) {
  const triees = [...lignes].sort((a, b) => b.actions - a.actions || b.gagnes - a.gagnes || a.agent.nom.localeCompare(b.agent.nom, "fr"));
  const max = Math.max(1, ...triees.map((l) => l.actions));
  const choisies = triees.filter((l) => selection.has(l.agent.user_id));
  const somme = (cle: keyof Omit<LigneAgent, "agent">) => choisies.reduce((s, l) => s + l[cle], 0);
  const taux = (g: number, p: number) => g + p ? `${pourcent(g / (g + p))} de réussite` : "";
  const detail = (l: Pick<LigneAgent, "appels" | "visites" | "rdv" | "messages">) =>
    ([[l.appels, "appel", "appels"], [l.visites, "visite", "visites"], [l.rdv, "RDV", "RDV"], [l.messages, "message", "messages"]] as const)
      .filter(([n]) => n).map(([n, un, plusieurs]) => `${n} ${n > 1 ? plusieurs : un}`).join(" · ") || "—";

  return <div className="pl-bloc pl-equipe">
    <div className="pl-tableau-tete"><div><h3>Agents</h3><p>Cochez des agents pour regrouper leurs chiffres en haut de page.</p></div></div>
    <div className="pl-defile"><table>
      <thead><tr>
        <th className="pl-case"><span className="pl-sr">Regrouper</span></th><th>Agent</th><th>Actions faites</th>
        <th className="pl-droite">En cours</th><th className="pl-droite">Nouveaux</th><th className="pl-droite">En retard</th><th className="pl-droite">Gagnés</th>
      </tr></thead>
      <tbody>{triees.map((l) => {
        const on = selection.has(l.agent.user_id);
        return <tr key={l.agent.user_id} className={on ? "pl-ligne-on" : ""}>
          <td className="pl-case"><input type="checkbox" checked={on} onChange={() => basculer(l.agent.user_id)} aria-label={`Regrouper ${l.agent.nom}`} /></td>
          <th scope="row">{l.agent.nom}{!l.agent.actif && <small> inactif</small>}</th>
          <td><span className="pl-jauge"><span style={{ width: `${Math.max(l.actions ? 4 : 0, (l.actions / max) * 90)}px` }} /><strong>{nombre(l.actions)}</strong></span><small>{detail(l)}</small></td>
          <td className="pl-droite">{nombre(l.portefeuille)}{l.chauds > 0 && <small className="pl-rose">{l.chauds} chaud{l.chauds > 1 ? "s" : ""}</small>}</td>
          <td className="pl-droite">{nombre(l.nouveaux)}{l.nonContactes > 0 && <small className="pl-rouge">{l.nonContactes} à contacter</small>}</td>
          <td className={`pl-droite${l.retard ? " pl-rouge pl-gras" : " pl-pale"}`}>{nombre(l.retard)}</td>
          <td className="pl-droite"><span className={l.gagnes ? "pl-vert pl-gras" : "pl-pale"}>{nombre(l.gagnes)}</span>{taux(l.gagnes, l.perdus) && <small>{taux(l.gagnes, l.perdus)}</small>}</td>
        </tr>;
      })}</tbody>
      {choisies.length > 1 && <tfoot><tr>
        <td /><th scope="row">Total des {choisies.length} agents</th>
        <td><strong>{nombre(somme("actions"))}</strong><small>{detail({ appels: somme("appels"), visites: somme("visites"), rdv: somme("rdv"), messages: somme("messages") })}</small></td>
        <td className="pl-droite">{nombre(somme("portefeuille"))}</td><td className="pl-droite">{nombre(somme("nouveaux"))}</td>
        <td className="pl-droite">{nombre(somme("retard"))}</td>
        <td className="pl-droite">{nombre(somme("gagnes"))}{taux(somme("gagnes"), somme("perdus")) && <small>{taux(somme("gagnes"), somme("perdus"))}</small>}</td>
      </tr></tfoot>}
    </table></div>
  </div>;
}

const styles = `
.pl { --pl-encre: #0f172a; --pl-texte: #334155; --pl-gris: #64748b; --pl-ligne: #e2e8f0; --pl-fond: #f8fafc; --pl-teal: #0f766e;
  display: grid; gap: 18px; color: var(--pl-texte); font-size: 14px; transition: opacity .2s; }
.pl * { box-sizing: border-box; }
.pl-occupe { opacity: .6; }
.pl h3, .pl h4, .pl p { margin: 0; }
.pl-bloc { border: 1px solid var(--pl-ligne); border-radius: 16px; background: #fff; box-shadow: 0 1px 2px #0f172a0a; }
.pl-avis { padding: 12px 14px; border: 1px solid #fde68a; border-radius: 12px; background: #fffbeb; color: #92400e; }
.pl-avis button { border: 0; background: none; color: inherit; font-weight: 700; text-decoration: underline; cursor: pointer; }
.pl-squelettes { display: grid; gap: 12px; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
.pl-squelettes span { height: 104px; border-radius: 16px; background: linear-gradient(90deg, #f1f5f9, #f8fafc, #f1f5f9); background-size: 200% 100%; animation: pl-vague 1.2s infinite; }
@keyframes pl-vague { to { background-position: -200% 0; } }

.pl-agents { display: flex; flex-wrap: wrap; gap: 8px; }
.pl-puce { display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px 6px 7px; border: 1px solid #cbd5e1; border-radius: 99px; background: #fff; color: var(--pl-texte); font-size: 12px; font-weight: 600; cursor: pointer; }
.pl-puce:hover { background: var(--pl-fond); }
.pl-puce-equipe { padding-left: 11px; border-color: var(--pl-encre); background: var(--pl-encre); color: #fff; }
.pl-puce-equipe:hover { background: var(--pl-encre); }
.pl-puce-on { border-color: var(--pl-teal); background: #f0fdfa; color: #115e59; }
.pl-initiales { display: inline-grid; place-items: center; flex: none; width: 20px; height: 20px; border-radius: 50%; background: #e2e8f0; color: #334155; font-size: 10px; font-weight: 800; }
.pl-puce-on .pl-initiales { background: var(--pl-teal); color: #fff; }

.pl-synthese { display: grid; gap: 12px; }
@media (min-width: 1024px) { .pl-synthese { grid-template-columns: minmax(0, 1.2fr) minmax(0, 2fr); } }
.pl-portefeuille { padding: 16px; }
.pl-surtitre { display: inline-flex; align-items: center; gap: 6px; color: var(--pl-teal); font-size: 11px; font-weight: 800; letter-spacing: .06em; text-transform: uppercase; }
.pl-portefeuille-total { margin-top: 6px !important; color: var(--pl-gris); }
.pl-portefeuille-total strong { margin-right: 4px; color: var(--pl-encre); font-size: 30px; font-variant-numeric: tabular-nums; }
.pl-barre { display: flex; height: 10px; margin-top: 12px; overflow: hidden; border-radius: 99px; background: #f1f5f9; }
.pl-legende { display: flex; flex-wrap: wrap; gap: 4px 16px; margin: 10px 0 0; padding: 0; list-style: none; font-size: 12px; }
.pl-legende li { display: inline-flex; align-items: center; gap: 6px; }
.pl-legende strong { color: var(--pl-encre); font-variant-numeric: tabular-nums; }
.pl-point { width: 8px; height: 8px; border-radius: 50%; }
.pl-c-chaud { background: #f43f5e; } .pl-c-tiede { background: #fbbf24; } .pl-c-froid { background: #38bdf8; } .pl-c-non_qualifie { background: #cbd5e1; }
.pl-tuiles { display: grid; gap: 12px; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 768px) { .pl-tuiles { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.pl-tuile { padding: 14px; }
.pl-tuile-titre { display: flex; align-items: center; justify-content: space-between; gap: 6px; color: var(--pl-gris); font-size: 12px; font-weight: 600; }
.pl-tuile-titre svg { color: #94a3b8; }
.pl-tuile-portee { margin-top: 1px !important; color: #94a3b8; font-size: 11px; }
.pl-portee { margin-left: 6px; padding: 1px 7px; border-radius: 99px; background: #f1f5f9; color: #64748b; font-size: 10px; font-weight: 700; letter-spacing: 0; text-transform: none; vertical-align: middle; }
.pl-colonne-tete h4 small { display: block; color: #94a3b8; font-size: 11px; font-weight: 500; }
.pl-tuile-valeur { display: flex; align-items: baseline; gap: 8px; margin-top: 6px !important; color: var(--pl-encre); font-size: 26px; font-weight: 800; font-variant-numeric: tabular-nums; }
.pl-hausse, .pl-baisse { display: inline-flex; align-items: center; font-size: 12px; font-weight: 700; }
.pl-hausse { color: #047857; } .pl-baisse { color: #be123c; }
.pl-tuile-sous { margin-top: 2px !important; color: var(--pl-gris); font-size: 12px; }
.pl-rouge { color: #be123c !important; } .pl-vert { color: #047857 !important; } .pl-rose { color: #e11d48; } .pl-gras { font-weight: 700; } .pl-pale { color: #94a3b8; }

.pl-tableau { overflow: hidden; }
.pl-tableau-tete { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 10px; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; }
.pl-tableau-tete h3 { color: var(--pl-encre); font-size: 15px; }
.pl-tableau-tete p { color: var(--pl-gris); font-size: 12px; }
.pl-onglets { display: inline-flex; padding: 4px; border-radius: 12px; background: #f1f5f9; }
.pl-onglets button { padding: 6px 12px; border: 0; border-radius: 9px; background: none; color: var(--pl-gris); font-size: 13px; font-weight: 600; cursor: pointer; }
.pl-onglets button[aria-selected="true"] { background: #fff; color: var(--pl-encre); box-shadow: 0 1px 2px #0f172a1a; }
.pl-colonnes { display: grid; grid-auto-flow: column; grid-auto-columns: minmax(250px, 1fr); gap: 12px; padding: 12px; overflow-x: auto; background: #f8fafc99; scroll-snap-type: x mandatory; }
@media (max-width: 640px) { .pl-colonnes { grid-auto-columns: 84%; } }
.pl-colonne { display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--pl-ligne); border-top: 4px solid #94a3b8; border-radius: 12px; background: #fff; scroll-snap-align: start; }
.pl-t-teal { border-top-color: #14b8a6; } .pl-t-rose, .pl-t-chaud { border-top-color: #e11d48; } .pl-t-ambre, .pl-t-tiede { border-top-color: #f59e0b; }
.pl-t-ciel, .pl-t-froid { border-top-color: #0ea5e9; } .pl-t-violet { border-top-color: #8b5cf6; } .pl-t-non_qualifie, .pl-t-gris { border-top-color: #94a3b8; }
.pl-colonne-tete { display: flex; align-items: center; justify-content: space-between; padding: 8px 12px; }
.pl-colonne-tete h4 { color: var(--pl-encre); font-size: 13px; }
.pl-colonne-tete span { padding: 1px 8px; border-radius: 99px; background: #f1f5f9; color: #334155; font-size: 12px; font-weight: 800; font-variant-numeric: tabular-nums; }
.pl-colonne-corps { display: flex; flex-direction: column; gap: 8px; max-height: 520px; padding: 2px 8px 8px; overflow-x: hidden; overflow-y: auto; }
.pl-vide { padding: 16px 4px; color: #94a3b8; font-size: 12px; text-align: center; }
.pl-plus { padding: 4px; color: var(--pl-gris); font-size: 12px; text-align: center; }
.pl-carte { display: grid; grid-template-columns: minmax(0, 1fr); gap: 3px; width: 100%; min-width: 0; padding: 10px; border: 1px solid var(--pl-ligne); border-radius: 10px; background: #fff; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: border-color .15s, box-shadow .15s; }
.pl-carte:hover { border-color: #94a3b8; box-shadow: 0 2px 8px #0f172a12; }
.pl-carte:focus-visible { outline: 2px solid var(--pl-teal); outline-offset: 2px; }
.pl-carte-haut { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
.pl-carte-haut strong { min-width: 0; overflow: hidden; color: var(--pl-encre); text-overflow: ellipsis; white-space: nowrap; }
.pl-carte > span { min-width: 0; }
.pl-carte-haut > :last-child:not(strong) { flex-shrink: 0; }
.pl-carte-titre, .pl-carte-ligne { overflow-wrap: anywhere; }
.pl-carte-titre { color: #1e293b; font-size: 12px; }
.pl-carte-ligne { color: var(--pl-gris); font-size: 12px; }
.pl-carte-ligne.pl-rouge { font-weight: 600; }
.pl-carte-endormie { border-left: 3px solid #d97706; background: #fffdf7; }
.pl-endormi { display: inline-flex; align-items: center; gap: 4px; justify-self: start; width: fit-content; margin: 2px 0 0 !important; padding: 1px 7px; border-radius: 99px; background: #fef3c7; color: #92400e; font-size: 11px; font-weight: 700; }
.pl-endormis { display: flex; align-items: center; gap: 6px; margin-top: 10px !important; color: #b45309; font-size: 12px; font-weight: 600; }
.pl-endormis.pl-vert { color: #047857; }
.pl-carte-bas { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-top: 4px; color: var(--pl-gris); font-size: 12px; }
.pl-agent { display: inline-flex; align-items: center; gap: 5px; max-width: 55%; min-width: 0; color: #475569; font-size: 12px; }
.pl-agent > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pl-pastille { display: inline-flex; flex: none; align-items: center; gap: 3px; padding: 2px 7px; border-radius: 99px; font-size: 11px; font-weight: 600; }
.pl-p-chaud { background: #ffe4e6; color: #be123c; } .pl-p-tiede { background: #fef3c7; color: #b45309; } .pl-p-froid { background: #e0f2fe; color: #0369a1; } .pl-p-non_qualifie { background: #f1f5f9; color: #475569; }

.pl-fond { position: fixed; inset: 0; z-index: 60; display: flex; justify-content: flex-end; background: #0f172a66; animation: pl-apparait .15s ease-out; }
.pl-fenetre { display: flex; min-width: 0; overflow: hidden; flex-direction: column; width: min(460px, 100%); height: 100%; background: #fff; box-shadow: -12px 0 32px #0f172a2e; animation: pl-glisse .2s ease-out; }
@media (max-width: 640px) {
  .pl-fond { align-items: flex-end; }
  .pl-fenetre { width: 100%; height: auto; max-height: 88dvh; border-radius: 20px 20px 0 0; animation-name: pl-monte; }
}
@keyframes pl-apparait { from { opacity: 0; } }
@keyframes pl-glisse { from { transform: translateX(24px); opacity: 0; } }
@keyframes pl-monte { from { transform: translateY(24px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .pl-fond, .pl-fenetre, .pl-squelettes span { animation: none; } }
.pl-fenetre-tete { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 18px 18px 14px; border-bottom: 1px solid #f1f5f9; }
.pl-fenetre-tete h3 { color: var(--pl-encre); font-size: 19px; }
.pl-fenetre-tete p { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 6px !important; color: var(--pl-gris); font-size: 12px; }
.pl-fermer { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border: 1px solid var(--pl-ligne); border-radius: 10px; background: #fff; color: #475569; cursor: pointer; }
.pl-fenetre-corps { display: grid; grid-template-columns: minmax(0, 1fr); gap: 14px; overflow-x: hidden; padding: 16px 18px max(20px, env(safe-area-inset-bottom)); overflow-y: auto; }
.pl-prochaine { display: grid; gap: 2px; padding: 12px 14px; border-radius: 12px; background: #f0fdfa; }
.pl-prochaine small { color: var(--pl-teal); font-size: 11px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; }
.pl-prochaine strong { color: var(--pl-encre); }
.pl-prochaine span { color: var(--pl-gris); font-size: 12px; }
.pl-prochaine-vide { background: #fff1f2; }
.pl-prochaine-vide small, .pl-prochaine-vide strong { color: #be123c; }
.pl-appeler { display: flex; align-items: center; justify-content: center; gap: 8px; min-height: 42px; border-radius: 12px; background: var(--pl-teal); color: #fff; font-weight: 700; text-decoration: none; }
.pl-chargement { color: var(--pl-gris); font-size: 13px; }
.pl-infos { display: grid; gap: 10px; margin: 0; }
.pl-infos div { display: grid; grid-template-columns: 92px minmax(0, 1fr); gap: 10px; }
.pl-infos dt { color: var(--pl-gris); font-size: 12px; }
.pl-infos dd { display: flex; align-items: baseline; gap: 4px; margin: 0; color: #1e293b; font-size: 13px; white-space: pre-line; overflow-wrap: anywhere; }
.pl-intertitre { margin-top: 4px !important; color: var(--pl-encre); font-size: 13px; }
.pl-echanges { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.pl-echanges li { padding: 9px 11px; border-left: 3px solid #cbd5e1; border-radius: 0 10px 10px 0; background: var(--pl-fond); font-size: 12px; }
.pl-echanges strong { color: var(--pl-encre); }
.pl-echange-texte { margin-top: 3px !important; color: #1e293b; white-space: pre-line; overflow-wrap: anywhere; }
.pl-fenetre-corps > *, .pl-echanges li, .pl-prochaine > * { min-width: 0; overflow-wrap: anywhere; }

.pl-equipe { overflow: hidden; }
.pl-defile { overflow-x: auto; }
.pl-equipe table { width: 100%; min-width: 680px; border-collapse: collapse; font-size: 13px; }
.pl-equipe thead { background: var(--pl-fond); color: var(--pl-gris); font-size: 12px; }
.pl-equipe th, .pl-equipe td { padding: 10px 12px; text-align: left; vertical-align: top; }
.pl-equipe thead th { font-weight: 600; }
.pl-equipe tbody tr { border-top: 1px solid #f1f5f9; }
.pl-equipe tbody tr:hover { background: #f8fafc; }
.pl-equipe tbody th { color: var(--pl-encre); font-weight: 600; }
.pl-equipe tbody th small { color: #94a3b8; font-weight: 400; }
.pl-equipe td small { display: block; margin-top: 2px; color: var(--pl-gris); font-size: 11px; }
.pl-equipe .pl-droite { text-align: right; font-variant-numeric: tabular-nums; }
.pl-equipe .pl-case { width: 36px; }
.pl-equipe input[type="checkbox"] { width: 16px; height: 16px; accent-color: var(--pl-teal); }
.pl-ligne-on { background: #f0fdfa99; }
.pl-jauge { display: inline-flex; align-items: center; gap: 8px; }
.pl-jauge span { height: 8px; border-radius: 99px; background: #14b8a6; }
.pl-equipe tfoot { border-top: 2px solid var(--pl-teal); background: #f0fdfa; color: #134e4a; font-weight: 700; }
.pl-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
`;
