"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CalendarClock, X } from "lucide-react";

// Abidjan est à UTC+0 toute l'année : les heures UTC sont les heures locales.
const HEURE = 60 * 60 * 1000;
const JOUR = 24 * HEURE;

const versChamp = (date: Date) => date.toISOString().slice(0, 16);
const depuisChamp = (valeur: string) => new Date(`${valeur}:00Z`);

const libelleDate = (date: Date) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(date);

const aHeure = (base: Date, joursPlus: number, heure: number) => {
  const date = new Date(base.getTime() + joursPlus * JOUR);
  date.setUTCHours(heure, 0, 0, 0);
  return date;
};

export type ChoixRapide = { cle: string; libelle: string; date: Date };

/** Créneaux proposés en un geste, tous dans le futur et sans doublon. */
export function choixRapides(maintenant: Date, echeanceActuelle: Date): ChoixRapide[] {
  const dansUneHeure = new Date(Math.ceil((maintenant.getTime() + HEURE) / (15 * 60 * 1000)) * 15 * 60 * 1000);
  const jusquaLundi = ((8 - maintenant.getUTCDay()) % 7) || 7;
  // « +1 semaine » garde le créneau prévu, décalé d'autant de semaines que nécessaire pour être à venir.
  let memeCreneau = new Date(echeanceActuelle.getTime() + 7 * JOUR);
  while (memeCreneau <= maintenant) memeCreneau = new Date(memeCreneau.getTime() + 7 * JOUR);

  const choix: ChoixRapide[] = [
    { cle: "1h", libelle: "Dans 1 h", date: dansUneHeure },
    { cle: "soir", libelle: "Ce soir 17 h", date: aHeure(maintenant, 0, 17) },
    { cle: "demain9", libelle: "Demain 9 h", date: aHeure(maintenant, 1, 9) },
    { cle: "demain15", libelle: "Demain 15 h", date: aHeure(maintenant, 1, 15) },
    { cle: "apres-demain", libelle: "Après-demain 9 h", date: aHeure(maintenant, 2, 9) },
    { cle: "lundi", libelle: "Lundi 9 h", date: aHeure(maintenant, jusquaLundi, 9) },
    { cle: "semaine", libelle: "+1 semaine", date: memeCreneau },
  ];
  const vus = new Set<number>();
  return choix.filter(({ date }) => {
    if (date.getTime() <= maintenant.getTime() + 15 * 60 * 1000 || vus.has(date.getTime())) return false;
    vus.add(date.getTime());
    return true;
  });
}

/** Note de la tâche complétée d'une trace de la reprogrammation. */
export function noteReprogrammee(notes: string | null, ancienne: Date, nouvelle: Date, motif: string) {
  const trace = `↻ Reprogrammée du ${libelleDate(ancienne)} au ${libelleDate(nouvelle)}${motif ? ` : ${motif}` : ""}`;
  return notes?.trim() ? `${notes.trim()}\n${trace}` : trace;
}

type Props = {
  titre: string;
  contact: string;
  echeance: string;
  busy: boolean;
  message: string;
  onFermer: () => void;
  onValider: (echeance: Date, motif: string) => void;
};

export function ReprogrammerAction({ titre, contact, echeance, busy, message, onFermer, onValider }: Props) {
  const actuelle = useMemo(() => new Date(echeance), [echeance]);
  const [maintenant] = useState(() => new Date());
  const choix = useMemo(() => choixRapides(maintenant, actuelle), [maintenant, actuelle]);
  const [valeur, setValeur] = useState(() => versChamp(choix.find((c) => c.cle === "demain9")?.date ?? choix[0].date));
  const [motif, setMotif] = useState("");
  const date = valeur ? depuisChamp(valeur) : null;
  const erreur = !date || Number.isNaN(date.getTime())
    ? "Choisissez une date et une heure."
    : date.getTime() <= Date.now() ? "La nouvelle date doit être dans le futur." : "";

  return <div className="sheet-backdrop" onClick={onFermer}>
    <section className="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Reprogrammer l’action" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" />
      <div className="sheet-head">
        <button className="icon-button" onClick={onFermer} aria-label="Retour"><ArrowLeft size={20} /></button>
        <span>REPROGRAMMER</span>
        <button className="icon-button" onClick={onFermer} aria-label="Fermer"><X size={20} /></button>
      </div>
      <div className="sheet-body">
        <h2>{titre}</h2>
        <p>{contact} · prévue le {libelleDate(actuelle)}</p>
        {message && <div className="toast" role="status">{message}</div>}
        <form className="new-form" onSubmit={(event) => {
          event.preventDefault();
          if (!erreur && date) onValider(date, motif.trim());
        }}>
          <div className="field">
            Nouveau créneau
            <div className="reprog-choix" role="group" aria-label="Créneaux rapides">
              {choix.map((option) => {
                const actif = versChamp(option.date) === valeur;
                return <button key={option.cle} type="button" className={actif ? "active" : ""} aria-pressed={actif} onClick={() => setValeur(versChamp(option.date))}>
                  <strong>{option.libelle}</strong>
                  <small>{libelleDate(option.date)}</small>
                </button>;
              })}
            </div>
          </div>
          <label className="field">Ou date et heure précises
            <input type="datetime-local" value={valeur} min={versChamp(maintenant)} onChange={(event) => setValeur(event.target.value)} required />
          </label>
          <label className="field">Motif <span className="field-optional">facultatif</span>
            <input value={motif} onChange={(event) => setMotif(event.target.value)} maxLength={160} placeholder="Ex. client en déplacement, rappeler lundi" />
          </label>
          {erreur && valeur && <p className="field-help" role="alert">{erreur}</p>}
          <p className="reprog-resume">
            <CalendarClock size={16} />
            {date && !erreur ? <>Nouvelle échéance : <strong>{libelleDate(date)}</strong></> : "Aucun créneau valide"}
          </p>
          <button className="primary-button" disabled={busy || !!erreur}>Reprogrammer <CalendarClock size={18} /></button>
        </form>
      </div>
    </section>
  </div>;
}
