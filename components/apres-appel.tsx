"use client";

import { useMemo, useState } from "react";
import { Check, PhoneCall, X } from "lucide-react";
import { actions, motifsPour } from "../lib/crm";
import { choixRapides } from "./reprogrammer-action";
import { MotifField, lireMotif } from "./motif-field";

const versChamp = (date: Date) => date.toISOString().slice(0, 16);
const depuisChamp = (valeur: string) => new Date(`${valeur}:00Z`);
const libelleDate = (date: Date) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
}).format(date);

/** Issue de l'appel, en un toucher. Chacune propose la suite la plus probable. */
export const ISSUES = [
  { cle: "joint", libelle: "Joint, on a parlé", action: "Relancer", creneau: "demain9" },
  { cle: "pas_reponse", libelle: "Pas de réponse", action: "Rappeler", creneau: "soir" },
  { cle: "rappeler", libelle: "Occupé, à rappeler", action: "Rappeler", creneau: "1h" },
  { cle: "rdv", libelle: "Rendez-vous pris", action: "Rendez-vous", creneau: "demain9" },
  { cle: "pas_interesse", libelle: "Pas intéressé", action: null, creneau: null },
] as const;
export type Issue = (typeof ISSUES)[number]["cle"];

const ORDRE_ETAPES = ["nouveau", "contacte", "rdv", "proposition", "negociation"];
/** Étape vers laquelle l'appel fait avancer le dossier (jamais en arrière). */
export function etapeApresAppel(issue: Issue, etape: string) {
  const cible = issue === "rdv" ? "rdv" : issue === "joint" ? "contacte" : null;
  const rang = ORDRE_ETAPES.indexOf(etape);
  return cible && rang !== -1 && rang < ORDRE_ETAPES.indexOf(cible) ? cible : null;
}

export type CompteAppel = {
  issue: Issue;
  resultat: string;
  notes: string;
  suite: { type: "programmer"; titre: string; echeance: Date } | { type: "clore"; etape: "gagne" | "perdu" | "reporte"; motif: string | null };
};

const CLOTURES = [["perdu", "Perdu"], ["reporte", "Reporté"], ["gagne", "Gagné"]] as const;
const LIBELLES_ETAPES: Record<string, string> = { contacte: "Contact établi", rdv: "Rendez-vous" };

type Props = {
  contact: string;
  etape: string;
  action?: string | null;
  busy: boolean;
  message: string;
  onFermer: () => void;
  onValider: (compte: CompteAppel) => void;
};

/**
 * Juste après un appel (idée de Close) : comment ça s'est passé, puis la suite, obligatoire.
 * Soit une prochaine action datée, soit la clôture du dossier avec sa raison : jamais de dossier sans suite.
 */
