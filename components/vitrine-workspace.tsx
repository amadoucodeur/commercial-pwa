"use client";

import type { SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, ArrowRight, BadgeCheck, Bath, BedDouble, Building2, Car, Check, CircleDashed, Crosshair, ExternalLink,
  Eye, FileText, Globe2, ImagePlus, KeyRound, Layers3, Loader2, MapPin, Plus, Ruler, Search, Star, Trash2, X,
} from "lucide-react";
import {
  BUCKET, MAX_PHOTOS, ORG_VITRINE, SITE_URL, TYPES_IMAGE, ajouterPhotos, badgesSite, communesAbidjan, envoyerImage,
  erreurLisible, formatPrix, libellesContenus, nouveauBien, nouvelleFormule, payloadBien, payloadFormule,
  slugify, statutsBien, typesBien, urlPublique, verificationsPublication, visibilitesAdresse,
  type Bien, type CommercialSite, type Contenu, type Formule, type Photo, type SectionVitrine, sectionsVitrine,
} from "../lib/vitrine";

type Message = { ton: "ok" | "erreur" | "info"; texte: string } | null;
type Donnees = { biens?: Bien[]; ventes?: Bien[]; formules?: Formule[]; contenus?: Contenu[] };
type Edition = { type: "bien"; bien: Bien } | { type: "formule"; formule: Formule } | { type: "contenu"; contenu: Contenu } | null;

const entetes: Record<SectionVitrine, [string, string]> = {
  biens: ["Biens à louer", "Les annonces de location publiées sur trabad.com."],
  ventes: ["Biens à vendre", "Villas, terrains, appartements et locaux proposés à la vente."],
  formules: ["Formules de gestion", "Les offres de gestion locative présentées aux propriétaires."],
  contenus: ["Contenus du site", "Les textes et visuels des grandes sections du site."],
};
const iconesSection: Record<SectionVitrine, typeof KeyRound> = { biens: KeyRound, ventes: Building2, formules: Layers3, contenus: FileText };
const filtresBiens = [["tous", "Toutes"], ["en_ligne", "En ligne"], ["brouillon", "Brouillons"], ["sous_option", "Sous option"], ["vendu", "Vendues / louées"], ["archive", "Archivées"]] as const;
const champsBien = "*, site_bien_photos(id,chemin,ordre)";

const enLigneSurSite = (bien: Bien) => bien.publication === "publie" && (bien.statut === "disponible" || bien.statut === "sous_option");
const photoPrincipale = (bien: Bien) => [...(bien.site_bien_photos ?? [])].sort((a, b) => a.ordre - b.ordre)[0]?.chemin;
const libelle = (options: ReadonlyArray<readonly [string, string]>, valeur: string) => options.find(([cle]) => cle === valeur)?.[1] ?? valeur;
const pluriel = (n: number, mot: string) => `${n} ${mot}${n > 1 ? "s" : ""}`;

