"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ArrowLeft, ArrowRight, CalendarDays, Check,
  Download, Filter, RefreshCw, Search, Target, TrendingUp, Users, X,
} from "lucide-react";
import { services, sources, type Localite } from "../lib/crm";

type Agent = {
  user_id: string;
  nom: string;
  actif: boolean;
  portefeuille: number;
  nouveaux: number;
  gagnes: number;
  perdus: number;
  actions_terminees: number;
  actions_en_retard: number;
};
const comparerPerformance = (left: Agent, right: Agent) =>
  Number(right.gagnes) - Number(left.gagnes) ||
  Number(right.actions_terminees) - Number(left.actions_terminees) ||
  Number(right.nouveaux) - Number(left.nouveaux) ||
  Number(left.actions_en_retard) - Number(right.actions_en_retard) ||
  Number(left.perdus) - Number(right.perdus) ||
  Number(right.portefeuille) - Number(left.portefeuille) ||
  left.nom.localeCompare(right.nom, "fr");
type Profil = { user_id: string; zone: string | null };
type Eligible = { user_id: string; nom: string; actif: boolean; profil_existant: boolean };
type Activity = { id: string; type_activite: string; resultat: string | null; notes: string | null; decision: string | null; etape_classee: string | null; effectuee_at: string };

type Prospect = {
  id: string;
  contact_id: string;
  nom: string;
  telephone: string | null;
  localisation: string | null;
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
  archived_at: string | null;
  localite_id?: string | null;
  gps_latitude?: number | null;
  gps_longitude?: number | null;
  role_contact?: string;
  created_at: string;
  total_count: number;
};

type Filters = {
  recherche: string;
  agent: string;
  etape: string;
  source: string;
  temperature: string;
  service: string;
  archive: string;
  debut: string;
  fin: string;
};

const etapes = [
  ["nouveau", "Nouveau"], ["contacte", "Contact établi"], ["rdv", "Rendez-vous"],
  ["proposition", "Proposition"], ["negociation", "Négociation"],
  ["gagne", "Gagné"], ["perdu", "Perdu"], ["reporte", "Reporté"],
] as const;
const temperatures = [["froid", "Froid"], ["tiede", "Tiède"], ["chaud", "Chaud"]] as const;
const sourceChoices = [["manuel", "Saisie manuelle"], ...sources] as const;
const teamColumns = [["agent", "Agent"], ["statut", "Statut"], ["zone", "Zone"], ["portefeuille", "Portefeuille"], ["nouveaux", "Nouveaux"], ["gagnes", "Gagnés"], ["perdus", "Perdus"], ["actions", "Actions faites"], ["retards", "Retards"]] as const;
const dossierColumns = [["contact", "Contact"], ["services", "Services"], ["agent", "Agent"], ["source", "Source"], ["etape", "Étape"], ["date", "Date"]] as const;
type TeamColumn = typeof teamColumns[number][0];
type DossierColumn = typeof dossierColumns[number][0];
function ColumnPicker<Column extends string>({ options, visible, onChange }: {
  options: readonly (readonly [Column, string])[];
  visible: Column[];
  onChange: (columns: Column[]) => void;
}) {
  return <details className="manager-filters manager-column-picker">
    <summary className="manager-filter-title">Colonnes affichées ({visible.length}/{options.length})</summary>
    <div className="manager-column-options">{options.map(([key, title]) => <label key={key}>
      <input type="checkbox" checked={visible.includes(key)} disabled={visible.length === 1 && visible.includes(key)} onChange={() => onChange(visible.includes(key) ? visible.filter((column) => column !== key) : [...visible, key])} /> {title}
    </label>)}</div>
    <p className="manager-footnote">La colonne Actions reste affichée.</p>
  </details>;
}
const label = (options: readonly (readonly [string, string])[], value: string) =>
  options.find(([key]) => key === value)?.[1] ?? value;
const monthAgo = () => {
  const date = new Date();
  date.setDate(date.getDate() - 29);
  return date.toISOString().slice(0, 10);
};
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (value: string) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", day: "numeric", month: "short", year: "numeric",
}).format(new Date(value));
const csvCell = (value: string | number | null | undefined) => {
  const raw = String(value ?? "");
  const safe = /^\s*[=+\-@]/.test(raw) || /^[\t\r]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
};

