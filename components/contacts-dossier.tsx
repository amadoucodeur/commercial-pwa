"use client";

// Contacts d'un dossier (principal + personnes liées), partagé entre Trabad Commercial et Loc Manager
// (même fichier dans les deux dépôts). Styles autonomes préfixés « dc- ».
import { useCallback, useEffect, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { MessageCircle, Phone, Plus, Star, Trash2, UserRound, X } from "lucide-react";

type ContactDossier = { contact_id: string; nom: string; telephone: string | null; role: string; principal: boolean };

export const rolesContact = [
  ["inconnu", "À préciser"], ["proprietaire", "Propriétaire"], ["gerant", "Gérant"], ["gardien", "Gardien"],
  ["intermediaire", "Intermédiaire"], ["partenaire", "Partenaire"], ["autre", "Autre"],
] as const;
const libelleRole = (role: string) => rolesContact.find(([valeur]) => valeur === role)?.[1] ?? "À préciser";

/** Premier numéro du champ (qui peut en contenir plusieurs), en chiffres pour wa.me. */
const whatsapp = (telephone: string) => {
  const chiffres = telephone.split(/[/;,]|\s{2,}/)[0].replace(/\D/g, "");
  return chiffres.length === 10 ? `225${chiffres}` : chiffres;
};

export function ContactsDossier({ client, dossierId, modifiable, refreshKey = 0 }: {
  client: SupabaseClient; dossierId: string; modifiable: boolean; refreshKey?: number;
}) {
  const [contacts, setContacts] = useState<ContactDossier[] | null>(null);
  const [ajout, setAjout] = useState(false);
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [role, setRole] = useState("inconnu");
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState("");

  const charger = useCallback(async () => {
    const { data, error } = await client.rpc("crm_contacts_du_dossier", { p_opportunite_id: dossierId });
    if (error) { setErreur(navigator.onLine ? `Contacts indisponibles : ${error.message}` : "Contacts consultables avec du réseau."); setContacts([]); return; }
    setErreur("");
    setContacts((data ?? []) as ContactDossier[]);
  }, [client, dossierId]);

  useEffect(() => { setContacts(null); void charger(); }, [charger, refreshKey]);

  async function ajouter(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setErreur("");
    const { error } = await client.rpc("crm_ajouter_contact_dossier", {
      p_opportunite_id: dossierId, p_nom: nom.trim(), p_telephone: telephone.trim() || null, p_role: role,
    });
    setBusy(false);
    if (error) { setErreur(navigator.onLine ? error.message : "Pas de réseau : réessayez une fois connecté."); return; }
    setNom(""); setTelephone(""); setRole("inconnu"); setAjout(false);
    void charger();
  }

  async function retirer(contact: ContactDossier) {
    if (busy || !window.confirm(`Retirer ${contact.nom} de ce dossier ? Sa fiche contact est conservée.`)) return;
    setBusy(true);
    const { error } = await client.rpc("crm_retirer_contact_dossier", { p_opportunite_id: dossierId, p_contact_id: contact.contact_id });
    setBusy(false);
    if (error) { setErreur(error.message); return; }
    void charger();
  }

  return <div className="dc">
    <style>{styles}</style>
    <div className="dc-tete">
      <small>CONTACTS DU DOSSIER{contacts && contacts.length > 1 ? ` · ${contacts.length}` : ""}</small>
      {modifiable && !ajout && <button type="button" className="dc-lien" onClick={() => { setAjout(true); setErreur(""); }}><Plus size={14} /> Ajouter</button>}
    </div>
    {contacts === null ? <p className="dc-vide">Chargement…</p> : <ul className="dc-liste">
      {contacts.map((c) => <li key={c.contact_id}>
        <span className={`dc-avatar${c.principal ? " principal" : ""}`}>{c.principal ? <Star size={15} /> : <UserRound size={15} />}</span>
        <span className="dc-texte">
          <strong>{c.nom}</strong>
          <small>{c.principal ? "Contact principal" : libelleRole(c.role)}{c.telephone ? ` · ${c.telephone}` : ""}</small>
        </span>
        {c.telephone && <a className="dc-icone" href={`tel:${c.telephone.split(/[/;,]|\s{2,}/)[0].trim()}`} aria-label={`Appeler ${c.nom}`}><Phone size={16} /></a>}
        {c.telephone && <a className="dc-icone" href={`https://wa.me/${whatsapp(c.telephone)}`} target="_blank" rel="noopener noreferrer" aria-label={`WhatsApp ${c.nom}`}><MessageCircle size={16} /></a>}
        {modifiable && !c.principal && <button type="button" className="dc-icone dc-retirer" disabled={busy} onClick={() => void retirer(c)} aria-label={`Retirer ${c.nom}`}><Trash2 size={16} /></button>}
      </li>)}
    </ul>}

    {ajout && <form className="dc-form" onSubmit={ajouter}>
      <div className="dc-form-tete"><strong>Nouveau contact</strong><button type="button" className="dc-icone" onClick={() => setAjout(false)} aria-label="Fermer"><X size={16} /></button></div>
      <label>Nom<input value={nom} onChange={(e) => setNom(e.target.value)} required minLength={2} maxLength={120} autoFocus placeholder="Ex. Kouassi Jean" /></label>
      <label>Téléphone<input value={telephone} onChange={(e) => setTelephone(e.target.value)} inputMode="tel" maxLength={60} placeholder="07 00 00 00 00" /></label>
      <label>Rôle dans le dossier<select value={role} onChange={(e) => setRole(e.target.value)}>
        {rolesContact.map(([valeur, titre]) => <option key={valeur} value={valeur}>{titre}</option>)}
      </select></label>
      <p className="dc-aide">Si ce numéro est déjà enregistré, la fiche existante est reliée au dossier au lieu d’en créer une nouvelle.</p>
      <button className="dc-bouton" disabled={busy || nom.trim().length < 2}>{busy ? "Ajout…" : "Ajouter au dossier"}</button>
    </form>}
    {erreur && <p className="dc-erreur" role="alert">{erreur}</p>}
  </div>;
}

const styles = `
.dc { display: grid; gap: 8px; }
.dc-tete { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.dc-tete small { color: #6b7b92; font-size: 11px; font-weight: 800; letter-spacing: .06em; }
.dc-lien { display: inline-flex; align-items: center; gap: 4px; padding: 4px 8px; border: 0; border-radius: 8px; background: #eef4ff; color: #1d4ed8; font-size: 12px; font-weight: 700; cursor: pointer; }
.dc-liste { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.dc-liste li { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border: 1px solid #e3e9f3; border-radius: 12px; background: #fff; }
.dc-avatar { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: #eef2f8; color: #4a607d; }
.dc-avatar.principal { background: #fff4d6; color: #a16207; }
.dc-texte { flex: 1; min-width: 0; display: grid; gap: 1px; }
.dc-texte strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 14px; color: #17243c; }
.dc-texte small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #6b7b92; font-size: 12px; }
.dc-icone { flex: none; display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid #e3e9f3; border-radius: 10px; background: #fff; color: #4a607d; cursor: pointer; }
.dc-icone:hover { background: #f4f7fb; }
.dc-retirer:hover { color: #b42318; border-color: #f5c2bd; }
.dc-vide { margin: 0; color: #6b7b92; font-size: 13px; }
.dc-form { display: grid; gap: 10px; padding: 12px; border: 1px solid #d6e2f5; border-radius: 14px; background: #f7faff; }
.dc-form-tete { display: flex; align-items: center; justify-content: space-between; }
.dc-form label { display: grid; gap: 4px; color: #4a5b74; font-size: 12px; font-weight: 700; }
.dc-form input, .dc-form select { width: 100%; min-height: 42px; padding: 9px 11px; border: 1px solid #d9e1ee; border-radius: 10px; background: #fff; font-size: 15px; color: #17243c; box-sizing: border-box; }
.dc-aide { margin: 0; color: #6b7b92; font-size: 12px; }
.dc-bouton { min-height: 42px; border: 0; border-radius: 10px; background: #1d4ed8; color: #fff; font-weight: 800; cursor: pointer; }
.dc-bouton:disabled, .dc-icone:disabled { opacity: .5; cursor: not-allowed; }
.dc-erreur { margin: 0; padding: 8px 10px; border-radius: 10px; background: #fdecea; color: #b42318; font-size: 13px; }
`;
