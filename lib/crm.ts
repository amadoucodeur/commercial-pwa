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