export function ManagerWorkspace({ client, organisationId, refreshKey, onCreate, onTeamChanged, onOpenAgentDossiers, localites, mode, initialAgent = "", agentsDisponibles = [] }: {
  client: SupabaseClient;
  organisationId: string;
  refreshKey: number;
  onCreate: () => void;
  onTeamChanged: () => void;
  onOpenAgentDossiers?: (agentId: string) => void;
  localites: Localite[];
  mode: "performance" | "prospects";
  initialAgent?: string;
  agentsDisponibles?: { user_id: string; nom: string; actif: boolean }[];
}) {
  const [debutPerformance, setDebutPerformance] = useState(monthAgo);
  const [finPerformance, setFinPerformance] = useState(today);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [profils, setProfils] = useState<Profil[]>([]);
  const [eligibles, setEligibles] = useState<Eligible[]>([]);
  const [profilEdit, setProfilEdit] = useState<Profil | "nouveau" | null>(null);
  const [performanceBusy, setPerformanceBusy] = useState(true);
  const [performanceError, setPerformanceError] = useState(false);
  const [filters, setFilters] = useState<Filters>({
    recherche: "", agent: initialAgent, etape: "", source: "", temperature: "", service: "", archive: "", debut: "", fin: "",
  });
  const [page, setPage] = useState(0);
  const [rows, setRows] = useState<Prospect[]>([]);
  const [total, setTotal] = useState(0);
  const [listBusy, setListBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selected, setSelected] = useState<Prospect | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [editing, setEditing] = useState<Prospect | null>(null);
  const [rechercheAgent, setRechercheAgent] = useState("");
  const [statutAgent, setStatutAgent] = useState("tous");
  const [zoneAgent, setZoneAgent] = useState("");
  const [visibleTeamColumns, setVisibleTeamColumns] = useState<TeamColumn[]>(teamColumns.map(([key]) => key));
  const [visibleDossierColumns, setVisibleDossierColumns] = useState<DossierColumn[]>(dossierColumns.map(([key]) => key));
  const [message, setMessage] = useState("");
  const prospectRequest = useRef(0);
  const performanceRequest = useRef(0);
  const gpsLatitudeRef = useRef<HTMLInputElement>(null);
  const gpsLongitudeRef = useRef<HTMLInputElement>(null);

  const requestArgs = useMemo(() => ({
    p_organisation_id: organisationId,
    p_recherche: filters.recherche.trim() || null,
    p_owner_id: filters.agent && filters.agent !== "sans_agent" ? filters.agent : null,
    p_sans_agent: filters.agent === "sans_agent",
    p_etape: filters.etape || null,
    p_source: filters.source || null,
    p_temperature: filters.temperature || null,
    p_service: filters.service || null,
    p_archive: filters.archive === "archive",
    p_debut: filters.debut || null,
    p_fin: filters.fin || null,
  }), [filters, organisationId]);

  const chargerPerformance = useCallback(async () => {
    if (!debutPerformance || !finPerformance || debutPerformance > finPerformance) {
      setMessage("Choisissez une période valide pour les performances."); return;
    }
    const request = ++performanceRequest.current;
    setPerformanceBusy(true);
    try {
      const { data, error } = await client.rpc("crm_performance_equipe", {
        p_organisation_id: organisationId, p_debut: debutPerformance, p_fin: finPerformance,
      });
      if (request !== performanceRequest.current) return;
      if (error) { setPerformanceError(true); setMessage(`Performance indisponible : ${error.message}`); }
      else { setPerformanceError(false); setAgents((data ?? []) as Agent[]); }
    } catch {
      if (request === performanceRequest.current) { setPerformanceError(true); setMessage("Performance indisponible. Vérifiez votre connexion."); }
    } finally {
      if (request === performanceRequest.current) setPerformanceBusy(false);
    }
  }, [client, organisationId, debutPerformance, finPerformance]);

  const chargerEquipe = useCallback(async () => {
    try {
      const [profilesResult, eligibleResult] = await Promise.all([
        client.from("crm_profiles").select("user_id,zone").eq("organisation_id", organisationId),
        client.rpc("crm_utilisateurs_eligibles", { p_organisation_id: organisationId }),
      ]);
      if (profilesResult.error || eligibleResult.error) {
        setMessage(`Équipe indisponible : ${profilesResult.error?.message ?? eligibleResult.error?.message}`);
      } else {
        setProfils((profilesResult.data ?? []) as Profil[]);
        setEligibles((eligibleResult.data ?? []) as Eligible[]);
      }
    } catch {
      setMessage("Équipe indisponible. Vérifiez votre connexion.");
    }
  }, [client, organisationId]);

  const chargerProspects = useCallback(async () => {
    if (filters.debut && filters.fin && filters.debut > filters.fin) {
      setMessage("La date de début doit précéder la date de fin."); return;
    }
    const request = ++prospectRequest.current;
    setListBusy(true);
    try {
      const { data, error } = await client.rpc("crm_lister_dossiers_equipe", {
        ...requestArgs, p_limit: 30, p_offset: page * 30,
      });
      if (request !== prospectRequest.current) return;
      if (error) setMessage(`Prospects indisponibles : ${error.message}`);
      else {
        const prospects = (data ?? []) as Prospect[];
        if (prospects.length === 0 && page > 0) { setPage(0); return; }
        setRows(prospects);
        setTotal(prospects[0]?.total_count ?? 0);
      }
    } catch {
      if (request === prospectRequest.current) setMessage("Dossiers indisponibles. Vérifiez votre connexion.");
    } finally {
      if (request === prospectRequest.current) setListBusy(false);
    }
  }, [client, filters.debut, filters.fin, page, requestArgs]);

  useEffect(() => { if (mode === "performance") void chargerPerformance(); }, [chargerPerformance, mode, refreshKey]);
  useEffect(() => {
    if (mode === "prospects") setAgents(agentsDisponibles.map((agent) => ({ ...agent, portefeuille: 0, nouveaux: 0, gagnes: 0, perdus: 0, actions_terminees: 0, actions_en_retard: 0 })));
  }, [agentsDisponibles, mode]);
  useEffect(() => { if (mode === "performance") void chargerEquipe(); }, [chargerEquipe, mode, refreshKey]);
  useEffect(() => {
    if (!selected) { setActivities([]); return; }
    let active = true;
    void Promise.resolve(client.from("crm_activites").select("id,type_activite,resultat,notes,decision,etape_classee,effectuee_at")
      .eq("opportunite_id", selected.id).order("effectuee_at", { ascending: false }).limit(50))
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setMessage(`Historique indisponible : ${error.message}`);
        else setActivities((data ?? []) as Activity[]);
      }).catch(() => { if (active) setMessage("Historique indisponible. Vérifiez votre connexion."); });
    return () => { active = false; };
  }, [client, selected?.id]);
  useEffect(() => {
    if (!selected && !editing && !profilEdit) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previousOverflow; };
  }, [selected, editing, profilEdit]);
  useEffect(() => {
    if (mode !== "prospects") return;
    const timer = window.setTimeout(() => { void chargerProspects(); }, filters.recherche ? 250 : 0);
    return () => window.clearTimeout(timer);
  }, [chargerProspects, refreshKey, mode, filters.recherche]);

  const noms = useMemo(() => new Map(agents.map((agent) => [agent.user_id, agent.nom])), [agents]);
  const somme = (key: keyof Pick<Agent, "portefeuille" | "nouveaux" | "gagnes" | "actions_en_retard">) =>
    agents.reduce((totalValue, agent) => totalValue + Number(agent[key]), 0);
  const agentsVisibles = agents.filter((agent) =>
    agent.nom.toLocaleLowerCase("fr-FR").includes(rechercheAgent.toLocaleLowerCase("fr-FR")) &&
    (statutAgent === "tous" || agent.actif === (statutAgent === "actifs")) &&
    (profils.find((profil) => profil.user_id === agent.user_id)?.zone ?? "")
      .toLocaleLowerCase("fr-FR").includes(zoneAgent.toLocaleLowerCase("fr-FR")))
    .sort(comparerPerformance);

  function exporterAgents() {
    const lines = [
      ["Agent", "Compte actif", "Zone", "Portefeuille", "Nouveaux", "Gagnés", "Perdus", "Actions terminées", "Actions en retard"],
      ...agentsVisibles.map((agent) => [agent.nom, agent.actif ? "Oui" : "Non", profils.find((profil) => profil.user_id === agent.user_id)?.zone ?? "", agent.portefeuille,
        agent.nouveaux, agent.gagnes, agent.perdus, agent.actions_terminees, agent.actions_en_retard]),
    ];
    const url = URL.createObjectURL(new Blob([`\ufeff${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}`], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `trabad-commercial-equipe-${today()}.csv`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function changerFiltre(key: keyof Filters, value: string) {
    setFilters((current) => ({ ...current, [key]: value }));
    setPage(0);
  }

  async function ouvrirEdition(row: Prospect) {
    setMessage("");
    const [dossierResult, contactResult] = await Promise.all([
      client.from("crm_opportunites").select("localite_id,gps_latitude,gps_longitude").eq("id", row.id).single(),
      client.from("crm_contacts").select("role_contact").eq("id", row.contact_id).single(),
    ]);
    if (dossierResult.error || contactResult.error) {
      setMessage(`Détail indisponible : ${dossierResult.error?.message ?? contactResult.error?.message}`);
      return;
    }
    setSelected(null);
    setEditing({ ...row, ...dossierResult.data, ...contactResult.data });
  }

  async function exporter() {
    if (filters.debut && filters.fin && filters.debut > filters.fin) {
      setMessage("La date de début doit précéder la date de fin."); return;
    }
    setExporting(true);
    setMessage("");
    try {
      const all: Prospect[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await client.rpc("crm_lister_dossiers_equipe", {
          ...requestArgs, p_limit: 500, p_offset: offset,
        });
        if (error) throw error;
        const batch = (data ?? []) as Prospect[];
        all.push(...batch);
        if (batch.length < 500) break;
      }
      const lines = [
        ["Date", "Prospect", "Téléphone", "Commune", "Agent", "Services", "Source", "Étape", "Température", "Archivé"],
        ...all.map((row) => [
          dateLabel(row.created_at), row.nom, row.telephone, row.localisation,
          row.owner_id ? noms.get(row.owner_id) ?? "Agent inconnu" : "Non attribué",
          (row.services ?? [row.service]).map((service) => label(services, service)).join(", "), label(sourceChoices, row.source),
          label(etapes, row.etape), row.temperature ? label(temperatures, row.temperature) : "Non qualifié", row.archived_at ? "Oui" : "Non",
        ]),
      ];
      const csv = `\ufeff${lines.map((line) => line.map(csvCell).join(";")).join("\r\n")}`;
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `trabad-commercial-prospects-${today()}.csv`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(`${all.length} prospect${all.length > 1 ? "s" : ""} exporté${all.length > 1 ? "s" : ""}.`);
    } catch (error) {
      setMessage(error && typeof error === "object" && "message" in error
        ? String(error.message) : "Export impossible.");
    } finally { setExporting(false); }
  }

  async function enregistrerModification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const form = new FormData(event.currentTarget);
    const chosenServices = form.getAll("services").map(String);
    if (!chosenServices.length) { setMessage("Choisissez au moins un service."); return; }
    setSaving(true);
    setMessage("");
    try {
      const { error } = await client.rpc("crm_modifier_dossier_complet", {
        p_id: editing.id, p_nom: String(form.get("nom") || ""),
        p_telephone: String(form.get("telephone") || ""),
        p_localisation: String(form.get("localisation") || ""),
        p_services: chosenServices, p_source: String(form.get("source")),
        p_etape: String(form.get("etape")),
        p_temperature: String(form.get("temperature") || "") || null,
        p_besoin: String(form.get("besoin") || "") || null,
        p_type_bien: String(form.get("type_bien") || "") || null,
        p_adresse_bien: String(form.get("adresse_bien") || "") || null,
        p_agence_en_place: String(form.get("agence_en_place") || "") || null,
        p_owner_id: String(form.get("owner_id") || "") || null,
        p_role_contact: String(form.get("role_contact") || "inconnu"),
        p_localite_id: String(form.get("localite_id") || "") || null,
        p_gps_latitude: form.get("gps_latitude") ? Number(form.get("gps_latitude")) : null,
        p_gps_longitude: form.get("gps_longitude") ? Number(form.get("gps_longitude")) : null,
      });
      if (error) throw error;
      setEditing(null);
      setMessage("Dossier mis à jour.");
      await chargerProspects();
    } catch (error) {
      setMessage(error && typeof error === "object" && "message" in error ? String(error.message) : "Mise à jour impossible.");
    } finally { setSaving(false); }
  }

  async function enregistrerProfil(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!profilEdit) return;
    const form = new FormData(event.currentTarget);
    setSaving(true);
    setMessage("");
    try {
      const result = profilEdit === "nouveau"
        ? await client.from("crm_profiles").insert({ organisation_id: organisationId,
          user_id: String(form.get("user_id")), zone: String(form.get("zone") || "") || null })
        : await client.from("crm_profiles").update({ zone: String(form.get("zone") || "") || null })
          .eq("organisation_id", organisationId).eq("user_id", profilEdit.user_id);
      if (result.error) throw result.error;
      setProfilEdit(null);
      setMessage("Profil commercial enregistré.");
      onTeamChanged();
    } catch (error) {
      setMessage(error && typeof error === "object" && "message" in error ? String(error.message) : "Profil non enregistré.");
    } finally { setSaving(false); }
  }

  return <div className={`manager-workspace manager-workspace-${mode}`}>
    {mode === "performance" && <div className="page-title"><p className="eyebrow">ESPACE RESPONSABLE</p><h1>Performance commerciale</h1><p>Suivez les résultats de votre équipe sur la période choisie.</p></div>}
    {!performanceBusy && !performanceError && agents.filter((agent) => agent.actif).length === 0 && <div className="warning" role="alert">Aucun agent commercial actif n’est configuré. Ajoutez au moins un compte avec le droit Commercial et son profil depuis Loc Manager pour démarrer le suivi.</div>}
    {message && <div className="toast manager-toast" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Fermer"><X size={16} /></button></div>}

    {mode === "performance" && <>
      <div className="manager-period"><label>Du<input type="date" value={debutPerformance} max={finPerformance} onChange={(event) => setDebutPerformance(event.target.value)} /></label><label>Au<input type="date" value={finPerformance} min={debutPerformance} onChange={(event) => setFinPerformance(event.target.value)} /></label><button onClick={() => void chargerPerformance()} aria-label="Actualiser les performances" disabled={performanceBusy}><RefreshCw size={18} /></button></div>
      <div className="manager-stats">
        <div><span><Users size={18} /></span><strong>{somme("portefeuille")}</strong><small>Dossiers en cours</small></div>
        <div><span><Target size={18} /></span><strong>{somme("nouveaux")}</strong><small>Nouveaux</small></div>
        <div><span><TrendingUp size={18} /></span><strong>{somme("gagnes")}</strong><small>Gagnés</small></div>
        <div><span><CalendarDays size={18} /></span><strong>{somme("actions_en_retard")}</strong><small>Actions en retard</small></div>
      </div>
      <div className="manager-section-heading"><div><p className="eyebrow">L’ÉQUIPE</p><h2>Performance des agents</h2></div><span>{agentsVisibles.length} profil{agentsVisibles.length > 1 ? "s" : ""}</span></div>
      <div className="manager-controls">
        <details className="manager-filters"><summary className="manager-filter-title"><Filter size={15} /> Filtres {Number(!!rechercheAgent) + Number(statutAgent !== "tous") + Number(!!zoneAgent) > 0 && "actifs"}</summary><div className="manager-filter-grid"><label>Rechercher un agent<input value={rechercheAgent} onChange={(event) => setRechercheAgent(event.target.value)} placeholder="Nom de l’agent" /></label><label>Statut<select value={statutAgent} onChange={(event) => setStatutAgent(event.target.value)}><option value="tous">Tous</option><option value="actifs">Actifs</option><option value="inactifs">Inactifs</option></select></label><label>Zone<input value={zoneAgent} onChange={(event) => setZoneAgent(event.target.value)} placeholder="Ex. Cocody" /></label></div></details>
        <ColumnPicker options={teamColumns} visible={visibleTeamColumns} onChange={setVisibleTeamColumns} />
      </div>
      <div className="manager-filter-actions"><button className="export-button" onClick={exporterAgents}><Download size={15} /> Exporter l’équipe</button><button className="export-button" onClick={() => setProfilEdit("nouveau")}>Ajouter un agent</button></div>
      {performanceBusy && <p className="manager-muted">Actualisation des performances…</p>}
      {!performanceBusy && !performanceError && agents.length === 0 && <div className="empty"><Users size={26} /><strong>Aucun agent</strong><p>Créez les profils commerciaux depuis Loc Manager.</p></div>}
      <div className="manager-table-wrap"><table className="manager-table" style={{ minWidth: Math.max(360, visibleTeamColumns.length * 125 + 110) }}><thead><tr>{visibleTeamColumns.includes("agent") && <th>Agent</th>}{visibleTeamColumns.includes("statut") && <th>Statut</th>}{visibleTeamColumns.includes("zone") && <th>Zone</th>}{visibleTeamColumns.includes("portefeuille") && <th>Portefeuille</th>}{visibleTeamColumns.includes("nouveaux") && <th>Nouveaux</th>}{visibleTeamColumns.includes("gagnes") && <th>Gagnés</th>}{visibleTeamColumns.includes("perdus") && <th>Perdus</th>}{visibleTeamColumns.includes("actions") && <th>Actions faites</th>}{visibleTeamColumns.includes("retards") && <th>Retards</th>}<th>Actions</th></tr></thead><tbody>{agentsVisibles.map((agent) => <tr key={agent.user_id}>{visibleTeamColumns.includes("agent") && <td><strong>{agent.nom}</strong></td>}{visibleTeamColumns.includes("statut") && <td>{agent.actif ? "Actif" : "Inactif"}</td>}{visibleTeamColumns.includes("zone") && <td>{profils.find((profil) => profil.user_id === agent.user_id)?.zone || "—"}</td>}{visibleTeamColumns.includes("portefeuille") && <td>{agent.portefeuille}</td>}{visibleTeamColumns.includes("nouveaux") && <td>{agent.nouveaux}</td>}{visibleTeamColumns.includes("gagnes") && <td>{agent.gagnes}</td>}{visibleTeamColumns.includes("perdus") && <td>{agent.perdus}</td>}{visibleTeamColumns.includes("actions") && <td>{agent.actions_terminees}</td>}{visibleTeamColumns.includes("retards") && <td>{agent.actions_en_retard}</td>}<td>{onOpenAgentDossiers && <button onClick={() => onOpenAgentDossiers(agent.user_id)}>Dossiers</button>}<button onClick={() => setProfilEdit(profils.find((profil) => profil.user_id === agent.user_id) ?? { user_id: agent.user_id, zone: null })}>Modifier</button></td></tr>)}</tbody></table></div>
      <div className="agent-list">{agentsVisibles.map((agent) => <article className="agent-card" key={agent.user_id}><div className="agent-head"><span className="agent-avatar">{agent.nom.slice(0, 1).toUpperCase()}</span><div><strong>{agent.nom}</strong><small>{profils.find((profil) => profil.user_id === agent.user_id)?.zone || "Zone non renseignée"}</small></div><span className={`agent-status ${agent.actif ? "active" : ""}`}>{agent.actif ? "Actif" : "Inactif"}</span></div><div className="agent-metrics"><span><strong>{agent.portefeuille}</strong>Dossiers</span><span><strong>{agent.nouveaux}</strong>Nouveaux</span><span><strong>{agent.gagnes}</strong>Gagnés</span><span><strong>{agent.perdus}</strong>Perdus</span><span><strong>{agent.actions_terminees}</strong>Actions</span><span className="late"><strong>{agent.actions_en_retard}</strong>Retards</span></div><div className="agent-card-actions">{onOpenAgentDossiers && <button type="button" onClick={() => onOpenAgentDossiers(agent.user_id)}>Voir les dossiers</button>}<button type="button" onClick={() => setProfilEdit(profils.find((profil) => profil.user_id === agent.user_id) ?? { user_id: agent.user_id, zone: null })}>Modifier l’agent</button></div></article>)}</div>
      <p className="manager-footnote">Classement : gagnés, actions terminées et nouveaux dossiers décroissants, puis moins de retards et de pertes. Les nouveaux, gagnés, perdus et actions terminées suivent la période choisie. Le portefeuille et les retards reflètent l’état actuel. Les dossiers réattribués comptent pour leur agent actuel.</p>
    </>}

    {mode === "prospects" && <>
      <div className="manager-list-head"><div><h2>Gestion des dossiers</h2><p>{total} résultat{total > 1 ? "s" : ""}</p></div><div className="manager-filter-actions"><button className="export-button" onClick={onCreate}>Ajouter un dossier</button><button className="manager-refresh" onClick={() => void chargerProspects()} disabled={listBusy} aria-label="Actualiser les dossiers"><RefreshCw size={18} /></button></div></div>
      <div className="manager-controls"><details className="manager-filters"><summary className="manager-filter-title"><Filter size={15} /> Filtres {Object.values(filters).filter(Boolean).length > 0 && `(${Object.values(filters).filter(Boolean).length})`}</summary>
        <div className="search-field"><Search size={18} /><input value={filters.recherche} onChange={(event) => changerFiltre("recherche", event.target.value)} placeholder="Nom ou téléphone…" aria-label="Rechercher un prospect" /></div>
        <div className="manager-filter-grid">
          <label>Agent<select value={filters.agent} onChange={(event) => changerFiltre("agent", event.target.value)}><option value="">Tous les agents</option><option value="sans_agent">Non attribués</option>{agents.map((agent) => <option key={agent.user_id} value={agent.user_id}>{agent.nom}</option>)}</select></label>
          <label>Étape<select value={filters.etape} onChange={(event) => changerFiltre("etape", event.target.value)}><option value="">Toutes les étapes</option>{etapes.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
          <label>Source<select value={filters.source} onChange={(event) => changerFiltre("source", event.target.value)}><option value="">Toutes les sources</option>{sourceChoices.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
          <label>Température<select value={filters.temperature} onChange={(event) => changerFiltre("temperature", event.target.value)}><option value="">Toutes</option>{temperatures.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
          <label>Service<select value={filters.service} onChange={(event) => changerFiltre("service", event.target.value)}><option value="">Tous les services</option>{services.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
          <label>Statut<select value={filters.archive} onChange={(event) => changerFiltre("archive", event.target.value)}><option value="">Actifs</option><option value="archive">Archivés</option></select></label>
          <label>Depuis<input type="date" value={filters.debut} max={filters.fin || undefined} onChange={(event) => changerFiltre("debut", event.target.value)} /></label>
          <label>Jusqu’au<input type="date" value={filters.fin} min={filters.debut || undefined} onChange={(event) => changerFiltre("fin", event.target.value)} /></label>
        </div>
        <div className="manager-filter-actions"><button onClick={() => { setFilters({ recherche: "", agent: "", etape: "", source: "", temperature: "", service: "", archive: "", debut: "", fin: "" }); setPage(0); }}>Effacer les filtres</button></div>
      </details><ColumnPicker options={dossierColumns} visible={visibleDossierColumns} onChange={setVisibleDossierColumns} /></div>
      <div className="manager-filter-actions"><button className="export-button" onClick={() => void exporter()} disabled={exporting}><Download size={15} /> {exporting ? "Export…" : "Exporter CSV"}</button></div>
      {listBusy && <p className="manager-muted">Chargement des prospects…</p>}
      {!listBusy && rows.length === 0 && <div className="empty"><Users size={26} /><strong>Aucun prospect trouvé</strong><p>Modifiez les filtres pour élargir la recherche.</p></div>}
      <div className="manager-table-wrap"><table className="manager-table" style={{ minWidth: Math.max(360, visibleDossierColumns.length * 135 + 110) }}><thead><tr>{visibleDossierColumns.includes("contact") && <th>Contact</th>}{visibleDossierColumns.includes("services") && <th>Services</th>}{visibleDossierColumns.includes("agent") && <th>Agent</th>}{visibleDossierColumns.includes("source") && <th>Source</th>}{visibleDossierColumns.includes("etape") && <th>Étape</th>}{visibleDossierColumns.includes("date") && <th>Date</th>}<th>Actions</th></tr></thead><tbody>{rows.map((row) => <tr key={row.id}>{visibleDossierColumns.includes("contact") && <td><strong>{row.nom}</strong><small>{row.telephone || "—"}</small></td>}{visibleDossierColumns.includes("services") && <td>{(row.services ?? [row.service]).map((service) => label(services, service)).join(", ")}</td>}{visibleDossierColumns.includes("agent") && <td>{noms.get(row.owner_id ?? "") ?? "Non attribué"}</td>}{visibleDossierColumns.includes("source") && <td>{label(sourceChoices, row.source)}</td>}{visibleDossierColumns.includes("etape") && <td><span className="stage" data-stage={row.archived_at ? "archive" : row.etape}>{row.archived_at ? "Archivé" : label(etapes, row.etape)}</span></td>}{visibleDossierColumns.includes("date") && <td>{dateLabel(row.created_at)}</td>}<td><button onClick={() => setSelected(row)}>Gérer</button><button onClick={() => void ouvrirEdition(row)}>Modifier</button></td></tr>)}</tbody></table></div>
      <div className="manager-prospect-list">{rows.map((row) => <article className="manager-prospect-card" key={row.id}><button type="button" className="manager-prospect" onClick={() => setSelected(row)}><span className="avatar">{row.nom.slice(0, 1).toUpperCase()}</span><span className="manager-prospect-main"><strong>{row.nom}</strong><small>{(row.services ?? [row.service]).map((service) => label(services, service)).join(" · ")}</small><small>{noms.get(row.owner_id ?? "") ?? "Non attribué"} · {row.telephone || "Sans téléphone"}</small></span><span className="stage" data-stage={row.archived_at ? "archive" : row.etape}>{row.archived_at ? "Archivé" : label(etapes, row.etape)}</span></button><div className="manager-prospect-actions"><button type="button" onClick={() => setSelected(row)}>Gérer</button><button type="button" onClick={() => void ouvrirEdition(row)}>Modifier</button></div></article>)}</div>
      {total > 30 && <div className="manager-pagination"><button disabled={page === 0 || listBusy} onClick={() => setPage((value) => value - 1)}><ArrowLeft size={16} /> Précédent</button><span>{page + 1} / {Math.ceil(total / 30)}</span><button disabled={(page + 1) * 30 >= total || listBusy} onClick={() => setPage((value) => value + 1)}>Suivant <ArrowRight size={16} /></button></div>}
      <p className="manager-footnote">L’export reprend tous les prospects correspondant aux filtres, pas seulement cette page. Le fichier contient des données personnelles : partagez-le avec précaution.</p>
    </>}

    {selected && <div className="sheet-backdrop" onClick={() => setSelected(null)}><section className="sheet" role="dialog" aria-modal="true" aria-label="Gérer le prospect" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-head"><button className="icon-button" onClick={() => setSelected(null)} aria-label="Retour"><ArrowLeft size={20} /></button><span>GESTION DU PROSPECT</span><button className="icon-button" onClick={() => setSelected(null)} aria-label="Fermer"><X size={20} /></button></div><div className="sheet-body">
      {message && <div className="form-feedback" role="status">{message}</div>}
      <div className="detail-avatar">{selected.nom.slice(0, 1).toUpperCase()}</div><h2>{selected.nom}</h2><p>{(selected.services ?? [selected.service]).map((service) => label(services, service)).join(" · ")} · {label(sourceChoices, selected.source)}</p>
      {selected.telephone && <a className="call-button" href={`tel:${selected.telephone}`}>Appeler {selected.telephone}</a>}
      <div className="detail-block"><small>FICHE</small><p>{selected.localisation || "Lieu non précisé"} · Créé le {dateLabel(selected.created_at)}</p></div>
      <div className="detail-block"><small>SUIVI</small><p>Agent : {noms.get(selected.owner_id ?? "") ?? "Non attribué"} · Étape : {selected.archived_at ? "Archivé" : label(etapes, selected.etape)} · Température : {selected.temperature ? label(temperatures, selected.temperature) : "Non qualifié"}</p></div>
      {selected.besoin && <div className="detail-block"><small>BESOIN</small><p>{selected.besoin}</p></div>}
      <div className="detail-block"><small>HISTORIQUE DU SUIVI</small>{activities.length ? activities.map((item) => <p key={item.id}><strong>{dateLabel(item.effectuee_at)} · {item.type_activite}</strong><br />{item.resultat || "Compte rendu"}{item.decision && ` · ${item.decision === "programmer" ? "action programmée" : item.decision === "archiver" ? "dossier archivé" : `classé ${label(etapes, item.etape_classee ?? "")}`}`}{item.notes && <><br />{item.notes}</>}</p>) : <p>Aucun échange enregistré.</p>}</div>
      <button className="primary-button" onClick={() => void ouvrirEdition(selected)}>Modifier le dossier <ArrowRight size={17} /></button>
    </div></section></div>}
    {editing && <div className="sheet-backdrop" onClick={() => setEditing(null)}><section className="sheet" role="dialog" aria-modal="true" aria-label="Modifier le dossier" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-head"><button className="icon-button" onClick={() => setEditing(null)} aria-label="Retour"><ArrowLeft size={20} /></button><span>MODIFIER LE DOSSIER</span><button className="icon-button" onClick={() => setEditing(null)} aria-label="Fermer"><X size={20} /></button></div><div className="sheet-body"><h2>{editing.nom}</h2>{message && <div className="form-feedback" role="status">{message}</div>}<form key={editing.id} className="new-form" onSubmit={(event) => void enregistrerModification(event)}>
      <label className="field">Nom du contact<input name="nom" required minLength={2} defaultValue={editing.nom} /></label>
      <label className="field">Téléphone<input name="telephone" type="tel" defaultValue={editing.telephone ?? ""} /></label>
      <label className="field">Commune ou localité<select name="localite_id" defaultValue={editing.localite_id ?? ""}><option value="">Autre localisation</option>{localites.filter((item) => item.actif || item.id === editing.localite_id).map((item) => <option key={item.id} value={item.id} disabled={!item.actif}>{item.nom}{item.actif ? "" : " (désactivée)"}</option>)}</select></label>
      <label className="field">Localisation libre<input name="localisation" defaultValue={editing.localisation ?? ""} /></label>
      <label className="field">Rôle du contact<select name="role_contact" defaultValue={editing.role_contact ?? "inconnu"}><option value="inconnu">À préciser</option><option value="proprietaire">Propriétaire</option><option value="gerant">Gérant</option><option value="gardien">Gardien</option><option value="intermediaire">Intermédiaire</option></select></label>
      <fieldset className="field"><legend>Services recherchés</legend><div className="service-choices">{services.map(([value, title]) => <label key={value}><input type="checkbox" name="services" value={value} defaultChecked={(editing.services ?? [editing.service]).includes(value)} /> {title}</label>)}</div></fieldset>
      <label className="field">Agent<select name="owner_id" defaultValue={editing.owner_id ?? ""}><option value="">Non attribué</option>{agents.filter((agent) => agent.actif || agent.user_id === editing.owner_id).map((agent) => <option key={agent.user_id} value={agent.user_id}>{agent.nom}</option>)}</select></label>
      <p className="field-help">Changer l’agent réattribue tous les dossiers et actions ouverts de ce contact.</p>
      <label className="field">Source<select name="source" defaultValue={editing.source}>{sourceChoices.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <label className="field">Étape<select name="etape" defaultValue={editing.etape}>{etapes.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <label className="field">Température<select name="temperature" defaultValue={editing.temperature ?? ""}><option value="">Non qualifié</option>{temperatures.map(([value, title]) => <option key={value} value={value}>{title}</option>)}</select></label>
      <label className="field">Type de bien<input name="type_bien" defaultValue={editing.type_bien ?? ""} /></label>
      <label className="field">Adresse du bien<input name="adresse_bien" defaultValue={editing.adresse_bien ?? ""} /></label>
      <div className="gps-coordinates"><label className="field">Latitude GPS<input ref={gpsLatitudeRef} name="gps_latitude" type="number" step="any" min="-90" max="90" defaultValue={editing.gps_latitude ?? ""} /></label><label className="field">Longitude GPS<input ref={gpsLongitudeRef} name="gps_longitude" type="number" step="any" min="-180" max="180" defaultValue={editing.gps_longitude ?? ""} /></label></div><button type="button" className="secondary-button" onClick={() => { if (!navigator.geolocation) { setMessage("GPS indisponible sur cet appareil."); return; } navigator.geolocation.getCurrentPosition((position) => { if (gpsLatitudeRef.current) gpsLatitudeRef.current.value = position.coords.latitude.toFixed(6); if (gpsLongitudeRef.current) gpsLongitudeRef.current.value = position.coords.longitude.toFixed(6); setMessage("Position GPS renseignée."); }, () => setMessage("Position GPS non obtenue."), { enableHighAccuracy: true, timeout: 10000 }); }}>Utiliser ma position actuelle</button>
      <label className="field">Agence en place<select name="agence_en_place" defaultValue={editing.agence_en_place ?? ""}><option value="">Non renseigné</option><option value="oui">Oui</option><option value="non">Non</option><option value="inconnu">Ne sait pas</option></select></label>
      <label className="field">Besoin exprimé<textarea name="besoin" rows={3} defaultValue={editing.besoin ?? ""} /></label>
      <button className="primary-button" disabled={saving}>{saving ? "Enregistrement…" : "Enregistrer les modifications"}<Check size={18} /></button>
    </form></div></section></div>}
    {profilEdit && <div className="sheet-backdrop" onClick={() => setProfilEdit(null)}><section className="sheet compact-sheet" role="dialog" aria-modal="true" aria-label="Gérer un agent" onClick={(event) => event.stopPropagation()}><div className="sheet-handle" /><div className="sheet-head"><button className="icon-button" onClick={() => setProfilEdit(null)} aria-label="Retour"><ArrowLeft size={20} /></button><span>{profilEdit === "nouveau" ? "AJOUTER UN AGENT" : "MODIFIER L’AGENT"}</span><button className="icon-button" onClick={() => setProfilEdit(null)} aria-label="Fermer"><X size={20} /></button></div><div className="sheet-body"><p>Le compte et le droit Commercial se créent dans Loc Manager. Liez ici son profil terrain.</p><form className="new-form" onSubmit={(event) => void enregistrerProfil(event)}>{profilEdit === "nouveau" && <label className="field">Compte commercial<select name="user_id" required defaultValue=""><option value="" disabled>Choisir un compte actif</option>{eligibles.filter((item) => item.actif && !item.profil_existant).map((item) => <option key={item.user_id} value={item.user_id}>{item.nom}</option>)}</select></label>}<label className="field">Zone de prospection<input name="zone" defaultValue={profilEdit === "nouveau" ? "" : profilEdit.zone ?? ""} placeholder="Ex. Cocody et Bingerville" /></label><button className="primary-button" disabled={saving || profilEdit === "nouveau" && !eligibles.some((item) => item.actif && !item.profil_existant)}>{saving ? "Enregistrement…" : "Enregistrer"}<Check size={17} /></button>{profilEdit === "nouveau" && !eligibles.some((item) => item.actif && !item.profil_existant) && <p className="field-help">Aucun compte éligible. Créez d’abord un utilisateur avec le droit Commercial dans Loc Manager.</p>}</form></div></section></div>}
  </div>;
}