export function VitrineWorkspace({ client, canEdit, section, onSection, onglets, refreshKey, enLigne }: {
  client: SupabaseClient;
  canEdit: boolean;
  section: SectionVitrine;
  onSection?: (section: SectionVitrine) => void;
  onglets: boolean;
  refreshKey: number;
  enLigne: boolean;
}) {
  const [donnees, setDonnees] = useState<Donnees>({});
  const [chargement, setChargement] = useState<SectionVitrine | null>(null);
  const [erreur, setErreur] = useState("");
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState("tous");
  const [commerciaux, setCommerciaux] = useState<CommercialSite[]>([]);
  const [edition, setEdition] = useState<Edition>(null);
  const [toast, setToast] = useState("");
  const versions = useRef<Record<string, number>>({});
  const editable = canEdit && enLigne;
  const estBien = section === "biens" || section === "ventes";

  const charger = useCallback(async (cible: SectionVitrine) => {
    const version = (versions.current[cible] ?? 0) + 1;
    versions.current[cible] = version;
    setChargement(cible);
    setErreur("");
    try {
      const requete = cible === "formules"
        ? client.from("site_formules").select("*").eq("organisation_id", ORG_VITRINE).order("ordre")
        : cible === "contenus"
          ? client.from("site_contenus").select("*").eq("organisation_id", ORG_VITRINE).order("cle")
          : client.from("site_biens").select(champsBien).eq("organisation_id", ORG_VITRINE)
            .eq("categorie", cible === "ventes" ? "vente" : "location").order("created_at", { ascending: false }).limit(500);
      const { data, error } = await requete;
      if (versions.current[cible] !== version) return;
      if (error) throw error;
      setDonnees((courantes) => ({ ...courantes, [cible]: data ?? [] }));
    } catch (raison) {
      if (versions.current[cible] === version) setErreur(`Chargement impossible : ${erreurLisible(raison)}`);
    } finally {
      if (versions.current[cible] === version) setChargement((courant) => courant === cible ? null : courant);
    }
  }, [client]);

  // Les données déjà chargées restent affichées pendant l'actualisation : le changement d'onglet est instantané.
  useEffect(() => { if (enLigne) void charger(section); }, [charger, section, refreshKey, enLigne]);
  useEffect(() => { setRecherche(""); setFiltre("tous"); }, [section]);
  useEffect(() => {
    if (!estBien || !enLigne) return;
    let actif = true;
    void Promise.resolve(client.from("site_commerciaux").select("id,nom").eq("organisation_id", ORG_VITRINE).eq("actif", true).order("nom"))
      .then(({ data }) => { if (actif && data) setCommerciaux(data); }).catch(() => undefined);
    return () => { actif = false; };
  }, [client, estBien, enLigne, refreshKey]);
  useEffect(() => {
    if (!toast) return;
    const minuteur = window.setTimeout(() => setToast(""), 4000);
    return () => window.clearTimeout(minuteur);
  }, [toast]);

  const lignes = donnees[section];
  const premierChargement = !lignes && (chargement === section || enLigne);

  const biensVisibles = useMemo(() => {
    if (!estBien) return [];
    const terme = recherche.trim().toLocaleLowerCase("fr-FR");
    return ((lignes ?? []) as Bien[]).filter((bien) => {
      const correspond = !terme || [bien.titre, bien.reference, bien.type_bien, bien.commune, bien.quartier, bien.ville]
        .filter(Boolean).join(" ").toLocaleLowerCase("fr-FR").includes(terme);
      const garde = filtre === "tous" || (filtre === "en_ligne" ? enLigneSurSite(bien)
        : filtre === "brouillon" ? bien.publication === "brouillon" : bien.statut === filtre);
      return correspond && garde;
    });
  }, [estBien, filtre, lignes, recherche]);

  function majBien(bien: Bien) {
    const cible: SectionVitrine = bien.categorie === "vente" ? "ventes" : "biens";
    setDonnees((courantes) => {
      const liste = courantes[cible] ?? [];
      const existe = liste.some((item) => item.id === bien.id);
      return { ...courantes, [cible]: existe ? liste.map((item) => item.id === bien.id ? bien : item) : [bien, ...liste] };
    });
  }
  function retirerBien(id: string, categorie: Bien["categorie"]) {
    const cible: SectionVitrine = categorie === "vente" ? "ventes" : "biens";
    setDonnees((courantes) => ({ ...courantes, [cible]: (courantes[cible] ?? []).filter((item) => item.id !== id) }));
  }
  function majFormule(formule: Formule, supprimee = false) {
    setDonnees((courantes) => {
      const liste = (courantes.formules ?? []).filter((item) => item.id !== formule.id);
      return { ...courantes, formules: supprimee ? liste : [...liste, formule].sort((a, b) => Number(a.ordre) - Number(b.ordre)) };
    });
  }
  function majContenu(contenu: Contenu) {
    setDonnees((courantes) => ({ ...courantes, contenus: (courantes.contenus ?? []).map((item) => item.cle === contenu.cle ? contenu : item) }));
  }
  function creer() {
    if (!editable) return;
    if (estBien) setEdition({ type: "bien", bien: nouveauBien(section === "ventes" ? "vente" : "location") });
    else if (section === "formules") setEdition({ type: "formule", formule: nouvelleFormule((donnees.formules?.length ?? 0) + 1) });
  }

  const [titre, description] = entetes[section];
  const IconeSection = iconesSection[section];
  const peutCreer = editable && section !== "contenus";
  const libelleCreation = estBien ? "Nouvelle annonce" : "Nouvelle formule";
  const stats = estBien
    ? [["Annonces", (lignes ?? []).length], ["En ligne", ((lignes ?? []) as Bien[]).filter(enLigneSurSite).length], ["Brouillons", ((lignes ?? []) as Bien[]).filter((b) => b.publication === "brouillon").length]]
    : section === "formules"
      ? [["Formules", (lignes ?? []).length], ["Publiées", ((lignes ?? []) as Formule[]).filter((f) => f.publication === "publie").length], ["Brouillons", ((lignes ?? []) as Formule[]).filter((f) => f.publication === "brouillon").length]]
      : [["Sections", (lignes ?? []).length], ["Avec visuel", ((lignes ?? []) as Contenu[]).filter((c) => c.image_url).length], ["À compléter", ((lignes ?? []) as Contenu[]).filter((c) => !c.texte?.trim()).length]];

  return <div className="vt-workspace">
    <div className="vt-head">
      <div className="page-title">
        <p className="eyebrow">SITE VITRINE · TRABAD.COM</p>
        <h1>{titre}</h1>
        <p>{description}</p>
      </div>
      <div className="vt-head-actions">
        <a className="secondary-button" href={SITE_URL} target="_blank" rel="noopener noreferrer"><Globe2 size={17} /> Voir le site</a>
        {peutCreer && <button type="button" className="primary-button vt-create" onClick={creer}><Plus size={18} /> {libelleCreation}</button>}
      </div>
    </div>

    {onglets && onSection && <div className="vt-tabs" role="tablist" aria-label="Rubriques du site">
      {sectionsVitrine.map(([cle, nom]) => {
        const Icone = iconesSection[cle];
        return <button key={cle} type="button" role="tab" aria-selected={section === cle} className={section === cle ? "active" : ""} onClick={() => onSection(cle)}><Icone size={16} /> {nom}</button>;
      })}
    </div>}

    {!enLigne && <div className="warning vt-banner" role="status">Hors ligne : la gestion du site nécessite le réseau. Les données affichées peuvent être anciennes.</div>}
    {enLigne && !canEdit && <div className="toast vt-banner" role="status"><Eye size={16} /> Consultation seule : votre compte peut parcourir le site sans le modifier.</div>}
    {toast && <div className="toast vt-banner" role="status"><span><Check size={15} /> {toast}</span><button type="button" onClick={() => setToast("")} aria-label="Masquer"><X size={15} /></button></div>}
    {erreur && <div className="warning vt-banner" role="alert"><span>{erreur}</span> <button type="button" className="text-action" onClick={() => void charger(section)}>Réessayer</button></div>}

    <div className="vt-stats" aria-label="Résumé">
      {stats.map(([nom, valeur]) => <div key={String(nom)}><small>{nom}</small><strong>{lignes ? valeur : "—"}</strong></div>)}
    </div>

    {estBien && <div className="vt-toolbar">
      <label className="search-field"><Search size={17} /><input value={recherche} onChange={(event) => setRecherche(event.target.value)} placeholder="Titre, référence, commune…" aria-label="Rechercher une annonce" />{recherche && <button type="button" className="vt-clear" onClick={() => setRecherche("")} aria-label="Effacer"><X size={15} /></button>}</label>
      <div className="chips vt-chips" role="group" aria-label="Filtrer les annonces">{filtresBiens.map(([cle, nom]) => <button key={cle} type="button" className={filtre === cle ? "active" : ""} aria-pressed={filtre === cle} onClick={() => setFiltre(cle)}>{nom}</button>)}</div>
    </div>}

    {premierChargement && !lignes ? <div className="vt-grid" aria-busy="true" aria-label="Chargement">{[0, 1, 2, 3].map((i) => <div key={i} className="vt-skeleton" />)}</div>
      : !lignes ? null
      : lignes.length === 0 ? <div className="empty vt-empty"><span className="vt-empty-icon"><IconeSection size={22} /></span><strong>{section === "contenus" ? "Aucun contenu" : estBien ? "Aucune annonce pour le moment" : "Aucune formule"}</strong><p>{estBien ? "Créez une annonce en brouillon, ajoutez des photos puis publiez-la." : "Cette rubrique est vide."}</p>{peutCreer && <button type="button" className="secondary-button" onClick={creer}><Plus size={16} /> {libelleCreation}</button>}</div>
      : estBien ? biensVisibles.length === 0
        ? <div className="empty vt-empty"><strong>Aucun résultat</strong><p>Essayez un autre mot ou changez le filtre.</p></div>
        : <>
          <p className="vt-count">{pluriel(biensVisibles.length, "annonce")}{chargement === section ? " · actualisation…" : ""}</p>
          <div className="vt-grid">{biensVisibles.map((bien) => <CarteBien key={bien.id} bien={bien} client={client} onOpen={() => setEdition({ type: "bien", bien })} />)}</div>
        </>
      : section === "formules" ? <div className="vt-grid vt-grid-formules">{(lignes as Formule[]).map((formule) => <CarteFormule key={formule.id} formule={formule} onOpen={() => setEdition({ type: "formule", formule })} />)}</div>
      : <div className="vt-grid vt-grid-contenus">{(lignes as Contenu[]).map((contenu) => <CarteContenu key={contenu.cle} contenu={contenu} onOpen={() => setEdition({ type: "contenu", contenu })} />)}</div>}

    {peutCreer && <button type="button" className="fab vt-fab" onClick={creer} aria-label={libelleCreation}><Plus size={26} /></button>}

    {edition?.type === "bien" && <EditeurBien key={edition.bien.id ?? "nouveau"} client={client} canEdit={editable} initial={edition.bien} commerciaux={commerciaux}
      onClose={() => setEdition(null)} onSaved={majBien}
      onDeleted={(bien) => { retirerBien(bien.id!, bien.categorie); setEdition(null); setToast("Annonce supprimée."); }} />}
    {edition?.type === "formule" && <EditeurFormule key={edition.formule.id ?? "nouvelle"} client={client} canEdit={editable} initial={edition.formule}
      onClose={() => setEdition(null)} onSaved={(formule) => { majFormule(formule); setToast("Formule enregistrée."); }}
      onDeleted={(formule) => { majFormule(formule, true); setEdition(null); setToast("Formule supprimée."); }} />}
    {edition?.type === "contenu" && <EditeurContenu key={edition.contenu.cle} client={client} canEdit={editable} initial={edition.contenu}
      onClose={() => setEdition(null)} onSaved={(contenu) => { majContenu(contenu); setEdition(null); setToast("Contenu mis à jour sur le site."); }} />}
  </div>;
}

