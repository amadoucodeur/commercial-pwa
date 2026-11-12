"use client";

// Détail des actions menées par les commerciaux, partagé entre Trabad Commercial et Loc Manager
// (même fichier dans les deux dépôts). Styles autonomes préfixés « ca- ».
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ChevronDown, Download, Phone, Search } from "lucide-react";

type Activite = {
  id: string; opportunite_id: string; auteur_id: string | null; type_activite: string;
  resultat: string | null; notes: string | null; decision: string | null; etape_classee: string | null;
  motif: string | null; effectuee_at: string;
};
type Dossier = { id: string; contact_id: string; etape: string; owner_id: string | null; archived_at: string | null };
type Contact = { id: string; nom: string; telephone: string | null };
type Ligne = Activite & { dossier?: Dossier; contact?: Contact; auteur: string };

const types = [["appel", "Appels"], ["visite", "Visites"], ["rendez_vous", "Rendez-vous"], ["message", "Messages"], ["note", "Notes"]] as const;
const typeSingulier: Record<string, string> = { appel: "Appel", visite: "Visite", rendez_vous: "Rendez-vous", message: "Message", note: "Note" };
const etapes: Record<string, string> = {
  nouveau: "Nouveau", contacte: "Contact établi", rdv: "Rendez-vous", proposition: "Proposition",
  negociation: "Négociation", gagne: "Gagné", perdu: "Perdu", reporte: "Reporté",
};
const suites = [["programmer", "Prochaine action programmée"], ["classer", "Dossier classé"], ["archiver", "Dossier archivé"]] as const;
const LIMITE_ACTIVITES = 5000;
const PAR_PAGE = 30;

const dateHeure = (value: string) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;
const normaliser = (texte: string) => texte.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const csvCellule = (value: string | number | null | undefined) => {
  const brut = String(value ?? "");
  const sur = /^\s*[=+\-@]/.test(brut) || /^[\t\r]/.test(brut) ? `'${brut}` : brut;
  return `"${sur.replaceAll('"', '""')}"`;
};

// Les lignes importées du classeur Excel gardent leur contenu brut en JSON : on l'affiche en « champ : valeur ».
export function lireNotes(notes: string | null) {
  if (!notes) return "";
  const texte = notes.trim();
  if (!texte.startsWith("{")) return texte;
  try {
    const objet = JSON.parse(texte) as { data?: Record<string, unknown> };
    if (!objet.data || typeof objet.data !== "object") return texte;
    return Object.entries(objet.data)
      .filter(([cle, valeur]) => valeur !== null && String(valeur).trim() !== "" && !/mot de passe|password/i.test(cle) && !/^col_\d+$/.test(cle))
      .map(([cle, valeur]) => `${cle.trim()} : ${String(valeur).trim()}`)
      .join(" · ");
  } catch {
    return texte;
  }
}

function suiteDe(ligne: Activite) {
  if (ligne.decision === "programmer") return "Prochaine action programmée";
  if (ligne.decision === "archiver") return `Dossier archivé${ligne.motif ? ` · ${ligne.motif}` : ""}`;
  if (ligne.decision === "classer") return `Classé ${etapes[ligne.etape_classee ?? ""] ?? ligne.etape_classee ?? ""}${ligne.motif ? ` · ${ligne.motif}` : ""}`;
  return "";
}

async function parPaquets<T>(ids: string[], charger: (paquet: string[]) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  const resultats: T[] = [];
  for (let debut = 0; debut < ids.length; debut += 150) {
    const { data, error } = await charger(ids.slice(debut, debut + 150));
    if (error) throw new Error(error.message);
    resultats.push(...(data ?? []));
  }
  return resultats;
}

