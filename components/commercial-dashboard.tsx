"use client";

// Tableau de bord commercial partagé entre Trabad Commercial et Loc Manager (même fichier dans les deux dépôts).
// Graphiques en SVG/HTML sans dépendance ; styles autonomes préfixés « cd- ».
import { useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertTriangle, ArrowDownRight, ArrowUpRight, Table2 } from "lucide-react";

type Compte = { cle: string; nombre: number };
type Point = { debut: string; nouveaux: number; gagnes: number; perdus: number; appel: number; visite: number; rendez_vous: number; message: number; note: number };
type AgentStat = { user_id: string; nom: string; actif: boolean; portefeuille: number; nouveaux: number; gagnes: number; perdus: number; actions: number; en_retard: number };
type Tableau = {
  unite: "day" | "week" | "month";
  dossiers: { actifs: number; non_attribues: number; sans_action: number; chauds: number; nouveaux: number; nouveaux_prec: number; gagnes: number; gagnes_prec: number; perdus: number; perdus_prec: number; archives: number; delai_gain_jours: number | null };
  actions: { total: number; total_prec: number; appel: number; visite: number; rendez_vous: number; message: number; note: number; en_retard: number; a_venir: number };
  serie: Point[];
  etapes: Compte[]; temperatures: Compte[]; sources: Compte[]; services: Compte[]; localites: Compte[];
  motifs_perte: Compte[]; motifs_archivage: Compte[];
  agents: AgentStat[];
};