function CarteBien({ bien, client, onOpen }: { bien: Bien; client: SupabaseClient; onOpen: () => void }) {
  const photo = photoPrincipale(bien);
  const enLigneSite = enLigneSurSite(bien);
  const lieu = [bien.quartier, bien.commune, bien.ville].filter(Boolean).join(", ");
  return <button type="button" className="vt-card" onClick={onOpen}>
    <span className="vt-card-media">
      {photo ? <img src={urlPublique(client, photo)} alt="" loading="lazy" decoding="async" /> : <span className="vt-card-placeholder"><ImagePlus size={26} /><small>Aucune photo</small></span>}
      <span className={`vt-pill ${enLigneSite ? "on" : bien.publication === "publie" ? "warn" : ""}`}>{enLigneSite ? "En ligne" : bien.publication === "publie" ? "Publiée · masquée" : "Brouillon"}</span>
      {bien.en_vedette && <span className="vt-star" title="En vedette"><Star size={13} fill="currentColor" /></span>}
      {(bien.site_bien_photos?.length ?? 0) > 1 && <span className="vt-photo-count"><ImagePlus size={12} /> {bien.site_bien_photos!.length}</span>}
    </span>
    <span className="vt-card-body">
      <small>{bien.reference} · {bien.type_bien}</small>
      <strong>{bien.titre || "Sans titre"}</strong>
      {lieu && <span className="vt-card-place"><MapPin size={13} /> {lieu}</span>}
      <span className="vt-card-specs">
        {bien.surface ? <span><Ruler size={13} /> {bien.surface} m²</span> : null}
        {bien.chambres ? <span><BedDouble size={13} /> {bien.chambres}</span> : null}
        {bien.salles_de_bain ? <span><Bath size={13} /> {bien.salles_de_bain}</span> : null}
      </span>
      <span className="vt-card-foot"><b>{formatPrix(bien)}</b>{bien.statut !== "disponible" && <em data-statut={bien.statut}>{libelle(statutsBien, bien.statut)}</em>}</span>
    </span>
  </button>;
}

function CarteFormule({ formule, onOpen }: { formule: Formule; onOpen: () => void }) {
  return <button type="button" className={`vt-formule ${formule.recommande ? "recommandee" : ""}`} onClick={onOpen}>
    <span className="vt-formule-top"><span className={`vt-pill static ${formule.publication === "publie" ? "on" : ""}`}>{formule.publication === "publie" ? "Publiée" : "Brouillon"}</span>{formule.recommande && <span className="vt-reco"><BadgeCheck size={14} /> Recommandée</span>}</span>
    <strong>{formule.nom}</strong>
    <small>{formule.accroche || "Sans accroche"}</small>
    <span className="vt-formule-taux"><b>{Number(formule.commission).toLocaleString("fr-FR")} %</b> de commission{formule.jour_reversement ? ` · reversement le ${formule.jour_reversement}` : ""}</span>
    <span className="vt-formule-liste">{formule.avantages.slice(0, 3).map((item) => <span key={item}><Check size={13} /> {item}</span>)}{formule.avantages.length > 3 && <em>+ {formule.avantages.length - 3} autre{formule.avantages.length - 3 > 1 ? "s" : ""}</em>}</span>
  </button>;
}

function CarteContenu({ contenu, onOpen }: { contenu: Contenu; onOpen: () => void }) {
  const [nom, aide] = libellesContenus[contenu.cle] ?? [contenu.cle, "Section du site"];
  return <button type="button" className="vt-contenu" onClick={onOpen}>
    <span className="vt-contenu-media">{contenu.image_url ? <img src={contenu.image_url} alt="" loading="lazy" decoding="async" /> : <span className="vt-card-placeholder"><FileText size={24} /><small>Sans visuel</small></span>}</span>
    <span className="vt-card-body"><small>{nom.toUpperCase()}</small><strong>{contenu.titre || "Titre à rédiger"}</strong><span className="vt-contenu-texte">{contenu.texte || aide}</span></span>
  </button>;
}

// Fenêtre d'édition : feuille sur mobile, boîte centrée sur ordinateur. Échap et le fond ferment.
function Feuille({ titre, onClose, children, pied, large }: { titre: string; onClose: () => void; children: React.ReactNode; pied?: React.ReactNode; large?: boolean }) {
  const fermer = useRef(onClose);
  fermer.current = onClose;
  useEffect(() => {
    const precedent = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const touche = (event: KeyboardEvent) => { if (event.key === "Escape") fermer.current(); };
    window.addEventListener("keydown", touche);
    return () => { document.body.style.overflow = precedent; window.removeEventListener("keydown", touche); };
  }, []);
  return <div className="sheet-backdrop" onClick={onClose}>
    <section className={`sheet vt-sheet ${large ? "vt-sheet-large" : ""}`} role="dialog" aria-modal="true" aria-label={titre} onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" />
      <div className="sheet-head"><button type="button" className="icon-button" onClick={onClose} aria-label="Retour"><ArrowLeft size={20} /></button><span>{titre.toUpperCase()}</span><button type="button" className="icon-button" onClick={onClose} aria-label="Fermer"><X size={20} /></button></div>
      <div className="sheet-body vt-sheet-body">{children}</div>
      {pied && <div className="vt-sheet-foot">{pied}</div>}
    </section>
  </div>;
}

function Interrupteur({ actif, onChange, children, disabled }: { actif: boolean; onChange: (valeur: boolean) => void; children: React.ReactNode; disabled?: boolean }) {
  return <button type="button" role="switch" aria-checked={actif} className={`vt-switch ${actif ? "on" : ""}`} disabled={disabled} onClick={() => onChange(!actif)}><span className="vt-switch-track"><span /></span>{children}</button>;
}

function Segments<T extends string>({ valeur, options, onChange, disabled, desactivees, label }: {
  valeur: T; options: ReadonlyArray<readonly [T, string]>; onChange: (valeur: T) => void; disabled?: boolean; desactivees?: T[]; label: string;
}) {
  return <div className="vt-segments" role="radiogroup" aria-label={label}>{options.map(([cle, nom]) => <button key={cle} type="button" role="radio" aria-checked={valeur === cle} className={valeur === cle ? "active" : ""} disabled={disabled || desactivees?.includes(cle)} onClick={() => onChange(cle)}>{nom}</button>)}</div>;
}

function ListeEditable({ titre, aide, items, onChange, disabled, placeholder }: { titre: string; aide?: string; items: string[]; onChange: (items: string[]) => void; disabled?: boolean; placeholder: string }) {
  const [nouveau, setNouveau] = useState("");
  const ajouter = () => { const texte = nouveau.trim(); if (!texte) return; onChange([...items, texte]); setNouveau(""); };
  return <div className="vt-list-editor">
    <span className="vt-label">{titre}</span>
    {aide && <p className="vt-help">{aide}</p>}
    <ul>{items.map((item, index) => <li key={`${index}-${item}`}>
      <input value={item} disabled={disabled} aria-label={`${titre} ${index + 1}`} onChange={(event) => onChange(items.map((courant, i) => i === index ? event.target.value : courant))} onBlur={() => { if (!items[index].trim()) onChange(items.filter((_, i) => i !== index)); }} />
      {!disabled && <button type="button" className="vt-icon-danger" onClick={() => onChange(items.filter((_, i) => i !== index))} aria-label="Retirer"><X size={15} /></button>}
    </li>)}</ul>
    {!disabled && <div className="vt-list-add"><input value={nouveau} placeholder={placeholder} onChange={(event) => setNouveau(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); ajouter(); } }} /><button type="button" className="secondary-button" onClick={ajouter} disabled={!nouveau.trim()}><Plus size={16} /> Ajouter</button></div>}
  </div>;
}

