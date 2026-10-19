"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, MapPinned, SlidersHorizontal, X } from "lucide-react";
import { services, sources, type Contact, type Localite } from "../lib/crm";

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

const colonnes = [
  ["contact", "Contact"], ["telephone", "Téléphone"], ["role", "Rôle du contact"],
  ["services", "Services"], ["commune", "Commune"], ["localisation", "Localisation libre"],
  ["agent", "Agent"], ["source", "Source"], ["etape", "Étape"],
  ["temperature", "Température"], ["type_bien", "Type de bien"], ["adresse_bien", "Adresse du bien"],
  ["agence_en_place", "Agence en place"], ["besoin", "Besoin exprimé"], ["gps", "Position GPS"],
  ["date", "Créé le"], ["id", "ID dossier"], ["actions", "Actions"],
] as const;
type Colonne = typeof colonnes[number][0];
const colonnesParDefaut: Colonne[] = ["contact", "telephone", "services", "commune", "agent", "source", "etape", "date", "actions"];
const etapes = [["nouveau", "Nouveau"], ["contacte", "Contact établi"], ["rdv", "Rendez-vous"],
  ["proposition", "Proposition"], ["negociation", "Négociation"], ["gagne", "Gagné"],
  ["perdu", "Perdu"], ["reporte", "Reporté"]] as const;
const libelle = (options: readonly (readonly [string, string])[], value: string) =>
  options.find(([key]) => key === value)?.[1] ?? value;
const dateLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", dateStyle: "medium", timeStyle: "short",
}).format(new Date(value));
const storageKey = "trabad-commercial-dossier-columns";

