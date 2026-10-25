"use client";

import { useEffect, useMemo, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { Archive, ArrowRightLeft, CalendarPlus, CalendarX, Flag, MessageSquare, RotateCcw, Sparkles } from "lucide-react";

type Evenement = {
  survenu_at: string;
  categorie: "dossier" | "echange" | "action";
  type: string;
  auteur: string | null;
  ancien_agent: string | null;
  nouvel_agent: string | null;
  ancienne_etape: string | null;
  nouvelle_etape: string | null;
  motif: string | null;
  titre: string | null;
  details: string | null;
};

const etapes: Record<string, string> = {
  nouveau: "Nouveau", contacte: "Contact établi", rdv: "Rendez-vous", proposition: "Proposition",
  negociation: "Négociation", gagne: "Gagné", perdu: "Perdu", reporte: "Reporté",
};
const echanges: Record<string, string> = {
  appel: "Appel", visite: "Visite", rendez_vous: "Rendez-vous", message: "Message", note: "Note",
};
const dateHeure = (value: string) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));
const date = (value: string) => new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Africa/Abidjan", day: "numeric", month: "short", year: "numeric",
}).format(new Date(value));

function decrire(item: Evenement) {
  const auteur = item.auteur ?? "Système";
  if (item.categorie === "echange") return {
    icone: MessageSquare,
    titre: `${echanges[item.type] ?? item.type} · ${item.titre || "Compte rendu"}`,
    texte: [item.details, item.nouvelle_etape && `Classé ${etapes[item.nouvelle_etape] ?? item.nouvelle_etape}`].filter(Boolean).join(" · "),
    auteur,
  };
  if (item.categorie === "action") return item.type === "annulee"
    ? { icone: CalendarX, titre: `Action annulée : ${item.titre}`, texte: item.nouvel_agent ? `Pour ${item.nouvel_agent}` : "", auteur: null }
    : { icone: CalendarPlus, titre: `Action programmée : ${item.titre}`, texte: [item.details && `Prévue le ${item.details}`, item.nouvel_agent && `pour ${item.nouvel_agent}`].filter(Boolean).join(" "), auteur };
  switch (item.type) {
    case "creation": return { icone: Sparkles, titre: "Dossier créé", texte: item.nouvel_agent ? `Confié à ${item.nouvel_agent}` : "Sans agent attribué", auteur: item.auteur ?? "Import ou système" };
    case "transfert": return { icone: ArrowRightLeft, titre: "Dossier transféré", texte: `${item.ancien_agent ?? "Non attribué"} → ${item.nouvel_agent ?? "Non attribué"}`, auteur };
    case "etape": return { icone: Flag, titre: `Étape : ${etapes[item.nouvelle_etape ?? ""] ?? item.nouvelle_etape}`, texte: item.ancienne_etape ? `Auparavant ${etapes[item.ancienne_etape] ?? item.ancienne_etape}` : "", auteur };
    case "archivage": return { icone: Archive, titre: "Dossier archivé", texte: "", auteur };
    default: return { icone: RotateCcw, titre: "Dossier restauré", texte: "", auteur };
  }
}

export function DossierHistory({ client, dossierId, refreshKey = 0 }: { client: SupabaseClient; dossierId: string; refreshKey?: number }) {
  const [items, setItems] = useState<Evenement[] | null>(null);
  const [erreur, setErreur] = useState("");

  useEffect(() => {
    let active = true;
    setItems(null);
    setErreur("");
    void Promise.resolve(client.rpc("crm_historique_dossier", { p_id: dossierId })).then(({ data, error }) => {
      if (!active) return;
      if (error) setErreur(navigator.onLine ? `Historique indisponible : ${error.message}` : "Historique consultable une fois en ligne.");
      else setItems((data ?? []) as Evenement[]);
    }).catch(() => { if (active) setErreur("Historique consultable une fois en ligne."); });
    return () => { active = false; };
  }, [client, dossierId, refreshKey]);

  // Propriétaires successifs, du plus ancien au plus récent.
  const proprietaires = useMemo(() => {
    const chronologie = [...(items ?? [])].filter((item) => item.categorie === "dossier" && (item.type === "creation" || item.type === "transfert")).reverse();
    return chronologie.map((item, index) => ({
      nom: item.nouvel_agent ?? "Non attribué",
      debut: item.survenu_at,
      fin: chronologie[index + 1]?.survenu_at ?? null,
    }));
  }, [items]);
  const creation = items?.find((item) => item.categorie === "dossier" && item.type === "creation");

  if (erreur) return <p className="field-help">{erreur}</p>;
  if (!items) return <p className="field-help">Chargement de l’historique…</p>;
  return <div className="history">
    <div className="history-summary">
      <p><strong>Créé</strong> {creation ? `le ${dateHeure(creation.survenu_at)} par ${creation.auteur ?? "import ou système"}` : "—"}</p>
      {proprietaires.length > 0 && <div><strong>Propriétaires</strong><ol className="history-owners">{proprietaires.map((item, index) => <li key={`${item.debut}-${index}`}><span>{item.nom}</span><small>{item.fin ? `${date(item.debut)} → ${date(item.fin)}` : `depuis le ${date(item.debut)}`}</small></li>)}</ol></div>}
    </div>
    {items.length === 0 ? <p className="field-help">Aucun événement enregistré.</p> : <ol className="history-timeline">{items.map((item, index) => {
      const { icone: Icone, titre, texte, auteur } = decrire(item);
      return <li key={`${item.survenu_at}-${index}`} data-category={item.categorie}>
        <span className="history-icon"><Icone size={15} /></span>
        <div><strong>{titre}</strong>{texte && <p>{texte}</p>}{item.motif && <p className="history-motif">Raison : {item.motif}</p>}<small>{dateHeure(item.survenu_at)}{auteur ? ` · ${auteur}` : ""}</small></div>
      </li>;
    })}</ol>}
  </div>;
}