function Retour({ message }: { message: Message }) {
  if (!message) return null;
  return <div className={`vt-feedback ${message.ton}`} role={message.ton === "erreur" ? "alert" : "status"}>{message.texte}</div>;
}

function ApercuFichier({ fichier }: { fichier: File }) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const lien = URL.createObjectURL(fichier);
    setUrl(lien);
    return () => URL.revokeObjectURL(lien);
  }, [fichier]);
  return url ? <img src={url} alt="" /> : null;
}

const instantaneBien = (bien: Bien) => JSON.stringify(payloadBien(bien));

function EditeurBien({ client, canEdit, initial, commerciaux, onClose, onSaved, onDeleted }: {
  client: SupabaseClient; canEdit: boolean; initial: Bien; commerciaux: CommercialSite[];
  onClose: () => void; onSaved: (bien: Bien) => void; onDeleted: (bien: Bien) => void;
}) {
  const [bien, setBien] = useState<Bien>(initial);
  const [base, setBase] = useState(() => instantaneBien(initial));
  const [publieEnBase, setPublieEnBase] = useState(initial.publication === "publie");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosChargees, setPhotosChargees] = useState(!initial.id);
  const [enAttente, setEnAttente] = useState<File[]>([]);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const [gps, setGps] = useState(false);
  const fichierRef = useRef<HTMLInputElement>(null);
  const nouveau = !bien.id;
  const modifie = instantaneBien(bien) !== base || (nouveau && enAttente.length > 0);
  const nombrePhotos = photos.length + (nouveau ? enAttente.length : 0);
  const verifications = verificationsPublication(bien, nombrePhotos);
  const pret = verifications.every((item) => item.ok);
  const description = bien.description.trim().length;

  useEffect(() => {
    if (!initial.id) return;
    let actif = true;
    void Promise.resolve(client.from("site_bien_photos").select("id,bien_id,chemin,alt,ordre").eq("bien_id", initial.id).order("ordre"))
      .then(({ data, error }) => {
        if (!actif) return;
        if (error) setMessage({ ton: "erreur", texte: `Photos indisponibles : ${erreurLisible(error)}` });
        else setPhotos((data ?? []) as Photo[]);
        setPhotosChargees(true);
      });
    return () => { actif = false; };
    // Le client change à chaque renouvellement de jeton : inutile de recharger les photos pour autant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initial.id]);

  const changer = <K extends keyof Bien>(cle: K, valeur: Bien[K]) => setBien((courant) => ({ ...courant, [cle]: valeur }));
  const fermer = () => { if (!occupe && (!modifie || window.confirm("Abandonner les modifications non enregistrées ?"))) onClose(); };
  const avecPhotos = (b: Bien, liste: Photo[]): Bien => ({ ...b, site_bien_photos: liste.map(({ id, chemin, ordre }) => ({ id, chemin, ordre })) });

  async function enregistrer() {
    if (!canEdit || occupe) return;
    if (bien.titre.trim().length < 5) { setMessage({ ton: "erreur", texte: "Donnez un titre d’au moins 5 caractères." }); return; }
    if (!bien.type_bien.trim() || !bien.ville.trim()) { setMessage({ ton: "erreur", texte: "Renseignez le type de bien et la ville." }); return; }
    if (bien.publication === "publie" && !pret) { setMessage({ ton: "erreur", texte: "Complétez la liste « Prêt à publier » ou gardez l’annonce en brouillon." }); return; }
    setOccupe("Enregistrement…");
    setMessage(null);
    try {
      const payload = payloadBien(bien);
      const publierApres = nouveau && payload.publication === "publie";
      if (publierApres) payload.publication = "brouillon";
      const requete = nouveau
        ? client.from("site_biens").insert({ ...payload, organisation_id: ORG_VITRINE }).select(champsBien).single()
        : client.from("site_biens").update(payload).eq("id", bien.id!).eq("organisation_id", ORG_VITRINE).select(champsBien).single();
      const { data, error } = await requete;
      if (error) throw error;
      let enregistre = data as Bien;
      let liste = photos;
      const textes: string[] = [nouveau ? "Annonce créée." : "Modifications enregistrées."];
      let avertissement = false;
      if (nouveau && enAttente.length) {
        const resultat = await ajouterPhotos(client, enregistre.id!, enregistre.titre, enAttente, 0, (fait, total) => setOccupe(`Envoi des photos ${Math.min(fait + 1, total)}/${total}…`));
        liste = resultat.ajoutees;
        setPhotos(liste);
        setEnAttente(resultat.echecs);
        if (resultat.ajoutees.length) textes.push(`${pluriel(resultat.ajoutees.length, "photo")} ajoutée${resultat.ajoutees.length > 1 ? "s" : ""}.`);
        textes.push(...resultat.erreurs);
        avertissement = resultat.erreurs.length > 0;
      }
      if (publierApres) {
        if (liste.length) {
          const publie = await client.from("site_biens").update({ publication: "publie" }).eq("id", enregistre.id!).select(champsBien).single();
          if (publie.error) { textes.push(`Publication impossible : ${erreurLisible(publie.error)}`); avertissement = true; }
          else { enregistre = publie.data as Bien; textes.push("Annonce en ligne."); }
        } else { textes.push("L’annonce reste en brouillon tant qu’aucune photo n’est enregistrée."); avertissement = true; }
      }
      const complet = avecPhotos(enregistre, liste);
      setBien(complet);
      setBase(instantaneBien(complet));
      setPublieEnBase(complet.publication === "publie");
      onSaved(complet);
      setMessage({ ton: avertissement ? "info" : "ok", texte: textes.join(" ") });
    } catch (erreur) {
      setMessage({ ton: "erreur", texte: erreurLisible(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  function choisirFichiers(fichiers: File[]) {
    if (!fichiers.length) return;
    const valides = fichiers.filter((fichier) => TYPES_IMAGE.includes(fichier.type));
    const refuses = fichiers.length - valides.length;
    if (nouveau) {
      const place = MAX_PHOTOS - enAttente.length;
      setEnAttente((courant) => [...courant, ...valides.slice(0, place)]);
      setMessage(refuses || valides.length > place
        ? { ton: "info", texte: `Certaines images n’ont pas été retenues : JPG, PNG, WebP ou AVIF, ${MAX_PHOTOS} photos maximum.` } : null);
    } else void envoyer(valides, refuses);
  }

  async function envoyer(fichiers: File[], refuses = 0) {
    if (!bien.id || !canEdit || !fichiers.length) return;
    setMessage(null);
    setOccupe("Préparation des photos…");
    const resultat = await ajouterPhotos(client, bien.id, bien.titre, fichiers, photos.length, (fait, total) => setOccupe(`Envoi des photos ${Math.min(fait + 1, total)}/${total}…`));
    const liste = [...photos, ...resultat.ajoutees];
    setPhotos(liste);
    setEnAttente(resultat.echecs);
    onSaved(avecPhotos(bienEnBase(), liste));
    const textes = [resultat.ajoutees.length ? `${pluriel(resultat.ajoutees.length, "photo")} ajoutée${resultat.ajoutees.length > 1 ? "s" : ""}.` : "Aucune photo ajoutée.", ...resultat.erreurs];
    if (refuses) textes.push(`${pluriel(refuses, "fichier")} ignoré${refuses > 1 ? "s" : ""} (format non pris en charge).`);
    setMessage({ ton: resultat.erreurs.length || refuses ? "info" : "ok", texte: textes.join(" ") });
    setOccupe(null);
  }

  async function reordonner(liste: Photo[], texte: string) {
    if (!canEdit || occupe) return;
    const precedente = photos;
    setPhotos(liste.map((photo, ordre) => ({ ...photo, ordre })));
    setOccupe("Mise à jour de l’ordre…");
    try {
      // Les mises à jour sont indépendantes : on les envoie ensemble.
      const resultats = await Promise.all(liste.map((photo, ordre) => photo.ordre === ordre ? null : client.from("site_bien_photos").update({ ordre }).eq("id", photo.id)));
      const echec = resultats.find((resultat) => resultat?.error)?.error;
      if (echec) throw echec;
      const rangees = liste.map((photo, ordre) => ({ ...photo, ordre }));
      onSaved(avecPhotos(bienEnBase(), rangees));
      setMessage({ ton: "ok", texte });
    } catch (erreur) {
      setPhotos(precedente);
      setMessage({ ton: "erreur", texte: `Ordre non enregistré : ${erreurLisible(erreur)}` });
    } finally {
      setOccupe(null);
    }
  }
  // La carte de la liste reflète la version enregistrée, pas le brouillon en cours.
  const bienEnBase = (): Bien => ({ ...bien, ...JSON.parse(base) });

  async function supprimerPhoto(photo: Photo) {
    if (!canEdit || occupe || !window.confirm("Retirer cette photo de l’annonce ?")) return;
    setOccupe("Suppression…");
    try {
      const { error } = await client.from("site_bien_photos").delete().eq("id", photo.id);
      if (error) throw error;
      await client.storage.from(BUCKET).remove([photo.chemin]);
      const liste = photos.filter((item) => item.id !== photo.id);
      setPhotos(liste);
      onSaved(avecPhotos(bienEnBase(), liste));
      setMessage({ ton: "ok", texte: "Photo retirée." });
    } catch (erreur) {
      setMessage({ ton: "erreur", texte: erreurLisible(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function legende(photo: Photo, alt: string) {
    if (!canEdit || alt === photo.alt) return;
    const { error } = await client.from("site_bien_photos").update({ alt }).eq("id", photo.id);
    if (error) setMessage({ ton: "erreur", texte: erreurLisible(error) });
    else setPhotos((liste) => liste.map((item) => item.id === photo.id ? { ...item, alt } : item));
  }

  async function supprimerAnnonce() {
    if (!bien.id || !canEdit || publieEnBase || occupe) return;
    if (!window.confirm(`Supprimer définitivement le brouillon « ${bien.titre} » et ses photos ?`)) return;
    setOccupe("Suppression…");
    try {
      const { error } = await client.from("site_biens").delete().eq("id", bien.id).eq("organisation_id", ORG_VITRINE);
      if (error) throw error;
      if (photos.length) await client.storage.from(BUCKET).remove(photos.map((photo) => photo.chemin));
      onDeleted(bien);
    } catch (erreur) {
      setMessage({ ton: "erreur", texte: erreurLisible(erreur) });
      setOccupe(null);
    }
  }

  function positionActuelle() {
    if (!navigator.geolocation) { setMessage({ ton: "erreur", texte: "GPS indisponible sur cet appareil." }); return; }
    setGps(true);
    navigator.geolocation.getCurrentPosition((position) => {
      setBien((courant) => ({ ...courant, latitude: position.coords.latitude.toFixed(7), longitude: position.coords.longitude.toFixed(7) }));
      setMessage({ ton: "info", texte: `Position ajoutée (précision ≈ ${Math.round(position.coords.accuracy)} m). Vérifiez qu’elle correspond bien au bien.` });
      setGps(false);
    }, () => { setMessage({ ton: "erreur", texte: "Position non obtenue. Autorisez l’accès à la localisation puis réessayez." }); setGps(false); },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 });
  }

  const desactive = !canEdit || !!occupe;
  const nombre = (cle: "prix" | "surface" | "chambres" | "salles_de_bain" | "parking", nom: string, icone?: React.ReactNode, suffixe?: string) =>
    <label className="field vt-field-number">{nom}<span className="vt-input-affix">{icone}<input type="number" inputMode="numeric" min={0} value={bien[cle] ?? ""} disabled={desactive} onChange={(event) => changer(cle, event.target.value)} />{suffixe && <em>{suffixe}</em>}</span></label>;

  const pied = canEdit ? <>
    {occupe ? <span className="vt-progress"><Loader2 size={16} className="vt-spin" /> {occupe}</span>
      : modifie ? <span className="vt-dirty">Modifications non enregistrées</span>
        : !nouveau && <span className="vt-saved"><Check size={15} /> À jour</span>}
    {!nouveau && !publieEnBase && <button type="button" className="vt-danger-button" onClick={() => void supprimerAnnonce()} disabled={!!occupe}><Trash2 size={16} /> <span>Supprimer</span></button>}
    <button type="button" className="primary-button vt-save" onClick={() => void enregistrer()} disabled={!!occupe || (!modifie && !nouveau)}>
      {nouveau ? bien.publication === "publie" ? "Créer et publier" : "Créer le brouillon" : "Enregistrer"} <ArrowRight size={17} />
    </button>
  </> : undefined;

  return <Feuille titre={nouveau ? "Nouvelle annonce" : bien.categorie === "vente" ? "Annonce de vente" : "Annonce de location"} onClose={fermer} pied={pied} large>
    <div className="vt-editor-head">
      <div>
        <p className="eyebrow">{bien.reference ?? (bien.categorie === "vente" ? "VENTE" : "LOCATION")}</p>
        <h2>{bien.titre || "Nouvelle annonce"}</h2>
        <p>{formatPrix(bien)}</p>
      </div>
      {publieEnBase && !modifie && bien.slug && <a className="vt-site-link" href={`${SITE_URL}/biens/${bien.slug}`} target="_blank" rel="noopener noreferrer">Voir sur le site <ExternalLink size={14} /></a>}
    </div>
    <Retour message={message} />

    <section className="vt-section">
      <div className="vt-section-head"><h3>Photos</h3><span>{nombrePhotos}/{MAX_PHOTOS}</span></div>
      <p className="vt-help">La première photo est celle du catalogue. Les grandes images sont allégées automatiquement avant l’envoi.</p>
      {!photosChargees ? <div className="vt-photos"><div className="vt-skeleton vt-photo-skeleton" /></div> : <div className="vt-photos">
        {photos.map((photo, index) => <figure key={photo.id} className={`vt-photo ${index === 0 ? "principale" : ""}`}>
          <img src={urlPublique(client, photo.chemin)} alt={photo.alt || bien.titre} loading="lazy" decoding="async" />
          {index === 0 && <span className="vt-photo-badge"><Star size={12} fill="currentColor" /> Principale</span>}
          {canEdit && <div className="vt-photo-actions">
            {index > 0 && <button type="button" onClick={() => void reordonner([photo, ...photos.filter((item) => item.id !== photo.id)], "Photo principale mise à jour.")} disabled={desactive} aria-label="Définir comme principale" title="Définir comme principale"><Star size={15} /></button>}
            <button type="button" onClick={() => { const liste = [...photos]; [liste[index - 1], liste[index]] = [liste[index], liste[index - 1]]; void reordonner(liste, "Ordre mis à jour."); }} disabled={desactive || index === 0} aria-label="Déplacer avant">‹</button>
            <button type="button" onClick={() => { const liste = [...photos]; [liste[index + 1], liste[index]] = [liste[index], liste[index + 1]]; void reordonner(liste, "Ordre mis à jour."); }} disabled={desactive || index === photos.length - 1} aria-label="Déplacer après">›</button>
            <button type="button" className="danger" onClick={() => void supprimerPhoto(photo)} disabled={desactive} aria-label="Retirer la photo"><Trash2 size={15} /></button>
          </div>}
          <input className="vt-photo-alt" defaultValue={photo.alt} placeholder="Légende (accessibilité)" aria-label={`Légende de la photo ${index + 1}`} disabled={!canEdit} onBlur={(event) => void legende(photo, event.target.value.trim())} />
        </figure>)}
        {nouveau && enAttente.map((fichier, index) => <figure key={`${fichier.name}-${fichier.lastModified}-${index}`} className={`vt-photo attente ${index === 0 ? "principale" : ""}`}>
          <ApercuFichier fichier={fichier} />
          {index === 0 && <span className="vt-photo-badge"><Star size={12} fill="currentColor" /> Principale</span>}
          <div className="vt-photo-actions"><button type="button" className="danger" onClick={() => setEnAttente((liste) => liste.filter((_, i) => i !== index))} disabled={!!occupe} aria-label="Retirer"><X size={15} /></button></div>
          <span className="vt-photo-alt vt-photo-pending">Envoyée à l’enregistrement</span>
        </figure>)}
        {canEdit && nombrePhotos < MAX_PHOTOS && <button type="button" className="vt-photo-add" onClick={() => fichierRef.current?.click()} disabled={desactive}><ImagePlus size={24} /><span>Ajouter des photos</span><small>JPG, PNG, WebP · 10 Mo</small></button>}
      </div>}
      <input ref={fichierRef} type="file" hidden multiple accept={TYPES_IMAGE.join(",")} onChange={(event) => { choisirFichiers(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
      {!nouveau && enAttente.length > 0 && <div className="vt-feedback info"><span>{pluriel(enAttente.length, "photo")} non envoyée{enAttente.length > 1 ? "s" : ""}.</span> <button type="button" className="text-action" disabled={desactive} onClick={() => void envoyer(enAttente)}>Réessayer l’envoi</button></div>}
    </section>

    <fieldset className="vt-fieldset" disabled={!canEdit}>
      <section className="vt-section">
        <h3>L’essentiel</h3>
        <div className="vt-form-grid">
          <label className="field vt-span-2"><span>Titre de l’annonce <b>*</b></span><input value={bien.titre} maxLength={120} placeholder="Ex. Villa basse 4 pièces avec jardin" disabled={desactive} onChange={(event) => changer("titre", event.target.value)} /></label>
          <label className="field"><span>Type de bien <b>*</b></span><input list="vt-types" value={bien.type_bien} disabled={desactive} onChange={(event) => changer("type_bien", event.target.value)} /><datalist id="vt-types">{typesBien.map((type) => <option key={type} value={type} />)}</datalist></label>
          <label className="field">Disponibilité<select value={bien.statut} disabled={desactive} onChange={(event) => changer("statut", event.target.value as Bien["statut"])}>{statutsBien.map(([cle, nom]) => <option key={cle} value={cle}>{nom}</option>)}</select></label>
          <div className="vt-span-2 vt-price">
            {nombre("prix", bien.categorie === "location" ? "Loyer mensuel" : "Prix de vente", undefined, "FCFA")}
            <Interrupteur actif={bien.prix_sur_demande} onChange={(valeur) => changer("prix_sur_demande", valeur)} disabled={desactive}>Prix sur demande</Interrupteur>
          </div>
        </div>
      </section>

      <section className="vt-section">
        <h3>Localisation</h3>
        <div className="vt-form-grid">
          <label className="field"><span>Ville <b>*</b></span><input value={bien.ville} disabled={desactive} onChange={(event) => changer("ville", event.target.value)} /></label>
          <label className="field">Commune<input list="vt-communes" value={bien.commune ?? ""} disabled={desactive} onChange={(event) => changer("commune", event.target.value)} /><datalist id="vt-communes">{communesAbidjan.map((commune) => <option key={commune} value={commune} />)}</datalist></label>
          <label className="field">Quartier<input value={bien.quartier ?? ""} placeholder="Ex. Riviera Palmeraie" disabled={desactive} onChange={(event) => changer("quartier", event.target.value)} /></label>
          <label className="field">Adresse précise<input value={bien.adresse ?? ""} placeholder="Rue, repère…" disabled={desactive} onChange={(event) => changer("adresse", event.target.value)} /></label>
          <div className="field vt-span-2">Affichage de l’adresse sur le site
            <Segments label="Affichage de l’adresse" valeur={bien.adresse_visibilite} options={visibilitesAdresse} onChange={(valeur) => changer("adresse_visibilite", valeur)} disabled={desactive} />
            <span className="vt-help">{bien.adresse_visibilite === "affichee" ? "L’adresse et la position GPS sont visibles par tous." : bien.adresse_visibilite === "apres_contact" ? "L’équipe communique l’adresse au visiteur après sa demande." : "Seuls la commune et le quartier sont affichés."}</span>
          </div>
          <div className="vt-span-2 vt-gps">
            <label className="field">Latitude<input type="number" step="any" inputMode="decimal" value={bien.latitude ?? ""} disabled={desactive} onChange={(event) => changer("latitude", event.target.value)} /></label>
            <label className="field">Longitude<input type="number" step="any" inputMode="decimal" value={bien.longitude ?? ""} disabled={desactive} onChange={(event) => changer("longitude", event.target.value)} /></label>
            <button type="button" className="secondary-button" onClick={positionActuelle} disabled={desactive || gps}>{gps ? <Loader2 size={16} className="vt-spin" /> : <Crosshair size={16} />} Ma position</button>
          </div>
        </div>
      </section>

      <section className="vt-section">
        <h3>Caractéristiques</h3>
        <div className="vt-form-grid vt-form-grid-4">
          {nombre("surface", "Surface", <Ruler size={15} />, "m²")}
          {nombre("chambres", "Chambres", <BedDouble size={15} />)}
          {nombre("salles_de_bain", "Salles de bain", <Bath size={15} />)}
          {nombre("parking", "Parking", <Car size={15} />)}
        </div>
        <div className="vt-toggles">
          <Interrupteur actif={bien.piscine} onChange={(valeur) => changer("piscine", valeur)} disabled={desactive}>Piscine</Interrupteur>
          <Interrupteur actif={bien.electricite} onChange={(valeur) => changer("electricite", valeur)} disabled={desactive}>Électricité</Interrupteur>
          <Interrupteur actif={bien.eau} onChange={(valeur) => changer("eau", valeur)} disabled={desactive}>Eau courante</Interrupteur>
        </div>
        <label className="field vt-description"><span>Description <b>*</b></span><textarea rows={6} value={bien.description} placeholder="Décrivez le bien, son environnement, ses atouts…" disabled={desactive} onChange={(event) => changer("description", event.target.value)} /><span className={`vt-counter ${description < 20 ? "warn" : ""}`}>{description} caractère{description > 1 ? "s" : ""}{description < 20 ? " · 20 minimum pour publier" : ""}</span></label>
      </section>

      <section className="vt-section">
        <h3>Mise en avant</h3>
        <span className="vt-label">Badges <small>(le site en affiche deux sur la carte)</small></span>
        <div className="vt-badges" role="group" aria-label="Badges">{badgesSite.map(([cle, nom]) => {
          const actif = bien.badges.includes(cle);
          return <button key={cle} type="button" aria-pressed={actif} className={actif ? "active" : ""} disabled={desactive} onClick={() => changer("badges", actif ? bien.badges.filter((b) => b !== cle) : [...bien.badges, cle])}>{actif && <Check size={13} />} {nom}</button>;
        })}</div>
        <div className="vt-form-grid">
          <label className="field">Commercial affiché<select value={bien.commercial_id ?? ""} disabled={desactive} onChange={(event) => changer("commercial_id", event.target.value || null)}><option value="">Aucun</option>{commerciaux.map((commercial) => <option key={commercial.id} value={commercial.id}>{commercial.nom}</option>)}{bien.commercial_id && !commerciaux.some((c) => c.id === bien.commercial_id) && <option value={bien.commercial_id}>Commercial inactif</option>}</select></label>
          <div className="vt-feature"><Interrupteur actif={bien.en_vedette} onChange={(valeur) => changer("en_vedette", valeur)} disabled={desactive}>En vedette</Interrupteur><span className="vt-help">Placée en tête du catalogue.</span></div>
        </div>
      </section>

      <section className="vt-section vt-publication">
        <h3>Publication</h3>
        <Segments label="Publication" valeur={bien.publication} options={[["brouillon", "Brouillon"], ["publie", "En ligne"]] as const} onChange={(valeur) => changer("publication", valeur)} disabled={desactive} desactivees={pret ? [] : ["publie"]} />
        <ul className="vt-checklist" aria-label="Prêt à publier">{verifications.map((item) => <li key={item.texte} className={item.ok ? "ok" : ""}>{item.ok ? <Check size={15} /> : <CircleDashed size={15} />} {item.texte}</li>)}</ul>
        {bien.publication === "publie" && bien.statut !== "disponible" && bien.statut !== "sous_option" && <p className="vt-help warn">Une annonce « {libelle(statutsBien, bien.statut)} » n’apparaît pas sur le site, même publiée.</p>}
        <label className="field">Adresse web<span className="vt-input-affix vt-slug"><em>/biens/</em><input value={bien.slug} placeholder={slugify(bien.titre) || "generee-depuis-le-titre"} disabled={desactive || publieEnBase} onChange={(event) => changer("slug", slugify(event.target.value))} /></span>{publieEnBase && <span className="vt-help">Repassez l’annonce en brouillon pour modifier son adresse web.</span>}</label>
      </section>
    </fieldset>
  </Feuille>;
}

function EditeurFormule({ client, canEdit, initial, onClose, onSaved, onDeleted }: {
  client: SupabaseClient; canEdit: boolean; initial: Formule; onClose: () => void; onSaved: (formule: Formule) => void; onDeleted: (formule: Formule) => void;
}) {
  const [formule, setFormule] = useState<Formule>(initial);
  const [base, setBase] = useState(() => JSON.stringify(payloadFormule(initial)));
  const [publieeEnBase, setPublieeEnBase] = useState(initial.publication === "publie");
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const nouveau = !formule.id;
  const modifie = JSON.stringify(payloadFormule(formule)) !== base;
  const changer = <K extends keyof Formule>(cle: K, valeur: Formule[K]) => setFormule((courant) => ({ ...courant, [cle]: valeur }));
  const fermer = () => { if (!occupe && (!modifie || window.confirm("Abandonner les modifications non enregistrées ?"))) onClose(); };
  const desactive = !canEdit || occupe;

  async function enregistrer() {
    if (!canEdit || occupe) return;
    const commission = Number(formule.commission);
    const jour = formule.jour_reversement === null || formule.jour_reversement === "" ? null : Number(formule.jour_reversement);
    if (formule.nom.trim().length < 2) { setMessage({ ton: "erreur", texte: "Donnez un nom à la formule." }); return; }
    if (!Number.isFinite(commission) || commission < 0 || commission > 100) { setMessage({ ton: "erreur", texte: "La commission doit être comprise entre 0 et 100 %." }); return; }
    if (jour !== null && (!Number.isInteger(jour) || jour < 1 || jour > 28)) { setMessage({ ton: "erreur", texte: "Le jour de reversement doit être compris entre 1 et 28." }); return; }
    setOccupe(true);
    setMessage(null);
    const payload = { ...payloadFormule(formule), avantages: formule.avantages.map((a) => a.trim()).filter(Boolean), exclusions: formule.exclusions.map((e) => e.trim()).filter(Boolean) };
    const { data, error } = nouveau
      ? await client.from("site_formules").insert({ ...payload, organisation_id: ORG_VITRINE }).select("*").single()
      : await client.from("site_formules").update(payload).eq("id", formule.id!).eq("organisation_id", ORG_VITRINE).select("*").single();
    setOccupe(false);
    if (error) { setMessage({ ton: "erreur", texte: erreurLisible(error) }); return; }
    setFormule(data as Formule);
    setBase(JSON.stringify(payloadFormule(data as Formule)));
    setPublieeEnBase((data as Formule).publication === "publie");
    onSaved(data as Formule);
    setMessage({ ton: "ok", texte: nouveau ? "Formule créée." : "Modifications enregistrées." });
  }

  async function supprimer() {
    if (!formule.id || !canEdit || publieeEnBase || !window.confirm(`Supprimer définitivement la formule « ${formule.nom} » ?`)) return;
    setOccupe(true);
    const { error } = await client.from("site_formules").delete().eq("id", formule.id).eq("organisation_id", ORG_VITRINE);
    setOccupe(false);
    if (error) setMessage({ ton: "erreur", texte: erreurLisible(error) });
    else onDeleted(formule);
  }

  const pied = canEdit ? <>
    {occupe ? <span className="vt-progress"><Loader2 size={16} className="vt-spin" /> Enregistrement…</span> : modifie ? <span className="vt-dirty">Modifications non enregistrées</span> : !nouveau && <span className="vt-saved"><Check size={15} /> À jour</span>}
    {!nouveau && !publieeEnBase && <button type="button" className="vt-danger-button" onClick={() => void supprimer()} disabled={occupe}><Trash2 size={16} /> <span>Supprimer</span></button>}
    <button type="button" className="primary-button vt-save" onClick={() => void enregistrer()} disabled={occupe || (!modifie && !nouveau)}>{nouveau ? "Créer la formule" : "Enregistrer"} <ArrowRight size={17} /></button>
  </> : undefined;

  return <Feuille titre={nouveau ? "Nouvelle formule" : "Formule de gestion"} onClose={fermer} pied={pied}>
    <div className="vt-editor-head"><div><p className="eyebrow">FORMULE</p><h2>{formule.nom || "Nouvelle formule"}</h2><p>{Number(formule.commission || 0).toLocaleString("fr-FR")} % de commission</p></div></div>
    <Retour message={message} />
    <fieldset className="vt-fieldset" disabled={!canEdit}>
      <section className="vt-section">
        <h3>Présentation</h3>
        <div className="vt-form-grid">
          <label className="field"><span>Nom <b>*</b></span><input value={formule.nom} maxLength={60} disabled={desactive} onChange={(event) => changer("nom", event.target.value)} /></label>
          <label className="field">Accroche<input value={formule.accroche} maxLength={120} placeholder="Ex. Pour une gestion complète" disabled={desactive} onChange={(event) => changer("accroche", event.target.value)} /></label>
          <label className="field vt-field-number">Commission<span className="vt-input-affix"><input type="number" inputMode="decimal" min={0} max={100} step="0.5" value={formule.commission} disabled={desactive} onChange={(event) => changer("commission", event.target.value)} /><em>%</em></span></label>
          <label className="field vt-field-number">Jour de reversement<span className="vt-input-affix"><input type="number" inputMode="numeric" min={1} max={28} value={formule.jour_reversement ?? ""} disabled={desactive} onChange={(event) => changer("jour_reversement", event.target.value)} /><em>du mois</em></span></label>
          <label className="field vt-field-number">Ordre d’affichage<input type="number" inputMode="numeric" min={0} value={formule.ordre} disabled={desactive} onChange={(event) => changer("ordre", event.target.value)} /></label>
          <div className="vt-feature"><Interrupteur actif={formule.recommande} onChange={(valeur) => changer("recommande", valeur)} disabled={desactive}>Recommandée</Interrupteur><span className="vt-help">Mise en évidence sur le site.</span></div>
        </div>
      </section>
      <section className="vt-section">
        <h3>Contenu de l’offre</h3>
        <ListeEditable titre="Services inclus" items={formule.avantages} onChange={(items) => changer("avantages", items)} disabled={desactive} placeholder="Ajouter un service inclus" />
        <ListeEditable titre="Services non inclus" items={formule.exclusions} onChange={(items) => changer("exclusions", items)} disabled={desactive} placeholder="Ajouter un service non inclus" />
        <label className="field">Conditions<textarea rows={3} value={formule.conditions} placeholder="Facultatif" disabled={desactive} onChange={(event) => changer("conditions", event.target.value)} /></label>
      </section>
      <section className="vt-section vt-publication">
        <h3>Publication</h3>
        <Segments label="Publication" valeur={formule.publication} options={[["brouillon", "Brouillon"], ["publie", "Publiée"]] as const} onChange={(valeur) => changer("publication", valeur)} disabled={desactive} />
      </section>
    </fieldset>
  </Feuille>;
}

function EditeurContenu({ client, canEdit, initial, onClose, onSaved }: {
  client: SupabaseClient; canEdit: boolean; initial: Contenu; onClose: () => void; onSaved: (contenu: Contenu) => void;
}) {
  const [contenu, setContenu] = useState<Contenu>(initial);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);
  const fichierRef = useRef<HTMLInputElement>(null);
  const [nom, aide] = libellesContenus[contenu.cle] ?? [contenu.cle, "Section du site"];
  const modifie = contenu.titre !== initial.titre || contenu.texte !== initial.texte || contenu.image_url !== initial.image_url;
  const fermer = () => { if (!occupe && (!modifie || window.confirm("Abandonner les modifications non enregistrées ?"))) onClose(); };
  const desactive = !canEdit || !!occupe;

  async function image(fichier?: File) {
    if (!fichier || !canEdit) return;
    if (!TYPES_IMAGE.includes(fichier.type)) { setMessage({ ton: "erreur", texte: "Choisissez une image JPG, PNG, WebP ou AVIF." }); return; }
    setOccupe("Envoi de l’image…");
    setMessage(null);
    try {
      const chemin = await envoyerImage(client, `contenus/${contenu.cle}`, fichier);
      setContenu((courant) => ({ ...courant, image_url: urlPublique(client, chemin) }));
    } catch (erreur) {
      setMessage({ ton: "erreur", texte: erreur instanceof Error ? erreur.message : erreurLisible(erreur) });
    } finally {
      setOccupe(null);
    }
  }

  async function enregistrer() {
    if (!canEdit || occupe) return;
    setOccupe("Enregistrement…");
    const { data, error } = await client.from("site_contenus")
      .update({ titre: contenu.titre.trim(), texte: contenu.texte.trim(), image_url: contenu.image_url || null })
      .eq("cle", contenu.cle).eq("organisation_id", ORG_VITRINE).select("*").single();
    setOccupe(null);
    if (error) setMessage({ ton: "erreur", texte: erreurLisible(error) });
    else onSaved(data as Contenu);
  }

  const pied = canEdit ? <>
    {occupe ? <span className="vt-progress"><Loader2 size={16} className="vt-spin" /> {occupe}</span> : modifie ? <span className="vt-dirty">Modifications non enregistrées</span> : <span className="vt-saved"><Check size={15} /> À jour</span>}
    <button type="button" className="primary-button vt-save" onClick={() => void enregistrer()} disabled={!!occupe || !modifie}>Enregistrer <ArrowRight size={17} /></button>
  </> : undefined;

  return <Feuille titre="Contenu du site" onClose={fermer} pied={pied}>
    <div className="vt-editor-head"><div><p className="eyebrow">{nom.toUpperCase()}</p><h2>{contenu.titre || nom}</h2><p>{aide}</p></div></div>
    <Retour message={message} />
    <fieldset className="vt-fieldset" disabled={!canEdit}>
      <section className="vt-section">
        <label className="field">Titre<input value={contenu.titre} maxLength={140} disabled={desactive} onChange={(event) => setContenu({ ...contenu, titre: event.target.value })} /></label>
        <label className="field">Texte<textarea rows={5} value={contenu.texte} disabled={desactive} onChange={(event) => setContenu({ ...contenu, texte: event.target.value })} /></label>
      </section>
      <section className="vt-section">
        <h3>Visuel</h3>
        <div className={`vt-visuel ${contenu.image_url ? "" : "vide"}`}>
          {contenu.image_url ? <img src={contenu.image_url} alt="Aperçu du visuel" /> : <span className="vt-card-placeholder"><ImagePlus size={26} /><small>Aucun visuel</small></span>}
        </div>
        {canEdit && <div className="vt-visuel-actions">
          <button type="button" className="secondary-button" onClick={() => fichierRef.current?.click()} disabled={desactive}><ImagePlus size={16} /> {contenu.image_url ? "Remplacer" : "Ajouter une image"}</button>
          {contenu.image_url && <button type="button" className="vt-danger-button" onClick={() => setContenu({ ...contenu, image_url: null })} disabled={desactive}><Trash2 size={16} /> <span>Retirer</span></button>}
        </div>}
        <input ref={fichierRef} type="file" hidden accept={TYPES_IMAGE.join(",")} onChange={(event) => { void image(event.target.files?.[0]); event.target.value = ""; }} />
        <details className="vt-advanced"><summary>Adresse de l’image</summary><label className="field"><input value={contenu.image_url ?? ""} placeholder="https://…" disabled={desactive} onChange={(event) => setContenu({ ...contenu, image_url: event.target.value || null })} /></label></details>
      </section>
    </fieldset>
  </Feuille>;
}