// Palette catégorielle validée (ordre fixe, jamais recyclé). Trois teintes sont sous 3:1 sur blanc :
// chaque graphique a donc une légende et une vue tableau.
const series = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"] as const;
const typesActions = [["appel", "Appels"], ["visite", "Visites"], ["rendez_vous", "Rendez-vous"], ["message", "Messages"], ["note", "Notes"]] as const;
const seriesDossiers = [["nouveaux", "Nouveaux"], ["gagnes", "Gagnés"], ["perdus", "Perdus"]] as const;
const libelles: Record<string, string> = {
  nouveau: "Nouveau", contacte: "Contact établi", rdv: "Rendez-vous", proposition: "Proposition", negociation: "Négociation",
  gagne: "Gagné", perdu: "Perdu", reporte: "Reporté", froid: "Froid", tiede: "Tiède", chaud: "Chaud", non_qualifie: "Non qualifié",
  manuel: "Saisie manuelle", terrain: "Terrain", facebook: "Facebook", instagram: "Instagram", linkedin: "LinkedIn", ads: "Publicité en ligne",
  whatsapp: "WhatsApp", site: "Site web", recommandation: "Recommandation", appel: "Appel entrant", autre: "Autre",
  gestion_locative: "Gestion locative", vente: "Vente", location: "Location", construction: "Construction",
  rehabilitation: "Réhabilitation", assistance_juridique: "Assistance juridique", information: "Information",
};
const ordreEtapes = ["nouveau", "contacte", "rdv", "proposition", "negociation", "reporte", "gagne", "perdu"];
const nombre = (value: number) => new Intl.NumberFormat("fr-FR", { notation: value >= 10000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);
const pourcent = (value: number) => new Intl.NumberFormat("fr-FR", { style: "percent", maximumFractionDigits: 0 }).format(value);
function libellePeriode(debut: string, unite: Tableau["unite"], court = false) {
  const date = new Date(`${debut}T00:00:00Z`);
  if (unite === "month") return new Intl.DateTimeFormat("fr-FR", { month: "short", year: court ? undefined : "numeric", timeZone: "UTC" }).format(date);
  const jour = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
  return unite === "week" && !court ? `Semaine du ${jour}` : jour;
}
function graduations(max: number) {
  if (max <= 0) return [0, 1];
  const brut = max / 4;
  const puissance = 10 ** Math.floor(Math.log10(brut));
  const pas = [1, 2, 5, 10].map((m) => m * puissance).find((m) => m >= brut) ?? brut;
  return Array.from({ length: Math.ceil(max / pas) + 1 }, (_, index) => index * pas);
}

function useLargeur<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [largeur, setLargeur] = useState(0);
  useEffect(() => {
    if (!ref.current) return;
    const observer = new ResizeObserver(([entree]) => setLargeur(entree.contentRect.width));
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, []);
  return [ref, largeur] as const;
}

function Carte({ titre, sousTitre, tableau, children, large = false }: {
  titre: string; sousTitre?: string; tableau: { colonnes: string[]; lignes: (string | number)[][] }; children: React.ReactNode; large?: boolean;
}) {
  const [vueTableau, setVueTableau] = useState(false);
  return <section className={`cd-card ${large ? "cd-wide" : ""}`}>
    <header><div><h3>{titre}</h3>{sousTitre && <p>{sousTitre}</p>}</div><button type="button" className="cd-toggle" aria-pressed={vueTableau} onClick={() => setVueTableau((value) => !value)}><Table2 size={14} /> {vueTableau ? "Graphique" : "Tableau"}</button></header>
    {vueTableau ? <div className="cd-table-wrap"><table className="cd-table"><thead><tr>{tableau.colonnes.map((colonne) => <th key={colonne} scope="col">{colonne}</th>)}</tr></thead><tbody>{tableau.lignes.map((ligne, index) => <tr key={index}>{ligne.map((cellule, position) => position === 0 ? <th key={position} scope="row">{cellule}</th> : <td key={position}>{cellule}</td>)}</tr>)}</tbody></table></div> : children}
  </section>;
}

function Legende({ elements }: { elements: { nom: string; couleur: string }[] }) {
  return <ul className="cd-legend">{elements.map((element) => <li key={element.nom}><span style={{ background: element.couleur }} />{element.nom}</li>)}</ul>;
}

function Barres({ donnees, vide = "Aucune donnée sur la période." }: { donnees: { libelle: string; valeur: number; detail?: string }[]; vide?: string }) {
  const max = Math.max(1, ...donnees.map((item) => item.valeur));
  const total = donnees.reduce((somme, item) => somme + item.valeur, 0);
  if (!donnees.length || total === 0) return <p className="cd-empty">{vide}</p>;
  // Libellés longs (raisons) : affichés au-dessus de la barre plutôt que tronqués.
  const empile = donnees.some((item) => item.libelle.length > 22);
  return <ul className={`cd-bars ${empile ? "cd-bars-stacked" : ""}`}>{donnees.map((item) => <li key={item.libelle} title={`${item.libelle} : ${nombre(item.valeur)} (${pourcent(item.valeur / total)})${item.detail ? ` · ${item.detail}` : ""}`}>
    <span className="cd-bar-label">{item.libelle}</span>
    <span className="cd-bar-track"><span className="cd-bar" style={{ width: `${Math.max(item.valeur > 0 ? 2 : 0, (item.valeur / max) * 100)}%` }} /><span className="cd-bar-value">{nombre(item.valeur)}{item.detail && <small> · {item.detail}</small>}</span></span>
  </li>)}</ul>;
}

const hauteurGraphe = 220;
const marges = { haut: 12, droite: 16, bas: 28, gauche: 34 };

function Axes({ largeur, ticks, max, etiquettes }: { largeur: number; ticks: number[]; max: number; etiquettes: { x: number; texte: string }[] }) {
  const hauteur = hauteurGraphe - marges.haut - marges.bas;
  return <>
    {ticks.map((tick) => { const y = marges.haut + hauteur - (tick / max) * hauteur; return <g key={tick}><line x1={marges.gauche} x2={largeur - marges.droite} y1={y} y2={y} className="cd-gridline" /><text x={marges.gauche - 6} y={y} className="cd-axis" textAnchor="end" dominantBaseline="middle">{nombre(tick)}</text></g>; })}
    {etiquettes.map((etiquette) => <text key={`${etiquette.x}-${etiquette.texte}`} x={etiquette.x} y={hauteurGraphe - 8} className="cd-axis" textAnchor="middle">{etiquette.texte}</text>)}
  </>;
}

function etiquettesX(points: Point[], unite: Tableau["unite"], x: (index: number) => number, largeur: number) {
  const nombreMax = Math.max(2, Math.floor((largeur - marges.gauche - marges.droite) / 70));
  const pas = Math.max(1, Math.ceil(points.length / nombreMax));
  return points.map((point, index) => ({ index, point })).filter(({ index }) => index % pas === 0)
    .map(({ index, point }) => ({ x: x(index), texte: libellePeriode(point.debut, unite, true) }));
}

// L'infobulle se place à côté de la marque survolée (à droite, ou à gauche près du bord) pour ne pas la masquer.
const positionInfobulle = (x: number, largeur: number): React.CSSProperties =>
  x + 190 < largeur ? { left: x + 14 } : { left: x - 14, transform: "translateX(-100%)" };

function Courbes({ points, unite }: { points: Point[]; unite: Tableau["unite"] }) {
  const [ref, largeur] = useLargeur<HTMLDivElement>();
  const [survol, setSurvol] = useState<number | null>(null);
  const max = Math.max(1, ...points.flatMap((point) => seriesDossiers.map(([cle]) => point[cle])));
  const ticks = graduations(max);
  const haut = ticks[ticks.length - 1];
  const zone = { largeur: Math.max(0, largeur - marges.gauche - marges.droite), hauteur: hauteurGraphe - marges.haut - marges.bas };
  const x = (index: number) => marges.gauche + (points.length <= 1 ? zone.largeur / 2 : (index / (points.length - 1)) * zone.largeur);
  const y = (valeur: number) => marges.haut + zone.hauteur - (valeur / haut) * zone.hauteur;
  function suivre(event: React.PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = event.clientX - rect.left - marges.gauche;
    setSurvol(Math.min(points.length - 1, Math.max(0, Math.round(points.length <= 1 ? 0 : (position / zone.largeur) * (points.length - 1)))));
  }
  return <div ref={ref} className="cd-plot">
    <Legende elements={seriesDossiers.map(([, nom], index) => ({ nom, couleur: series[index] }))} />
    {largeur > 0 && <svg width={largeur} height={hauteurGraphe} role="img" aria-label="Évolution des nouveaux dossiers, gagnés et perdus" onPointerMove={suivre} onPointerDown={suivre} onPointerLeave={() => setSurvol(null)}>
      <Axes largeur={largeur} ticks={ticks} max={haut} etiquettes={etiquettesX(points, unite, x, largeur)} />
      {survol !== null && <line x1={x(survol)} x2={x(survol)} y1={marges.haut} y2={marges.haut + zone.hauteur} className="cd-crosshair" />}
      {seriesDossiers.map(([cle], index) => <g key={cle}>
        <polyline fill="none" stroke={series[index]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" points={points.map((point, position) => `${x(position)},${y(point[cle])}`).join(" ")} />
        {points.length > 0 && <circle cx={x(points.length - 1)} cy={y(points[points.length - 1][cle])} r={4} fill={series[index]} className="cd-dot" />}
        {survol !== null && <circle cx={x(survol)} cy={y(points[survol][cle])} r={5} fill={series[index]} className="cd-dot" />}
      </g>)}
    </svg>}
    {survol !== null && points[survol] && <div className="cd-tooltip" style={positionInfobulle(x(survol), largeur)}><strong>{libellePeriode(points[survol].debut, unite)}</strong>{seriesDossiers.map(([cle, nom], index) => <span key={cle}><i style={{ background: series[index] }} />{nom}<b>{nombre(points[survol][cle])}</b></span>)}</div>}
  </div>;
}

function Colonnes({ points, unite }: { points: Point[]; unite: Tableau["unite"] }) {
  const [ref, largeur] = useLargeur<HTMLDivElement>();
  const [survol, setSurvol] = useState<number | null>(null);
  const totaux = points.map((point) => typesActions.reduce((somme, [cle]) => somme + point[cle], 0));
  const ticks = graduations(Math.max(1, ...totaux));
  const haut = ticks[ticks.length - 1];
  const zone = { largeur: Math.max(0, largeur - marges.gauche - marges.droite), hauteur: hauteurGraphe - marges.haut - marges.bas };
  const bande = points.length ? zone.largeur / points.length : 0;
  const epaisseur = Math.max(4, Math.min(24, bande * 0.6));
  const x = (index: number) => marges.gauche + bande * index + bande / 2;
  const hauteur = (valeur: number) => (valeur / haut) * zone.hauteur;
  return <div ref={ref} className="cd-plot">
    <Legende elements={typesActions.map(([, nom], index) => ({ nom, couleur: series[index] }))} />
    {largeur > 0 && <svg width={largeur} height={hauteurGraphe} role="img" aria-label="Actions faites par type et par période" onPointerLeave={() => setSurvol(null)}>
      <Axes largeur={largeur} ticks={ticks} max={haut} etiquettes={etiquettesX(points, unite, x, largeur)} />
      {points.map((point, index) => {
        let base = marges.haut + zone.hauteur;
        const segments = typesActions.map(([cle], position) => ({ cle, valeur: point[cle], couleur: series[position] })).filter((segment) => segment.valeur > 0);
        return <g key={point.debut} onPointerEnter={() => setSurvol(index)} onPointerDown={() => setSurvol(index)}>
          <rect x={x(index) - bande / 2} y={marges.haut} width={bande} height={zone.hauteur} fill="transparent" />
          {segments.map((segment, position) => {
            const h = hauteur(segment.valeur);
            // Écart de 2px entre segments ; seul le sommet de la pile est arrondi.
            const hauteurVisible = Math.max(1, h - (position < segments.length - 1 ? 2 : 0));
            base -= h;
            const dernier = position === segments.length - 1;
            const r = dernier ? Math.min(4, hauteurVisible / 2, epaisseur / 2) : 0;
            const x0 = x(index) - epaisseur / 2;
            const y0 = base + (h - hauteurVisible);
            return <path key={segment.cle} fill={segment.couleur} opacity={survol === null || survol === index ? 1 : 0.45}
              d={`M${x0},${y0 + hauteurVisible} V${y0 + r} Q${x0},${y0} ${x0 + r},${y0} H${x0 + epaisseur - r} Q${x0 + epaisseur},${y0} ${x0 + epaisseur},${y0 + r} V${y0 + hauteurVisible} Z`} />;
          })}
        </g>;
      })}
    </svg>}
    {survol !== null && points[survol] && <div className="cd-tooltip" style={positionInfobulle(x(survol), largeur)}><strong>{libellePeriode(points[survol].debut, unite)} · {nombre(totaux[survol])}</strong>{typesActions.map(([cle, nom], index) => <span key={cle}><i style={{ background: series[index] }} />{nom}<b>{nombre(points[survol][cle])}</b></span>)}</div>}
  </div>;
}

function Indicateur({ libelle, valeur, precedent, aide, alerte = false, inverse = false }: {
  libelle: string; valeur: string; precedent?: { actuel: number; avant: number }; aide?: string; alerte?: boolean; inverse?: boolean;
}) {
  const ecart = precedent ? precedent.actuel - precedent.avant : 0;
  const favorable = inverse ? ecart < 0 : ecart > 0;
  return <div className={`cd-kpi ${alerte ? "cd-alert" : ""}`}>
    <span className="cd-kpi-label">{alerte && <AlertTriangle size={14} aria-label="Point d’attention" />}{libelle}</span>
    <strong>{valeur}</strong>
    {precedent && <span className={`cd-delta ${ecart === 0 ? "" : favorable ? "up" : "down"}`}>{ecart === 0 ? "=" : ecart > 0 ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}{ecart === 0 ? " stable" : ` ${ecart > 0 ? "+" : ""}${nombre(ecart)}`} vs période précédente</span>}
    {aide && <span className="cd-kpi-help">{aide}</span>}
  </div>;
}

const metriquesAgents = [["gagnes", "Gagnés"], ["nouveaux", "Nouveaux dossiers"], ["actions", "Actions faites"], ["conversion", "Taux de conversion"], ["portefeuille", "Portefeuille en cours"], ["en_retard", "Actions en retard"]] as const;

export function CommercialDashboard({ client, organisationId, debut, fin, agents = [], equipe = true, refreshKey = 0 }: {
  client: SupabaseClient;
  organisationId: string;
  debut: string;
  fin: string;
  agents?: { user_id: string; nom: string }[];
  equipe?: boolean;
  refreshKey?: number;
}) {
  const [agent, setAgent] = useState("");
  const [donnees, setDonnees] = useState<Tableau | null>(null);
  const [erreur, setErreur] = useState("");
  const [chargement, setChargement] = useState(true);
  const [metrique, setMetrique] = useState<typeof metriquesAgents[number][0]>("gagnes");
  const requete = useRef(0);

  useEffect(() => {
    if (!debut || !fin || debut > fin) return;
    const courante = ++requete.current;
    setChargement(true);
    void Promise.resolve(client.rpc("crm_tableau_de_bord", { p_organisation_id: organisationId, p_debut: debut, p_fin: fin, p_owner_id: agent || null }))
      .then(({ data, error }) => {
        if (courante !== requete.current) return;
        if (error) setErreur(`Indicateurs indisponibles : ${error.message}`);
        else { setErreur(""); setDonnees(data as Tableau); }
      }).catch(() => { if (courante === requete.current) setErreur("Indicateurs indisponibles hors connexion."); })
      .finally(() => { if (courante === requete.current) setChargement(false); });
  }, [agent, client, debut, fin, organisationId, refreshKey]);

  const classement = useMemo(() => (donnees?.agents ?? []).map((item) => ({
    ...item, conversion: item.gagnes + item.perdus ? item.gagnes / (item.gagnes + item.perdus) : 0,
  })).filter((item) => item.actif || item.portefeuille + item.nouveaux + item.gagnes + item.actions > 0)
    .sort((a, b) => b[metrique] - a[metrique] || a.nom.localeCompare(b.nom, "fr")), [donnees, metrique]);

  if (erreur && !donnees) return <p className="cd-error" role="status">{erreur}</p>;
  if (!donnees) return <p className="cd-empty">Calcul des indicateurs…</p>;
  const { dossiers: d, actions: a, unite } = donnees;
  const clotures = d.gagnes + d.perdus;
  const etapes = ordreEtapes.map((cle) => ({ libelle: libelles[cle], valeur: donnees.etapes.find((item) => item.cle === cle)?.nombre ?? 0 }));
  const compte = (liste: Compte[]) => liste.map((item) => ({ libelle: libelles[item.cle] ?? item.cle, valeur: item.nombre }));
  const tableauDe = (titre: string, liste: { libelle: string; valeur: number }[]) => ({ colonnes: [titre, "Nombre"], lignes: liste.map((item) => [item.libelle, item.valeur]) });
  const periode = (point: Point) => libellePeriode(point.debut, unite);

  return <div className={`cd ${chargement ? "cd-loading" : ""}`} aria-busy={chargement}>
    <style>{styles}</style>
    {equipe && agents.length > 0 && <div className="cd-filters"><label>Agent<select value={agent} onChange={(event) => setAgent(event.target.value)}><option value="">Toute l’équipe</option>{agents.map((item) => <option key={item.user_id} value={item.user_id}>{item.nom}</option>)}</select></label>{erreur && <span className="cd-error-inline">{erreur}</span>}</div>}
    <div className="cd-kpis">
      <Indicateur libelle="Nouveaux dossiers" valeur={nombre(d.nouveaux)} precedent={{ actuel: d.nouveaux, avant: d.nouveaux_prec }} />
      <Indicateur libelle="Dossiers gagnés" valeur={nombre(d.gagnes)} precedent={{ actuel: d.gagnes, avant: d.gagnes_prec }} />
      <Indicateur libelle="Taux de conversion" valeur={clotures ? pourcent(d.gagnes / clotures) : "—"} aide={`${d.gagnes} gagné${d.gagnes > 1 ? "s" : ""} sur ${clotures} clôturé${clotures > 1 ? "s" : ""}`} />
      <Indicateur libelle="Actions faites" valeur={nombre(a.total)} precedent={{ actuel: a.total, avant: a.total_prec }} />
      <Indicateur libelle="Dossiers en cours" valeur={nombre(d.actifs)} aide={`${d.chauds} chaud${d.chauds > 1 ? "s" : ""}${equipe && !agent ? ` · ${d.non_attribues} non attribué${d.non_attribues > 1 ? "s" : ""}` : ""}`} />
      <Indicateur libelle="Actions en retard" valeur={nombre(a.en_retard)} alerte={a.en_retard > 0} aide={`${a.a_venir} à venir`} />
      <Indicateur libelle="Dossiers sans prochaine action" valeur={nombre(d.sans_action)} alerte={d.sans_action > 0} aide="Dossiers en cours sans action programmée" />
      <Indicateur libelle="Délai moyen de gain" valeur={d.delai_gain_jours === null ? "—" : `${nombre(Number(d.delai_gain_jours))} j`} aide="De la création au gain" />
    </div>
    <div className="cd-cards">
      <Carte large titre="Évolution des dossiers" sousTitre={`Par ${unite === "day" ? "jour" : unite === "week" ? "semaine" : "mois"}`} tableau={{ colonnes: ["Période", ...seriesDossiers.map(([, nom]) => nom)], lignes: donnees.serie.map((point) => [periode(point), ...seriesDossiers.map(([cle]) => point[cle])]) }}>
        <Courbes points={donnees.serie} unite={unite} />
      </Carte>
      <Carte large titre="Actions faites par type" sousTitre={typesActions.map(([cle, nom]) => `${nom} ${nombre(a[cle])}`).join(" · ")} tableau={{ colonnes: ["Période", ...typesActions.map(([, nom]) => nom), "Total"], lignes: donnees.serie.map((point) => [periode(point), ...typesActions.map(([cle]) => point[cle]), typesActions.reduce((somme, [cle]) => somme + point[cle], 0)]) }}>
        <Colonnes points={donnees.serie} unite={unite} />
      </Carte>
      <Carte titre="Dossiers par étape" sousTitre="Portefeuille non archivé, état actuel" tableau={tableauDe("Étape", etapes)}><Barres donnees={etapes} vide="Aucun dossier." /></Carte>
      <Carte titre="Température des dossiers en cours" tableau={tableauDe("Température", compte(donnees.temperatures))}><Barres donnees={compte(donnees.temperatures)} vide="Aucun dossier en cours." /></Carte>
      <Carte titre="Sources des nouveaux dossiers" tableau={tableauDe("Source", compte(donnees.sources))}><Barres donnees={compte(donnees.sources)} /></Carte>
      <Carte titre="Services demandés" sousTitre="Nouveaux dossiers de la période" tableau={tableauDe("Service", compte(donnees.services))}><Barres donnees={compte(donnees.services)} /></Carte>
      <Carte titre="Communes des nouveaux dossiers" sousTitre="10 premières" tableau={tableauDe("Commune", compte(donnees.localites))}><Barres donnees={compte(donnees.localites)} /></Carte>
      <Carte titre="Raisons de perte" sousTitre={`${d.perdus} dossier${d.perdus > 1 ? "s" : ""} perdu${d.perdus > 1 ? "s" : ""} sur la période`} tableau={tableauDe("Raison", compte(donnees.motifs_perte))}><Barres donnees={compte(donnees.motifs_perte)} vide="Aucune perte sur la période." /></Carte>
      <Carte titre="Raisons d’archivage" sousTitre={`${d.archives} dossier${d.archives > 1 ? "s" : ""} archivé${d.archives > 1 ? "s" : ""}`} tableau={tableauDe("Raison", compte(donnees.motifs_archivage))}><Barres donnees={compte(donnees.motifs_archivage)} vide="Aucun archivage sur la période." /></Carte>
      {equipe && !agent && classement.length > 0 && <Carte large titre="Classement des agents" sousTitre="Agents actifs et inactifs ayant encore de l’activité" tableau={{ colonnes: ["Agent", "Statut", ...metriquesAgents.map(([, nom]) => nom)], lignes: classement.map((item) => [item.nom, item.actif ? "Actif" : "Inactif", item.gagnes, item.nouveaux, item.actions, pourcent(item.conversion), item.portefeuille, item.en_retard]) }}>
        <div className="cd-filters cd-filters-inline"><label>Classer par<select value={metrique} onChange={(event) => setMetrique(event.target.value as typeof metrique)}>{metriquesAgents.map(([cle, nom]) => <option key={cle} value={cle}>{nom}</option>)}</select></label></div>
        <Barres donnees={classement.map((item) => ({
          libelle: `${item.nom}${item.actif ? "" : " (inactif)"}`,
          valeur: metrique === "conversion" ? Math.round(item.conversion * 100) : item[metrique],
          detail: metrique === "conversion" ? `% · ${item.gagnes}/${item.gagnes + item.perdus}` : undefined,
        }))} vide="Aucune activité sur la période." />
      </Carte>}
    </div>
  </div>;
}

const styles = `
.cd { --cd-surface: #ffffff; --cd-text: #0d2146; --cd-text-2: #52647d; --cd-muted: #8b9aaf; --cd-line: #e6eaf1; --cd-grid: #edf0f5;
  --cd-accent: #2a78d6; --cd-warning: #a24f06; --cd-warning-bg: #fff4e8; --cd-good: #197143; --cd-bad: #a23c49;
  display: grid; gap: 14px; color: var(--cd-text); font-variant-numeric: normal; transition: opacity .2s; }
.cd.cd-loading { opacity: .6; }
.cd-filters { display: flex; flex-wrap: wrap; align-items: end; gap: 10px; }
.cd-filters label { display: grid; gap: 4px; color: var(--cd-text-2); font-size: 12px; font-weight: 600; }
.cd-filters select { min-width: 180px; padding: 8px 10px; border: 1px solid #cfd8e5; border-radius: 10px; background: var(--cd-surface); color: var(--cd-text); font-size: 13px; }
.cd-filters-inline { margin-bottom: 10px; }
.cd-error, .cd-error-inline { color: var(--cd-bad); font-size: 13px; }
.cd-kpis { display: grid; grid-template-columns: repeat(auto-fill, minmax(165px, 1fr)); gap: 10px; }
.cd-kpi { display: grid; gap: 4px; align-content: start; padding: 14px; border: 1px solid var(--cd-line); border-radius: 14px; background: var(--cd-surface); }
.cd-kpi strong { font-size: 26px; font-weight: 650; line-height: 1.1; }
.cd-kpi-label { display: flex; align-items: center; gap: 5px; color: var(--cd-text-2); font-size: 12px; font-weight: 600; }
.cd-kpi-help, .cd-delta { color: var(--cd-muted); font-size: 11px; }
.cd-delta { display: inline-flex; align-items: center; gap: 2px; }
.cd-delta.up { color: var(--cd-good); } .cd-delta.down { color: var(--cd-bad); }
.cd-kpi.cd-alert { border-color: #f3d3b0; background: var(--cd-warning-bg); }
.cd-kpi.cd-alert .cd-kpi-label { color: var(--cd-warning); }
.cd-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: 12px; }
.cd-card { min-width: 0; padding: 16px; border: 1px solid var(--cd-line); border-radius: 16px; background: var(--cd-surface); }
.cd-card.cd-wide { grid-column: 1 / -1; }
.cd-card header { display: flex; align-items: start; justify-content: space-between; gap: 10px; margin-bottom: 12px; }
.cd-card h3 { margin: 0; font-size: 15px; font-weight: 650; }
.cd-card header p { margin: 3px 0 0; color: var(--cd-muted); font-size: 12px; }
.cd-toggle { display: inline-flex; align-items: center; gap: 5px; flex: none; padding: 5px 9px; border: 1px solid var(--cd-line); border-radius: 9px; background: var(--cd-surface); color: var(--cd-text-2); font-size: 12px; font-weight: 600; cursor: pointer; }
.cd-legend { display: flex; flex-wrap: wrap; gap: 6px 14px; margin: 0 0 8px; padding: 0; list-style: none; color: var(--cd-text-2); font-size: 12px; }
.cd-legend li { display: inline-flex; align-items: center; gap: 6px; }
.cd-legend span { width: 10px; height: 10px; border-radius: 3px; }
.cd-plot { position: relative; min-width: 0; touch-action: pan-y; }
.cd-plot svg { display: block; overflow: visible; }
.cd-gridline { stroke: var(--cd-grid); stroke-width: 1; }
.cd-axis { fill: var(--cd-muted); font-size: 11px; font-variant-numeric: tabular-nums; }
.cd-crosshair { stroke: #b8c3d3; stroke-width: 1; }
.cd-dot { stroke: var(--cd-surface); stroke-width: 2; }
.cd-tooltip { position: absolute; top: 34px; z-index: 2; display: grid; gap: 3px; min-width: 160px; padding: 9px 11px; border: 1px solid var(--cd-line); border-radius: 10px; background: var(--cd-surface); box-shadow: 0 8px 24px rgba(13, 33, 70, .12); font-size: 12px; pointer-events: none; }
.cd-tooltip span { display: flex; align-items: center; gap: 6px; color: var(--cd-text-2); }
.cd-tooltip i { width: 8px; height: 8px; border-radius: 2px; }
.cd-tooltip b { margin-left: auto; color: var(--cd-text); font-variant-numeric: tabular-nums; }
.cd-bars { display: grid; gap: 9px; margin: 0; padding: 0; list-style: none; }
.cd-bars li { display: grid; grid-template-columns: minmax(90px, 38%) 1fr; align-items: center; gap: 10px; font-size: 12px; }
.cd-bar-label { overflow: hidden; color: var(--cd-text-2); text-overflow: ellipsis; white-space: nowrap; }
.cd-bar-track { display: flex; align-items: center; gap: 6px; min-width: 0; }
.cd-bar { height: 12px; max-width: calc(100% - 52px); border-radius: 0 4px 4px 0; background: var(--cd-accent); }
.cd-bar-value { flex: none; color: var(--cd-text); font-weight: 600; font-variant-numeric: tabular-nums; }
.cd-bars-stacked li { grid-template-columns: 1fr; gap: 4px; }
.cd-bars-stacked .cd-bar-label { white-space: normal; }
.cd-bar-value small { color: var(--cd-muted); font-weight: 500; }
.cd-empty { margin: 8px 0; color: var(--cd-muted); font-size: 13px; }
.cd-table-wrap { overflow-x: auto; }
.cd-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.cd-table th, .cd-table td { padding: 7px 8px; border-bottom: 1px solid var(--cd-line); text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
.cd-table th:first-child, .cd-table thead th:first-child { text-align: left; }
.cd-table thead th { color: var(--cd-muted); font-weight: 600; }
.cd-table tbody th { font-weight: 500; color: var(--cd-text); }
@media (max-width: 520px) { .cd-kpis { grid-template-columns: 1fr 1fr; } .cd-kpi strong { font-size: 22px; } .cd-bars li { grid-template-columns: minmax(80px, 42%) 1fr; } }
`;
