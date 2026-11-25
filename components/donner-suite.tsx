"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, CalendarPlus, FolderOpen, Phone, X } from "lucide-react";
import { actions } from "../lib/crm";
import { choixRapides } from "./reprogrammer-action";

const versChamp = (date: Date) => date.toISOString().slice(0, 16);
const depuisChamp = (valeur: string) => new Date(`${valeur}:00Z`);
const libelleDate = (date: Date) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(date);

type Props = {
  contact: string;
  telephone?: string | null;
  contexte: string;
  busy: boolean;
  message: string;
  onFermer: () => void;
  onOuvrirFiche: () => void;
  onValider: (titre: string, echeance: Date) => void;
};

/**
 * « Donner une suite » à un dossier sans prochaine action : l'action et le créneau en deux touchers.
 * Pour clore le dossier (perdu, reporté, archivé), on passe par la fiche, qui demande le motif.
 */
export function DonnerSuite({ contact, telephone, contexte, busy, message, onFermer, onOuvrirFiche, onValider }: Props) {
  const [maintenant] = useState(() => new Date());
  const choix = useMemo(() => choixRapides(maintenant, maintenant), [maintenant]);
  const [titre, setTitre] = useState<string>("Rappeler");
  const [valeur, setValeur] = useState(() => versChamp(choix.find((c) => c.cle === "demain9")?.date ?? choix[0].date));
  const date = valeur ? depuisChamp(valeur) : null;
  const erreur = !date || Number.isNaN(date.getTime())
    ? "Choisissez une date et une heure."
    : date.getTime() <= Date.now() ? "La date doit être dans le futur." : "";

  return <div className="sheet-backdrop" onClick={onFermer}>
    <section className="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Donner une suite au dossier" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" />
      <div className="sheet-head">
        <button className="icon-button" onClick={onFermer} aria-label="Retour"><ArrowLeft size={20} /></button>
        <span>DONNER UNE SUITE</span>
        <button className="icon-button" onClick={onFermer} aria-label="Fermer"><X size={20} /></button>
      </div>
      <div className="sheet-body">
        <h2>{contact}</h2>
        <p>{contexte}</p>
        {message && <div className="toast" role="status">{message}</div>}
        <form className="new-form" onSubmit={(event) => {
          event.preventDefault();
          if (!erreur && date) onValider(titre, date);
        }}>
          <div className="field">
            Prochaine action
            <div className="suite-actions" role="group" aria-label="Prochaine action">
              {actions.map((action) => <button key={action} type="button" className={titre === action ? "active" : ""} aria-pressed={titre === action} onClick={() => setTitre(action)}>{action}</button>)}
            </div>
          </div>
          <div className="field">
            Quand ?
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
          {erreur && valeur && <p className="field-help" role="alert">{erreur}</p>}
          <button className="primary-button" disabled={busy || !!erreur}>
            <CalendarPlus size={18} />{date && !erreur ? `${titre} · ${libelleDate(date)}` : "Programmer"}
          </button>
        </form>
        <div className="suite-secondaire">
          {telephone && <a href={`tel:${telephone}`}><Phone size={15} /> Appeler maintenant</a>}
          <button type="button" onClick={onOuvrirFiche}><FolderOpen size={15} /> Ouvrir la fiche (clore, perdu, reporté…)</button>
        </div>
      </div>
    </section>
  </div>;
}
