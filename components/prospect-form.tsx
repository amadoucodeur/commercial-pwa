"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  ArrowLeft, ArrowRight, CalendarClock, Check, Crosshair, MapPin,
  Navigation, ShieldCheck, Sparkles,
} from "lucide-react";
import { actions, services, sources, typesBien, type Contact, type Localite, type ProspectPayload } from "../lib/crm";

const GpsMap = dynamic(() => import("./gps-map").then((module) => module.GpsMap), { ssr: false, loading: () => <div className="gps-map-loading">Chargement de la carte…</div> });

type Props = {
  contacts: Contact[];
  localites: Localite[];
  busy: boolean;
  message: string;
  onClose: () => void;
  onSave: (payload: ProspectPayload) => Promise<boolean>;
  onSearchContacts: (telephone: string) => Promise<Contact[]>;
  manager?: boolean;
  agents?: { user_id: string; nom: string }[];
};

function nextReminder() {
  const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
  tomorrow.setUTCHours(9, 0, 0, 0);
  return tomorrow.toISOString().slice(0, 16);
}

export function ProspectForm({ contacts, localites, busy, message, onClose, onSave, onSearchContacts, manager = false, agents = [] }: Props) {
  const [step, setStep] = useState(1);
  const [nom, setNom] = useState("");
  const [telephone, setTelephone] = useState("");
  const [contactsTrouves, setContactsTrouves] = useState<Contact[]>([]);
  const [rechercheContactIndisponible, setRechercheContactIndisponible] = useState(false);
  const [rechercheContactEnCours, setRechercheContactEnCours] = useState(false);
  const [contactId, setContactId] = useState("");
  const [ownerId, setOwnerId] = useState(manager ? agents[0]?.user_id ?? "" : "");
  const [localiteId, setLocaliteId] = useState("");
  const [selectedServices, setSelectedServices] = useState<string[]>(["gestion_locative"]);
  const [source, setSource] = useState("terrain");
  const [typeBien, setTypeBien] = useState("");
  const [adresseBien, setAdresseBien] = useState("");
  const [agenceEnPlace, setAgenceEnPlace] = useState("");
  const [roleContact, setRoleContact] = useState("inconnu");
  const [temperature, setTemperature] = useState("");
  const [besoin, setBesoin] = useState("");
  const [action, setAction] = useState(manager && agents.length === 0 ? "" : "Rappeler");
  const [customAction, setCustomAction] = useState("");
  const [echeance, setEcheance] = useState(nextReminder);
  const [gpsMode, setGpsMode] = useState<"automatique" | "manuel" | "carte" | "aucun">("automatique");
  const [gpsStatus, setGpsStatus] = useState("Recherche de votre position…");
  const [latitude, setLatitude] = useState("");
  const [longitude, setLongitude] = useState("");
  const [precision, setPrecision] = useState<number | null>(null);
  const gpsRequest = useRef(0);

  const capturePosition = useCallback(() => {
    const request = ++gpsRequest.current;
    setGpsMode("automatique");
    setGpsStatus("Recherche de la position de cet appareil…");
    if (!navigator.geolocation) {
      setGpsStatus("GPS indisponible sur cet appareil. Vous pouvez saisir la position.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (gpsRequest.current !== request) return;
        setLatitude(position.coords.latitude.toFixed(6));
        setLongitude(position.coords.longitude.toFixed(6));
        setPrecision(Math.round(position.coords.accuracy));
        setGpsStatus(`Position de cet appareil · précision ±${Math.round(position.coords.accuracy)} m`);
      },
      () => { if (gpsRequest.current === request) setGpsStatus("Position non obtenue. La fiche peut être enregistrée sans GPS."); },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  useEffect(() => { capturePosition(); }, [capturePosition]);
  useEffect(() => {
    const digits = telephone.replace(/\D/g, "");
    setRechercheContactIndisponible(false);
    if (digits.length < 8) { setContactsTrouves([]); setRechercheContactEnCours(false); return; }
    setRechercheContactEnCours(true);
    let active = true;
    const timer = window.setTimeout(() => {
      void onSearchContacts(digits).then((resultats) => {
        if (active) { setContactsTrouves(resultats); setRechercheContactIndisponible(false); setRechercheContactEnCours(false); }
      }).catch(() => { if (active) { setRechercheContactIndisponible(true); setRechercheContactEnCours(false); } });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [onSearchContacts, telephone]);

  const matches = useMemo(() => {
    const digits = telephone.replace(/\D/g, "");
    if (digits.length < 8) return [];
    const parId = new Map([...contacts, ...contactsTrouves]
      .filter((contact) => contact.telephone_normalise?.endsWith(digits.slice(-8)))
      .map((contact) => [contact.id, contact]));
    return [...parId.values()];
  }, [contacts, contactsTrouves, telephone]);
  const activeLocalites = localites.filter((item) => item.actif);

  async function save(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((gpsMode === "manuel" || gpsMode === "carte") && (!latitude || !longitude)) {
      setGpsStatus("Choisissez un point sur la carte, renseignez les coordonnées ou sélectionnez « Sans GPS ».");
      return;
    }
    const hasPosition = gpsMode !== "aucun" && latitude !== "" && longitude !== "";
    const gpsLatitude = hasPosition ? Number(latitude) : null;
    const gpsLongitude = hasPosition ? Number(longitude) : null;
    if (hasPosition && (gpsLatitude === null || gpsLongitude === null ||
      !Number.isFinite(gpsLatitude) || !Number.isFinite(gpsLongitude) ||
      Math.abs(gpsLatitude) > 90 || Math.abs(gpsLongitude) > 180)) {
      setGpsStatus("Coordonnées invalides : vérifiez la latitude et la longitude.");
      return;
    }
    await onSave({
      nom: nom.trim(), telephone: telephone.trim(), contactId: contactId || null,
      ownerId: manager ? ownerId || null : null,
      localiteId, services: selectedServices, source, roleContact,
      typeBien: typeBien || null, adresseBien: adresseBien.trim() || null,
      agenceEnPlace: agenceEnPlace || null, besoin: besoin.trim() || null,
      temperature: temperature || null,
      action: action === "Autre" ? customAction.trim() : action || null,
      echeanceAt: action ? new Date(`${echeance}:00Z`).toISOString() : null,
      gpsLatitude, gpsLongitude,
      gpsPrecisionM: hasPosition && gpsMode === "automatique" ? precision : null,
      gpsSource: hasPosition ? gpsMode === "automatique" ? "automatique" : "manuel" : null,
    });
  }

  return <div className="prospect-flow">
    <div className="flow-heading">
      <div className="flow-icon"><Sparkles size={19} /></div>
      <h2>Nouveau prospect</h2>
      <p>Une fiche utile en moins d’une minute.</p>
      <div className="flow-progress" aria-label={`Étape ${step} sur 2`}><span className="filled" /><span className={step === 2 ? "filled" : ""} /></div>
    </div>
    {message && <p className="form-feedback" role="status">{message}</p>}
    {step === 1 ? <form className="flow-form" onSubmit={(event) => { event.preventDefault(); setStep(2); }}>
      <div className="flow-step-title"><span>01</span><div><strong>L’essentiel</strong><small>Qui rencontrez-vous, et où ?</small></div></div>
      <label className="field"><span>Nom du contact <b>*</b></span><input value={nom} onChange={(event) => setNom(event.target.value)} required minLength={2} autoFocus placeholder="Nom et prénom" autoComplete="name" /></label>
      <label className="field">Téléphone<input value={telephone} onChange={(event) => { setTelephone(event.target.value); setContactId(""); }} type="tel" placeholder="Ex. 07 00 00 00 00" autoComplete="tel" inputMode="tel" /></label>
      {matches.length > 0 && <label className="field match">Contact déjà connu ?<select value={contactId} onChange={(event) => { const selected = matches.find((contact) => contact.id === event.target.value); setContactId(event.target.value); if (selected) { setNom(selected.nom); setOwnerId(selected.owner_id ?? ""); if (manager && (!selected.owner_id || !agents.some((agent) => agent.user_id === selected.owner_id))) setAction(""); } }}><option value="">Créer une nouvelle fiche</option>{matches.map((contact) => <option key={contact.id} value={contact.id}>{contact.nom} · {contact.telephone}</option>)}</select></label>}
      {rechercheContactEnCours && <p className="field-help" role="status">Vérification des contacts existants…</p>}
      {rechercheContactIndisponible && <p className="field-help" role="status">Vérification des doublons indisponible. Vérifiez le contact avant d’en créer un nouveau.</p>}
      {manager && <label className="field">Agent responsable<select value={ownerId} disabled={!!contactId} onChange={(event) => { setOwnerId(event.target.value); if (!event.target.value) setAction(""); }}><option value="">Non attribué</option>{agents.map((agent) => <option key={agent.user_id} value={agent.user_id}>{agent.nom}</option>)}</select></label>}
      {manager && agents.length === 0 && <p className="field-help">Aucun agent commercial actif. Créez un profil dans Performance ou Loc Manager ; le dossier pourra être saisi sans attribution.</p>}
      <label className="field"><span>Commune ou localité <b>*</b></span><select value={localiteId} onChange={(event) => setLocaliteId(event.target.value)} required><option value="">Choisir une commune</option><optgroup label="Communes du Grand Abidjan">{activeLocalites.filter((item) => item.type === "commune").map((item) => <option key={item.id} value={item.id}>{item.nom}</option>)}</optgroup>{activeLocalites.some((item) => item.type === "localite") && <optgroup label="Autres localités">{activeLocalites.filter((item) => item.type === "localite").map((item) => <option key={item.id} value={item.id}>{item.nom}</option>)}</optgroup>}</select></label>
      {activeLocalites.length === 0 && <p className="field-help">Aucune commune active. Demandez au responsable d’en activer une.</p>}
      <fieldset className="field"><legend>Services recherchés <b>*</b></legend><div className="service-choices">{services.map(([value, title]) => <label key={value}><input type="checkbox" checked={selectedServices.includes(value)} onChange={(event) => setSelectedServices((current) => event.target.checked ? [...current, value] : current.filter((item) => item !== value))} /> {title}</label>)}</div></fieldset>
      <label className="field">Source du prospect<select value={source} onChange={(event) => setSource(event.target.value)}>{sources.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <button className="primary-button flow-next" disabled={activeLocalites.length === 0 || selectedServices.length === 0 || rechercheContactEnCours}>Continuer <ArrowRight size={18} /></button>
    </form> : <form className="flow-form" onSubmit={(event) => void save(event)}>
      <div className="flow-step-title"><span>02</span><div><strong>Le suivi</strong><small>Tout est prérempli, ajustez si besoin.</small></div></div>
      <div className="auto-date"><CalendarClock size={18} /><div><strong>Date et heure de saisie</strong><span>Enregistrées automatiquement à la validation</span></div><Check size={16} /></div>
      <label className="field">Type de bien<select value={typeBien} onChange={(event) => setTypeBien(event.target.value)}><option value="">À préciser plus tard</option>{typesBien.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label className="field">Adresse ou repère<input value={adresseBien} onChange={(event) => setAdresseBien(event.target.value)} placeholder="Ex. près du carrefour…" /></label>
      <div className="gps-card"><div className="gps-header"><span className="gps-icon"><MapPin size={19} /></span><div><strong>Position GPS</strong><small aria-live="polite">{gpsStatus}</small></div></div><div className="gps-options"><button type="button" className={gpsMode === "automatique" ? "active" : ""} onClick={capturePosition}><Crosshair size={14} /> Auto</button><button type="button" className={gpsMode === "carte" ? "active" : ""} onClick={() => { gpsRequest.current++; setGpsMode("carte"); setPrecision(null); setGpsStatus("Touchez la carte pour choisir la position du bien."); }}><MapPin size={14} /> Carte</button><button type="button" className={gpsMode === "manuel" ? "active" : ""} onClick={() => { gpsRequest.current++; setGpsMode("manuel"); setPrecision(null); setGpsStatus("Saisissez les coordonnées du bien."); }}>Manuel</button><button type="button" className={gpsMode === "aucun" ? "active" : ""} onClick={() => { gpsRequest.current++; setGpsMode("aucun"); setGpsStatus("Aucune position ajoutée."); }}>Sans GPS</button></div>{gpsMode === "carte" && <GpsMap latitude={latitude ? Number(latitude) : null} longitude={longitude ? Number(longitude) : null} onSelect={(lat, lng) => { setLatitude(lat.toFixed(6)); setLongitude(lng.toFixed(6)); setGpsStatus("Position choisie sur la carte."); }} />}{gpsMode === "manuel" && <div className="gps-coordinates"><label className="field">Latitude<input type="number" step="any" min="-90" max="90" value={latitude} onChange={(event) => setLatitude(event.target.value)} placeholder="5.360000" /></label><label className="field">Longitude<input type="number" step="any" min="-180" max="180" value={longitude} onChange={(event) => setLongitude(event.target.value)} placeholder="-4.008000" /></label></div>}{gpsMode !== "aucun" && latitude && longitude && <div className="gps-done"><Navigation size={14} /> {latitude}, {longitude}</div>}</div>
      <div className="temperature-field"><span>Température du prospect</span><div className="temperature-options">{[["", "À qualifier"], ["froid", "Froid"], ["tiede", "Tiède"], ["chaud", "Chaud"]].map(([value, title]) => <button key={value} type="button" className={temperature === value ? "active" : ""} aria-pressed={temperature === value} onClick={() => setTemperature(value)}>{title}</button>)}</div></div>
      <div className="flow-divider">PROCHAINE ACTION</div>
      {manager && (!ownerId || !agents.some((agent) => agent.user_id === ownerId)) && <p className="field-help">Attribuez un agent actif avant de programmer une action.</p>}
      <label className="field">Action<select value={action} disabled={manager && (!ownerId || !agents.some((agent) => agent.user_id === ownerId))} onChange={(event) => setAction(event.target.value)}><option value="">Aucune action pour l’instant</option>{actions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      {action === "Autre" && <label className="field">Préciser l’action<input value={customAction} onChange={(event) => setCustomAction(event.target.value)} required minLength={2} placeholder="Ex. envoyer le dossier de présentation" /></label>}
      {action && <label className="field">Quand ? <span className="optional">Demain 09:00 par défaut</span><input type="datetime-local" value={echeance} onChange={(event) => setEcheance(event.target.value)} required /></label>}
      <label className="field">Rôle du contact<select value={roleContact} onChange={(event) => setRoleContact(event.target.value)}><option value="inconnu">À préciser</option><option value="proprietaire">Propriétaire</option><option value="gerant">Gérant</option><option value="gardien">Gardien</option><option value="intermediaire">Intermédiaire</option></select></label>
      <label className="field">Déjà suivi par une agence ?<select value={agenceEnPlace} onChange={(event) => setAgenceEnPlace(event.target.value)}><option value="">Non renseigné</option><option value="oui">Oui</option><option value="non">Non</option><option value="inconnu">Ne sait pas</option></select></label>
      <details className="extra-fields" open><summary>Ajouter des précisions <span>facultatif</span></summary><div className="extra-content"><label className="field">Besoin exprimé<textarea value={besoin} onChange={(event) => setBesoin(event.target.value)} rows={3} placeholder="Ce que recherche le prospect…" /></label></div></details>
      <div className="flow-actions"><button type="button" className="secondary-button" onClick={() => setStep(1)}><ArrowLeft size={17} /> Retour</button><button className="primary-button" disabled={busy}>{busy ? "Enregistrement…" : "Enregistrer"}<Check size={18} /></button></div>
      <p className="privacy-line"><ShieldCheck size={14} /> Le GPS est facultatif et visible uniquement par votre équipe.</p>
    </form>}
    <button className="flow-cancel" type="button" onClick={onClose}>Annuler la saisie</button>
  </div>;
}