export function ApresAppel({ contact, etape, action, busy, message, onFermer, onValider }: Props) {
  const [maintenant] = useState(() => new Date());
  const choix = useMemo(() => choixRapides(maintenant, maintenant), [maintenant]);
  const [issue, setIssue] = useState<Issue | null>(null);
  const [cloturer, setCloturer] = useState(false);
  const [cloture, setCloture] = useState<"gagne" | "perdu" | "reporte">("perdu");
  const [titre, setTitre] = useState("Rappeler");
  const [valeur, setValeur] = useState("");
  const date = valeur ? depuisChamp(valeur) : null;
  const erreurDate = !date || Number.isNaN(date.getTime()) ? "Choisissez une date et une heure."
    : date.getTime() <= Date.now() ? "La date doit être dans le futur." : "";
  const titres = issue === "rdv" ? ["Rendez-vous", ...actions.filter((a) => a !== "Autre")] : actions.filter((a) => a !== "Autre");
  const avance = issue && !cloturer ? etapeApresAppel(issue, etape) : null;

  function choisirIssue(cle: Issue) {
    const modele = ISSUES.find((i) => i.cle === cle)!;
    setIssue(cle);
    setCloturer(cle === "pas_interesse");
    setCloture("perdu");
    if (modele.action) setTitre(modele.action);
    const creneau = choix.find((c) => c.cle === modele.creneau) ?? choix[0];
    if (creneau) setValeur(versChamp(creneau.date));
  }

  return <div className="sheet-backdrop" onClick={onFermer}>
    <section className="sheet compact-sheet apres-appel" role="dialog" aria-modal="true" aria-label="Compte rendu de l’appel" onClick={(event) => event.stopPropagation()}>
      <div className="sheet-handle" />
      <div className="sheet-head">
        <span className="apres-appel-icone"><PhoneCall size={18} /></span>
        <span>APRÈS L’APPEL</span>
        <button className="icon-button" onClick={onFermer} aria-label="Plus tard"><X size={20} /></button>
      </div>
      <div className="sheet-body">
        <h2>Comment s’est passé l’appel ?</h2>
        <p>{contact}{action ? ` · ${action}` : ""}</p>
        {message && <div className="toast" role="status">{message}</div>}
        <div className="issues-appel" role="group" aria-label="Issue de l’appel">
          {ISSUES.map((i) => <button key={i.cle} type="button" className={`issue-${i.cle}${issue === i.cle ? " active" : ""}`} aria-pressed={issue === i.cle} onClick={() => choisirIssue(i.cle)}>{i.libelle}</button>)}
        </div>

        {issue && <form className="new-form" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const libelle = ISSUES.find((i) => i.cle === issue)!.libelle;
          const notes = String(form.get("notes") ?? "").trim();
          if (cloturer) {
            onValider({ issue, resultat: libelle, notes, suite: { type: "clore", etape: cloture, motif: motifsPour(cloture) ? lireMotif(form) : null } });
          } else if (!erreurDate && date) {
            onValider({ issue, resultat: libelle, notes, suite: { type: "programmer", titre, echeance: date } });
          }
        }}>
          <label className="field">Ce qu’il faut retenir <span className="optional">facultatif</span>
            <textarea name="notes" rows={2} placeholder={issue === "joint" ? "Ex. intéressé, veut la grille des honoraires" : issue === "rdv" ? "Ex. visite du bien à Cocody" : "Ex. messagerie pleine"} />
          </label>

          <div className="field">
            La suite
            <div className="suite-actions" role="group" aria-label="La suite">
              <button type="button" className={!cloturer ? "active" : ""} aria-pressed={!cloturer} onClick={() => setCloturer(false)}>Programmer la prochaine action</button>
              <button type="button" className={cloturer ? "active" : ""} aria-pressed={cloturer} onClick={() => setCloturer(true)}>Clore le dossier</button>
            </div>
          </div>

          {cloturer ? <>
            <div className="suite-actions" role="group" aria-label="Clore comme">
              {CLOTURES.map(([cle, nom]) => <button key={cle} type="button" className={cloture === cle ? "active" : ""} aria-pressed={cloture === cle} onClick={() => setCloture(cle)}>{nom}</button>)}
            </div>
            {motifsPour(cloture) && <MotifField key={cloture} options={motifsPour(cloture)!} label={cloture === "perdu" ? "Pourquoi le dossier est-il perdu ?" : "Pourquoi le dossier est-il reporté ?"} />}
          </> : <>
            <div className="suite-actions" role="group" aria-label="Prochaine action">
              {titres.map((t) => <button key={t} type="button" className={titre === t ? "active" : ""} aria-pressed={titre === t} onClick={() => setTitre(t)}>{t}</button>)}
            </div>
            <div className="reprog-choix" role="group" aria-label="Créneaux rapides">
              {choix.map((option) => {
                const actif = versChamp(option.date) === valeur;
                return <button key={option.cle} type="button" className={actif ? "active" : ""} aria-pressed={actif} onClick={() => setValeur(versChamp(option.date))}>
                  <strong>{option.libelle}</strong><small>{libelleDate(option.date)}</small>
                </button>;
              })}
            </div>
            <label className="field">{issue === "rdv" ? "Date du rendez-vous" : "Ou date et heure précises"}
              <input type="datetime-local" value={valeur} min={versChamp(maintenant)} onChange={(event) => setValeur(event.target.value)} required />
            </label>
            {erreurDate && valeur && <p className="field-help" role="alert">{erreurDate}</p>}
            {avance && <p className="field-help">Le dossier passera en « {LIBELLES_ETAPES[avance]} ».</p>}
          </>}

          <button className="primary-button" disabled={busy || (!cloturer && !!erreurDate)}>
            <Check size={18} />{cloturer ? `Clore : ${CLOTURES.find(([c]) => c === cloture)![1]}` : date && !erreurDate ? `${titre} · ${libelleDate(date)}` : "Enregistrer"}
          </button>
        </form>}
        {!issue && <button type="button" className="text-action" onClick={onFermer}>Je le noterai plus tard</button>}
      </div>
    </section>
  </div>;
}