export function DesktopDossierTable({ dossiers, contacts, localites, agents, manager, onOpen }: {
  dossiers: Dossier[];
  contacts: ReadonlyMap<string, Contact>;
  localites: ReadonlyMap<string, Localite>;
  agents: ReadonlyMap<string, string>;
  manager: boolean;
  onOpen: (id: string) => void;
}) {
  const disponibles = useMemo(() => colonnes.filter(([key]) => manager || key !== "agent"), [manager]);
  const [selectionnees, setSelectionnees] = useState<Colonne[]>(colonnesParDefaut);
  const [chargees, setChargees] = useState(false);
  const [popoverOuvert, setPopoverOuvert] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const boutonRef = useRef<HTMLButtonElement>(null);
  const visibles = disponibles.filter(([key]) => selectionnees.includes(key));

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (Array.isArray(saved)) {
        const valid = saved.filter((value): value is Colonne =>
          disponibles.some(([key]) => key === value));
        if (valid.length) setSelectionnees(valid);
      }
    } catch {}
    setChargees(true);
  }, [disponibles]);

  useEffect(() => {
    if (!chargees) return;
    try { localStorage.setItem(storageKey, JSON.stringify(selectionnees)); }
    catch {}
  }, [chargees, selectionnees]);

  useEffect(() => {
    if (!popoverOuvert) return;
    const fermerEnDehors = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) setPopoverOuvert(false);
    };
    const fermerEchap = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setPopoverOuvert(false);
        boutonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", fermerEnDehors);
    document.addEventListener("keydown", fermerEchap);
    return () => {
      document.removeEventListener("pointerdown", fermerEnDehors);
      document.removeEventListener("keydown", fermerEchap);
    };
  }, [popoverOuvert]);

  function basculer(key: Colonne) {
    if (selectionnees.includes(key)) {
      if (visibles.length > 1) setSelectionnees((current) => current.filter((item) => item !== key));
    } else setSelectionnees((current) => [...current, key]);
  }

  function cellule(dossier: Dossier, key: Colonne) {
    const contact = contacts.get(dossier.contact_id);
    const commune = dossier.localite_id ? localites.get(dossier.localite_id)?.nom : null;
    switch (key) {
      case "contact": return <strong className="dossier-cell-name">{contact?.nom ?? "Contact"}</strong>;
      case "telephone": return contact?.telephone ? <a href={`tel:${contact.telephone}`}>{contact.telephone}</a> : "—";
      case "role": return libelle([["proprietaire", "Propriétaire"], ["gerant", "Gérant"], ["gardien", "Gardien"], ["intermediaire", "Intermédiaire"]], contact?.role_contact ?? "À préciser");
      case "services": return (dossier.services ?? [dossier.service]).map((service) => libelle(services, service)).join(", ");
      case "commune": return commune ?? "À préciser";
      case "localisation": return contact?.localisation || "—";
      case "agent": return dossier.owner_id ? agents.get(dossier.owner_id) ?? "Agent" : "Non attribué";
      case "source": return dossier.source === "manuel" ? "Saisie manuelle" : libelle(sources, dossier.source);
      case "etape": return <span className="stage" data-stage={dossier.etape}>{libelle(etapes, dossier.etape)}</span>;
      case "temperature": return libelle([["chaud", "Chaud"], ["tiede", "Tiède"], ["froid", "Froid"]], dossier.temperature ?? "Non qualifié");
      case "type_bien": return dossier.type_bien || "—";
      case "adresse_bien": return dossier.adresse_bien || "—";
      case "agence_en_place": return libelle([["oui", "Oui"], ["non", "Non"], ["inconnu", "À préciser"]], dossier.agence_en_place ?? "—");
      case "besoin": return dossier.besoin || "—";
      case "gps": return dossier.gps_latitude !== null && dossier.gps_longitude !== null
        ? <a href={`https://www.google.com/maps?q=${dossier.gps_latitude},${dossier.gps_longitude}`} target="_blank" rel="noopener noreferrer" className="dossier-gps-link"><MapPinned size={14} /> Voir sur la carte</a> : "—";
      case "date": return dateLabel(dossier.created_at);
      case "id": return <code>{dossier.id}</code>;
      case "actions": return <button type="button" onClick={() => onOpen(dossier.id)}>Ouvrir <ChevronRight size={15} /></button>;
    }
  }

  return <>
    <div className="desktop-column-picker" ref={popoverRef}><button ref={boutonRef} type="button" className="desktop-column-trigger" aria-expanded={popoverOuvert} aria-controls="dossier-columns-popover" onClick={() => setPopoverOuvert((ouvert) => !ouvert)}><SlidersHorizontal size={17} /> Colonnes ({visibles.length}/{disponibles.length}) <ChevronDown size={16} /></button>{popoverOuvert && <div id="dossier-columns-popover" className="desktop-column-popover" role="dialog" aria-label="Choisir les colonnes du tableau"><div className="desktop-column-popover-head"><strong>Colonnes affichées</strong><button type="button" onClick={() => { setPopoverOuvert(false); boutonRef.current?.focus(); }} aria-label="Fermer la sélection des colonnes"><X size={17} /></button></div><div className="desktop-column-options">{disponibles.map(([key, title]) => <label key={key}><input type="checkbox" checked={selectionnees.includes(key)} disabled={visibles.length === 1 && selectionnees.includes(key)} onChange={() => basculer(key)} />{title}</label>)}</div><div className="desktop-column-actions"><button type="button" onClick={() => setSelectionnees(disponibles.map(([key]) => key))}>Tout afficher</button><button type="button" onClick={() => setSelectionnees(colonnesParDefaut.filter((key) => disponibles.some(([available]) => available === key)))}>Par défaut</button></div></div>}</div>
    <div className="dossier-table-wrap"><div className="dossier-table-head"><strong>Dossiers suivis</strong><span>{dossiers.length} résultat{dossiers.length > 1 ? "s" : ""}</span></div><div className="dossier-table-scroll"><table className="dossier-table" style={{ minWidth: Math.max(650, visibles.length * 145) }}><thead><tr>{visibles.map(([key, title]) => <th key={key} scope="col">{title}</th>)}</tr></thead><tbody>{dossiers.map((dossier) => <tr key={dossier.id}>{visibles.map(([key]) => <td key={key} className={`dossier-cell-${key}`}>{cellule(dossier, key)}</td>)}</tr>)}{dossiers.length === 0 && <tr><td colSpan={visibles.length} className="dossier-table-empty">Aucun dossier trouvé. Élargissez la recherche ou effacez les filtres détaillés.</td></tr>}</tbody></table></div></div>
  </>;
}
