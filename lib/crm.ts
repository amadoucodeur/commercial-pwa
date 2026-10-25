export type Localite = {
  id: string;
  nom: string;
  type: "commune" | "localite";
  actif: boolean;
};

export type Contact = {
  id: string;
  owner_id: string | null;
  nom: string;
  telephone: string | null;
  telephone_normalise: string;
  localisation: string | null;
  role_contact?: string | null;
};

export type ProspectPayload = {
  nom: string;
  telephone: string;
  contactId: string | null;
  ownerId: string | null;
  services: string[];
  source: string;
  localiteId: string;
  roleContact: string;
  typeBien: string | null;
  adresseBien: string | null;
  agenceEnPlace: string | null;
  besoin: string | null;
  temperature: string | null;
  action: string | null;
  echeanceAt: string | null;
  gpsLatitude: number | null;
  gpsLongitude: number | null;
  gpsPrecisionM: number | null;
  gpsSource: "automatique" | "manuel" | null;
};

export const services = [
  ["gestion_locative", "Gestion locative"],
  ["vente", "Vente"],
  ["location", "Location"],
  ["construction", "Construction"],
  ["rehabilitation", "Réhabilitation"],
  ["assistance_juridique", "Assistance juridique"],
  ["autre", "Autre"],
] as const;

export const sources = [
  ["terrain", "Terrain"],
  ["facebook", "Facebook"],
  ["instagram", "Instagram"],
  ["linkedin", "LinkedIn"],
  ["ads", "Publicité en ligne"],
  ["whatsapp", "WhatsApp"],
  ["site", "Site web"],
  ["recommandation", "Recommandation"],
  ["appel", "Appel entrant"],
  ["autre", "Autre"],
] as const;

export const typesBien = [
  "Appartement", "Villa", "Immeuble", "Terrain", "Commerce",
  "Bureau", "Entrepôt", "Autre",
] as const;

export const actions = [
  "Rappeler", "Organiser une visite", "Fixer un rendez-vous",
  "Envoyer un message", "Préparer une proposition", "Relancer", "Autre",
] as const;

export const motifsPerte = [
  "Honoraires ou prix jugés trop élevés", "A choisi une autre agence", "Projet abandonné",
  "Injoignable après plusieurs relances", "Bien déjà loué ou vendu", "Demande non conforme à nos services",
  "Pas de besoin réel", "Autre",
] as const;
export const motifsReport = [
  "Pas disponible pour le moment", "Budget pas encore prêt", "Attend une décision (famille, associés)",
  "Bien en travaux ou indisponible", "Autre",
] as const;
export const motifsArchivage = [
  "Doublon", "Coordonnées erronées", "Hors zone d’intervention", "Contact non pertinent",
  "Injoignable", "Autre",
] as const;
export const motifsTransfert = [
  "Départ de l’agent", "Rééquilibrage des portefeuilles", "Zone géographique", "Demande du client",
  "Absence prolongée", "Autre",
] as const;
export const motifsDesactivation = [
  "Ne fait plus partie de l’équipe", "Changement de poste", "Absence prolongée", "Autre",
] as const;

// Perdre, reporter ou archiver un dossier exige d'en donner la raison (contrôlé aussi côté serveur).
export function motifsPour(etape: string | null, archiver = false): readonly string[] | null {
  if (archiver) return motifsArchivage;
  if (etape === "perdu") return motifsPerte;
  if (etape === "reporte") return motifsReport;
  return null;
}