export function CommercialActionsDetail({ client, organisationId, debut, fin, agents = [], equipe = true, refreshKey = 0, onOuvrirDossier }: {
  client: SupabaseClient;
  organisationId: string;
  debut: string;
  fin: string;
  agents?: { user_id: string; nom: string }[];
  equipe?: boolean;
  refreshKey?: number;
  onOuvrirDossier?: (dossierId: string) => void;
}) {
  const [brutes, setBrutes] = useState<Ligne[] | null>(null);
  const [tronque, setTronque] = useState(false);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [type, setType] = useState("");
  const [agent, setAgent] = useState("");
  const [suite, setSuite] = useState("");
  const [recherche, setRecherche] = useState("");
  const [affiches, setAffiches] = useState(PAR_PAGE);
  const requete = useRef(0);
  // Clé stable : la liste d'agents est souvent recréée à chaque rendu par le parent.
  const cleAgents = agents.map((item) => `${item.user_id}:${item.nom}`).join("|");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const nomsAgents = useMemo(() => new Map(agents.map((item) => [item.user_id, item.nom])), [cleAgents]);
  const listeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!debut || !fin || debut > fin) return;
    const courante = ++requete.current;
    setChargement(true);
    void (async () => {
      const activites: Activite[] = [];
      // Bornes en dates d'Abidjan (UTC+0) : du début du premier jour au début du lendemain du dernier.
      const finExclue = new Date(Date.parse(`${fin}T00:00:00Z`) + 86_400_000).toISOString();
      for (let page = 0; activites.length < LIMITE_ACTIVITES; page += 1) {
        const { data, error } = await client.from("crm_activites")
          .select("id,opportunite_id,auteur_id,type_activite,resultat,notes,decision,etape_classee,motif,effectuee_at")
          .eq("organisation_id", organisationId)
          .gte("effectuee_at", `${debut}T00:00:00Z`).lt("effectuee_at", finExclue)
          .order("effectuee_at", { ascending: false }).order("id")
          .range(page * 1000, page * 1000 + 999);
        if (error) throw new Error(error.message);
        activites.push(...((data ?? []) as Activite[]));
        if (!data || data.length < 1000) break;
      }
      const idsDossiers = [...new Set(activites.map((item) => item.opportunite_id))];
      const dossiers = await parPaquets<Dossier>(idsDossiers, (paquet) =>
        client.from("crm_opportunites").select("id,contact_id,etape,owner_id,archived_at").in("id", paquet));
      const dossierParId = new Map(dossiers.map((item) => [item.id, item]));
      const idsContacts = [...new Set(dossiers.map((item) => item.contact_id))];
      const contacts = await parPaquets<Contact>(idsContacts, (paquet) =>
        client.from("crm_contacts").select("id,nom,telephone").in("id", paquet));
      const contactParId = new Map(contacts.map((item) => [item.id, item]));
      if (courante !== requete.current) return;
      setTronque(activites.length >= LIMITE_ACTIVITES);
      setBrutes(activites.map((item) => {
        const dossier = dossierParId.get(item.opportunite_id);
        return { ...item, dossier, contact: dossier ? contactParId.get(dossier.contact_id) : undefined, auteur: "" };
      }));
      setErreur("");
    })().catch((error: unknown) => {
      if (courante !== requete.current) return;
      setErreur(navigator.onLine ? `Détail des actions indisponible : ${error instanceof Error ? error.message : "erreur inconnue"}` : "Détail des actions consultable une fois en ligne.");
    }).finally(() => { if (courante === requete.current) setChargement(false); });
  }, [client, organisationId, debut, fin, refreshKey]);

  const lignes = useMemo(() => brutes?.map((ligne) => ({ ...ligne,
    auteur: ligne.auteur_id ? nomsAgents.get(ligne.auteur_id) ?? "Agent" : "Import ou système" })) ?? null, [brutes, nomsAgents]);

  useEffect(() => { setAffiches(PAR_PAGE); }, [type, agent, suite, recherche, debut, fin]);

  // Lignes de l'agent choisi : base des compteurs de chaque type d'action.
  const lignesAgent = useMemo(() => (lignes ?? []).filter((ligne) =>
    !agent || (agent === "import" ? !ligne.auteur_id : ligne.auteur_id === agent)), [lignes, agent]);
  const dossiersParType = useMemo(() => {
    const compte = new Map<string, Set<string>>([["", new Set()]]);
    for (const ligne of lignesAgent) {
      compte.get("")!.add(ligne.opportunite_id);
      if (!compte.has(ligne.type_activite)) compte.set(ligne.type_activite, new Set());
      compte.get(ligne.type_activite)!.add(ligne.opportunite_id);
    }
    return compte;
  }, [lignesAgent]);
  const lignesType = useMemo(() => lignesAgent.filter((ligne) => !type || ligne.type_activite === type), [lignesAgent, type]);
  const dossiersParSuite = useMemo(() => {
    const compte = new Map<string, Set<string>>();
    for (const ligne of lignesType) if (ligne.decision) {
      if (!compte.has(ligne.decision)) compte.set(ligne.decision, new Set());
      compte.get(ligne.decision)!.add(ligne.opportunite_id);
    }
    return compte;
  }, [lignesType]);
  const filtrees = useMemo(() => {
    const terme = normaliser(recherche.trim());
    return lignesType.filter((ligne) => (!suite || ligne.decision === suite) && (!terme || normaliser([
      ligne.contact?.nom, ligne.contact?.telephone, ligne.resultat, lireNotes(ligne.notes), ligne.auteur,
    ].filter(Boolean).join(" ")).includes(terme)));
  }, [lignesType, suite, recherche]);
  // Une carte par dossier, les dossiers les plus récemment travaillés en premier.
  const groupes = useMemo(() => {
    const parDossier = new Map<string, Ligne[]>();
    for (const ligne of filtrees) {
      if (!parDossier.has(ligne.opportunite_id)) parDossier.set(ligne.opportunite_id, []);
      parDossier.get(ligne.opportunite_id)!.push(ligne);
    }
    return [...parDossier.values()];
  }, [filtrees]);

  // Qui a fait quoi : nombre de dossiers distincts par agent et par type d'action.
  const matrice = useMemo(() => {
    const parAgent = new Map<string, { nom: string; total: Set<string>; echanges: number; types: Map<string, Set<string>> }>();
    for (const ligne of lignes ?? []) {
      const cle = ligne.auteur_id ?? "import";
      if (!parAgent.has(cle)) parAgent.set(cle, { nom: ligne.auteur, total: new Set(), echanges: 0, types: new Map() });
      const entree = parAgent.get(cle)!;
      entree.total.add(ligne.opportunite_id);
      entree.echanges += 1;
      if (!entree.types.has(ligne.type_activite)) entree.types.set(ligne.type_activite, new Set());
      entree.types.get(ligne.type_activite)!.add(ligne.opportunite_id);
    }
    return [...parAgent.entries()].sort(([, a], [, b]) => b.echanges - a.echanges || a.nom.localeCompare(b.nom, "fr"));
  }, [lignes]);
  const echangesParType = useMemo(() => {
    const compte = new Map<string, number>();
    for (const ligne of lignesAgent) compte.set(ligne.type_activite, (compte.get(ligne.type_activite) ?? 0) + 1);
    return compte;
  }, [lignesAgent]);
  const formatJour = (valeur: string) => new Intl.DateTimeFormat("fr-FR", { timeZone: "UTC", day: "numeric", month: "long" }).format(new Date(`${valeur}T00:00:00Z`));
  const sujet = !equipe ? "vous avez" : agent ? `${agent === "import" ? "l’import" : nomsAgents.get(agent) ?? "l’agent"} a` : "l’équipe a";
  const detailTypes = types.filter(([cle]) => dossiersParType.get(cle)?.size)
    .map(([cle, nom]) => `${echangesParType.get(cle)} ${nom.toLowerCase()} (${pluriel(dossiersParType.get(cle)!.size, "dossier")})`);

  function choisir(nouvelAgent: string, nouveauType: string) {
    setAgent(nouvelAgent); setType(nouveauType); setSuite("");
    window.setTimeout(() => listeRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }

  const libelleType = type ? types.find(([cle]) => cle === type)?.[1] ?? type : "Toutes les actions";
  const agentsAvecImport = [...agents, ...((lignes ?? []).some((ligne) => !ligne.auteur_id) ? [{ user_id: "import", nom: "Import ou système" }] : [])];

  function exporter() {
    const entetes = ["Date", "Agent", "Action", "Contact", "Téléphone", "Étape actuelle", "Résultat", "Notes", "Suite"];
    const contenu = filtrees.map((ligne) => [
      new Date(ligne.effectuee_at).toISOString().replace("T", " ").slice(0, 16), ligne.auteur,
      typeSingulier[ligne.type_activite] ?? ligne.type_activite, ligne.contact?.nom, ligne.contact?.telephone,
      ligne.dossier ? ligne.dossier.archived_at ? "Archivé" : etapes[ligne.dossier.etape] ?? ligne.dossier.etape : "",
      ligne.resultat, lireNotes(ligne.notes), suiteDe(ligne),
    ]);
    const url = URL.createObjectURL(new Blob([`﻿${[entetes, ...contenu].map((ligne) => ligne.map(csvCellule).join(";")).join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    const lien = document.createElement("a");
    lien.href = url;
    lien.download = `trabad-commercial-actions-${type || "toutes"}-${debut}_${fin}.csv`;
    lien.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <section className={`ca ${chargement ? "ca-loading" : ""}`} aria-busy={chargement} aria-labelledby="ca-titre">
    <style>{styles}</style>
    <header className="ca-head">
      <div><h3 id="ca-titre">Détail des actions menées</h3><p>Choisissez une action pour voir les dossiers concernés, avec le résultat et les notes de chaque échange.</p></div>
      <button type="button" className="ca-export" onClick={exporter} disabled={!filtrees.length}><Download size={14} /> Exporter</button>
    </header>

    {lignes && !erreur && <p className="ca-resume">
      {debut === fin ? `Le ${formatJour(debut)}` : `Du ${formatJour(debut)} au ${formatJour(fin)}`}, {sujet} mené <strong>{pluriel(lignesAgent.length, "échange")}</strong> sur <strong>{pluriel(dossiersParType.get("")?.size ?? 0, "dossier")}</strong>{detailTypes.length ? ` : ${detailTypes.join(", ")}.` : "."}
    </p>}

    {equipe && !agent && matrice.length > 0 && <div className="ca-matrice-wrap">
      <table className="ca-matrice">
        <caption>Qui a fait quoi · nombre de dossiers traités (cliquez sur un chiffre pour voir les dossiers)</caption>
        <thead><tr><th scope="col">Agent</th>{types.map(([cle, nom]) => <th key={cle} scope="col">{nom}</th>)}<th scope="col">Total dossiers</th></tr></thead>
        <tbody>{matrice.map(([cle, entree]) => <tr key={cle}>
          <th scope="row"><button type="button" onClick={() => choisir(cle, "")}>{entree.nom}</button><small>{pluriel(entree.echanges, "échange")}</small></th>
          {types.map(([cleType]) => { const n = entree.types.get(cleType)?.size ?? 0; return <td key={cleType}>{n ? <button type="button" onClick={() => choisir(cle, cleType)} aria-label={`${entree.nom} : ${n} dossiers, ${cleType}`}>{n}</button> : <span>–</span>}</td>; })}
          <td><button type="button" className="ca-total" onClick={() => choisir(cle, "")}>{entree.total.size}</button></td>
        </tr>)}</tbody>
      </table>
    </div>}

    {equipe && agentsAvecImport.length > 0 && <label className="ca-agent">Agent<select value={agent} onChange={(event) => setAgent(event.target.value)}><option value="">Toute l’équipe</option>{agentsAvecImport.map((item) => <option key={item.user_id} value={item.user_id}>{item.nom}</option>)}</select></label>}

    <div className="ca-types" role="group" aria-label="Type d’action">
      {[["", "Toutes"] as const, ...types].map(([cle, nom]) => {
        const n = dossiersParType.get(cle)?.size ?? 0;
        return <button key={cle || "toutes"} type="button" className="ca-type" aria-pressed={type === cle} disabled={!!cle && n === 0 && type !== cle} onClick={() => { setType(cle); setSuite(""); }}>
          <span>{nom}</span><b>{n}</b><small>{n > 1 ? "dossiers" : "dossier"}</small>
        </button>;
      })}
    </div>

    {dossiersParSuite.size > 0 && <div className="ca-suites" role="group" aria-label="Suite donnée">
      <span>Suite donnée :</span>
      <button type="button" aria-pressed={!suite} onClick={() => setSuite("")}>Toutes</button>
      {suites.filter(([cle]) => dossiersParSuite.has(cle)).map(([cle, nom]) => <button key={cle} type="button" aria-pressed={suite === cle} onClick={() => setSuite(suite === cle ? "" : cle)}>{nom} · {dossiersParSuite.get(cle)!.size}</button>)}
    </div>}

    <label className="ca-search"><Search size={15} /><input value={recherche} onChange={(event) => setRecherche(event.target.value)} placeholder="Contact, téléphone, résultat ou note" aria-label="Rechercher dans les actions" /></label>

    <div ref={listeRef} />
    {erreur ? <p className="ca-error" role="status">{erreur}</p>
      : !lignes ? <p className="ca-empty">Chargement des actions…</p>
      : <>
        <p className="ca-summary">{libelleType} · <strong>{pluriel(groupes.length, "dossier")}</strong> · {pluriel(filtrees.length, "échange")}{tronque ? ` · limité aux ${LIMITE_ACTIVITES} échanges les plus récents, réduisez la période` : ""}</p>
        {groupes.length === 0 ? <p className="ca-empty">Aucune action de ce type sur la période.</p> : <ul className="ca-list">
          {groupes.slice(0, affiches).map((echanges) => {
            const premier = echanges[0];
            const dossier = premier.dossier;
            return <li key={premier.opportunite_id} className="ca-dossier">
              <div className="ca-dossier-head">
                <div>
                  <strong>{premier.contact?.nom ?? "Dossier inaccessible"}</strong>
                  <small>{premier.contact?.telephone && <a href={`tel:${premier.contact.telephone}`}><Phone size={12} /> {premier.contact.telephone}</a>}{dossier && <span className="ca-stage">{dossier.archived_at ? "Archivé" : etapes[dossier.etape] ?? dossier.etape}</span>}</small>
                </div>
                <div className="ca-dossier-side"><span>{pluriel(echanges.length, "échange")}</span>{onOuvrirDossier && dossier && <button type="button" onClick={() => onOuvrirDossier(dossier.id)}>Ouvrir</button>}</div>
              </div>
              <ol className="ca-echanges">{echanges.map((ligne) => {
                const notes = lireNotes(ligne.notes);
                const suiteTexte = suiteDe(ligne);
                return <li key={ligne.id}>
                  <div className="ca-echange-meta"><span className="ca-badge" data-type={ligne.type_activite}>{typeSingulier[ligne.type_activite] ?? ligne.type_activite}</span><span>{dateHeure(ligne.effectuee_at)}</span><span>· {ligne.auteur}</span></div>
                  {ligne.resultat && <p className="ca-resultat">{ligne.resultat}</p>}
                  {notes ? <p className="ca-notes">{notes}</p> : <p className="ca-notes ca-muted">Aucune note.</p>}
                  {suiteTexte && <p className="ca-suite">→ {suiteTexte}</p>}
                </li>;
              })}</ol>
            </li>;
          })}
        </ul>}
        {groupes.length > affiches && <button type="button" className="ca-more" onClick={() => setAffiches((n) => n + PAR_PAGE)}><ChevronDown size={15} /> Afficher {Math.min(PAR_PAGE, groupes.length - affiches)} dossiers de plus ({groupes.length - affiches} restants)</button>}
      </>}
  </section>;
}

const styles = `
.ca { --ca-surface: #ffffff; --ca-text: #0d2146; --ca-text-2: #52647d; --ca-muted: #8b9aaf; --ca-line: #e6eaf1; --ca-accent: #2a78d6; --ca-accent-bg: #eaf2fc;
  display: grid; gap: 12px; padding: 16px; border: 1px solid var(--ca-line); border-radius: 16px; background: var(--ca-surface); color: var(--ca-text); transition: opacity .2s; }
.ca.ca-loading { opacity: .6; }
.ca-head { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.ca-head h3 { margin: 0; font-size: 15px; font-weight: 650; }
.ca-head p { margin: 3px 0 0; color: var(--ca-muted); font-size: 12px; }
.ca-export, .ca-more { display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: none; padding: 6px 10px; border: 1px solid var(--ca-line); border-radius: 9px; background: var(--ca-surface); color: var(--ca-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.ca-export:disabled { opacity: .5; cursor: default; }
.ca-resume { margin: 0; padding: 10px 12px; border-radius: 10px; background: #f6f8fb; color: var(--ca-text); font-size: 13px; line-height: 1.5; }
.ca-matrice-wrap { overflow-x: auto; }
.ca-matrice { width: 100%; min-width: 560px; border-collapse: collapse; font-size: 12px; }
.ca-matrice caption { padding-bottom: 6px; color: var(--ca-text-2); font-size: 12px; font-weight: 600; text-align: left; }
.ca-matrice th, .ca-matrice td { padding: 6px 8px; border-bottom: 1px solid var(--ca-line); text-align: center; font-variant-numeric: tabular-nums; }
.ca-matrice thead th { color: var(--ca-muted); font-weight: 600; }
.ca-matrice tbody th { text-align: left; font-weight: 500; }
.ca-matrice tbody th small { display: block; color: var(--ca-muted); font-size: 11px; }
.ca-matrice button { padding: 2px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--ca-accent); font: inherit; font-weight: 650; cursor: pointer; }
.ca-matrice tbody th button { padding: 0; color: var(--ca-text); text-align: left; }
.ca-matrice td button:hover, .ca-matrice tbody th button:hover { background: var(--ca-accent-bg); text-decoration: underline; }
.ca-matrice td span { color: #c4ccd8; }
.ca-matrice .ca-total { color: var(--ca-text); }
.ca-agent { display: grid; gap: 4px; max-width: 280px; color: var(--ca-text-2); font-size: 12px; font-weight: 600; }
.ca-agent select { padding: 8px 10px; border: 1px solid #cfd8e5; border-radius: 10px; background: var(--ca-surface); color: var(--ca-text); font-size: 13px; }
.ca-types { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 8px; }
.ca-type { display: grid; justify-items: start; gap: 1px; padding: 10px 12px; border: 1px solid var(--ca-line); border-radius: 12px; background: var(--ca-surface); color: var(--ca-text-2); text-align: left; cursor: pointer; }
.ca-type span { font-size: 12px; font-weight: 600; }
.ca-type b { color: var(--ca-text); font-size: 22px; font-weight: 650; line-height: 1.15; font-variant-numeric: tabular-nums; }
.ca-type small { color: var(--ca-muted); font-size: 11px; }
.ca-type[aria-pressed="true"] { border-color: var(--ca-accent); background: var(--ca-accent-bg); box-shadow: inset 0 0 0 1px var(--ca-accent); }
.ca-type[aria-pressed="true"] span, .ca-type[aria-pressed="true"] b { color: var(--ca-accent); }
.ca-type:disabled { opacity: .45; cursor: default; }
.ca-suites { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--ca-text-2); font-size: 12px; }
.ca-suites button { padding: 4px 9px; border: 1px solid var(--ca-line); border-radius: 999px; background: var(--ca-surface); color: var(--ca-text-2); font-size: 12px; cursor: pointer; }
.ca-suites button[aria-pressed="true"] { border-color: var(--ca-accent); background: var(--ca-accent-bg); color: var(--ca-accent); font-weight: 600; }
.ca-search { display: flex; align-items: center; gap: 8px; padding: 0 10px; border: 1px solid #cfd8e5; border-radius: 10px; color: var(--ca-muted); }
.ca-search input { width: 100%; min-width: 0; padding: 9px 0; border: 0; outline: none; background: transparent; color: var(--ca-text); font-size: 13px; }
.ca-summary { margin: 0; color: var(--ca-text-2); font-size: 13px; }
.ca-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.ca-dossier { padding: 12px; border: 1px solid var(--ca-line); border-radius: 12px; }
.ca-dossier-head { display: flex; align-items: start; justify-content: space-between; gap: 10px; }
.ca-dossier-head strong { display: block; font-size: 14px; }
.ca-dossier-head small { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 3px; color: var(--ca-text-2); font-size: 12px; }
.ca-dossier-head a { display: inline-flex; align-items: center; gap: 4px; color: var(--ca-accent); text-decoration: none; }
.ca-stage { padding: 1px 7px; border-radius: 999px; background: #f1f4f8; color: var(--ca-text-2); font-size: 11px; font-weight: 600; }
.ca-dossier-side { display: flex; flex: none; align-items: center; gap: 8px; color: var(--ca-muted); font-size: 12px; }
.ca-dossier-side button { padding: 4px 9px; border: 1px solid var(--ca-line); border-radius: 8px; background: var(--ca-surface); color: var(--ca-accent); font-size: 12px; font-weight: 600; cursor: pointer; }
.ca-echanges { display: grid; gap: 8px; margin: 10px 0 0; padding: 0 0 0 12px; border-left: 2px solid var(--ca-line); list-style: none; }
.ca-echange-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: var(--ca-muted); font-size: 11px; }
.ca-badge { padding: 1px 7px; border-radius: 6px; background: var(--ca-accent-bg); color: var(--ca-accent); font-size: 11px; font-weight: 650; }
.ca-badge[data-type="visite"] { background: #fdeee7; color: #b44a1c; }
.ca-badge[data-type="rendez_vous"] { background: #e5f6ef; color: #197143; }
.ca-badge[data-type="message"] { background: #fff4dc; color: #8a5a00; }
.ca-badge[data-type="note"] { background: #fbe9f0; color: #a23c6b; }
.ca-resultat { margin: 4px 0 0; font-size: 13px; font-weight: 600; }
.ca-notes { margin: 3px 0 0; color: var(--ca-text-2); font-size: 13px; line-height: 1.45; white-space: pre-line; overflow-wrap: anywhere; }
.ca-muted { color: var(--ca-muted); font-style: italic; }
.ca-suite { margin: 3px 0 0; color: var(--ca-accent); font-size: 12px; }
.ca-empty { margin: 4px 0; color: var(--ca-muted); font-size: 13px; }
.ca-error { margin: 4px 0; color: #a23c49; font-size: 13px; }
@media (max-width: 520px) { .ca { padding: 12px; } .ca-types { grid-template-columns: repeat(3, 1fr); } .ca-type { padding: 8px; } .ca-type b { font-size: 18px; } .ca-dossier-head { flex-direction: column; } }
`;
