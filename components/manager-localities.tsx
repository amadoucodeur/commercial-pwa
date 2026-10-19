"use client";

import { useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { ArrowLeft, MapPinned, Plus, ToggleLeft, ToggleRight } from "lucide-react";
import type { Localite } from "../lib/crm";

type Props = {
  client: SupabaseClient;
  organisationId: string;
  localites: Localite[];
  reload: () => Promise<void>;
  onBack: () => void;
};

export function ManagerLocalities({ client, organisationId, localites, reload, onBack }: Props) {
  const [nom, setNom] = useState("");
  const [type, setType] = useState<"commune" | "localite">("localite");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function ajouter(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = nom.trim();
    if (value.length < 2) return;
    setBusy(true);
    setMessage("");
    try {
      const { error } = await client.from("crm_localites").insert({ organisation_id: organisationId, nom: value, type });
      if (error) setMessage(error.code === "23505" ? "Cette commune ou localité existe déjà." : error.message);
      else { setNom(""); setMessage("Localité ajoutée."); await reload(); }
    } catch {
      setMessage("Ajout impossible. Vérifiez votre connexion puis réessayez.");
    } finally { setBusy(false); }
  }

  async function toggle(localite: Localite) {
    setBusy(true);
    setMessage("");
    try {
      const { error } = await client.from("crm_localites").update({ actif: !localite.actif }).eq("id", localite.id);
      if (error) setMessage(error.message);
      else { setMessage(localite.actif ? "Localité désactivée. Les anciens dossiers restent inchangés." : "Localité réactivée."); await reload(); }
    } catch {
      setMessage("Mise à jour impossible. Vérifiez votre connexion puis réessayez.");
    } finally { setBusy(false); }
  }

  return <section className="localities-page">
    <button className="back-link" onClick={onBack}><ArrowLeft size={18} /> Mon compte</button>
    <div className="page-title"><p className="eyebrow">CONFIGURATION TERRAIN</p><h1>Communes & localités</h1><p>Gardez une liste simple et à jour pour la saisie des prospects.</p></div>
    {message && <p className="form-feedback" role="status">{message}</p>}
    <form className="locality-add" onSubmit={(event) => void ajouter(event)}><div className="locality-add-title"><span><MapPinned size={19} /></span><div><strong>Ajouter un lieu</strong><small>Disponible immédiatement dans le formulaire terrain.</small></div></div><div className="locality-add-fields"><input value={nom} onChange={(event) => setNom(event.target.value)} minLength={2} maxLength={100} required placeholder="Nom de la commune ou localité" aria-label="Nom de la localité" /><select value={type} onChange={(event) => setType(event.target.value as "commune" | "localite")} aria-label="Type de lieu"><option value="commune">Commune</option><option value="localite">Localité</option></select></div><button className="primary-button" disabled={busy}><Plus size={18} /> Ajouter</button></form>
    <div className="locality-summary"><strong>{localites.filter((item) => item.actif).length}</strong> lieux actifs <span>·</span> <strong>{localites.filter((item) => !item.actif).length}</strong> désactivés</div>
    <div className="locality-list">{localites.map((localite) => <div className={`locality-row ${localite.actif ? "" : "inactive"}`} key={localite.id}><div className="locality-name"><span className="locality-pin"><MapPinned size={16} /></span><span><strong>{localite.nom}</strong><small>{localite.type === "commune" ? "Commune" : "Localité"}</small></span></div><button type="button" disabled={busy} onClick={() => void toggle(localite)} aria-label={`${localite.actif ? "Désactiver" : "Activer"} ${localite.nom}`} className={`locality-toggle ${localite.actif ? "active" : ""}`}>{localite.actif ? <ToggleRight size={24} /> : <ToggleLeft size={24} />}<span>{localite.actif ? "Active" : "Inactive"}</span></button></div>)}</div>
    <p className="locality-hint">Désactiver un lieu le retire du formulaire, sans effacer les dossiers déjà enregistrés.</p>
  </section>;
}
