import type { SupabaseClient } from "@supabase/supabase-js";

// Les tables site_* n'acceptent que cette organisation (contraintes et RLS côté Supabase).
export const ORG_VITRINE = "bb05b6ec-8936-41aa-96a4-dbdec4416914";
export const SITE_URL = (process.env.NEXT_PUBLIC_VITRINE_URL || "https://www.trabad.com").replace(/\/$/, "");
export const BUCKET = "site-medias";
export const MAX_PHOTOS = 20;
export const TAILLE_MAX = 10 * 1024 * 1024;
export const TYPES_IMAGE = ["image/jpeg", "image/png", "image/webp", "image/avif"];

export type SectionVitrine = "biens" | "ventes" | "formules" | "contenus";
export const sectionsVitrine: Array<[SectionVitrine, string]> = [
  ["biens", "Location"], ["ventes", "Ventes"], ["formules", "Formules"], ["contenus", "Contenus"],
];

export type Photo = { id: string; bien_id: string; chemin: string; alt: string; ordre: number };
export type Bien = {
  id?: string;
  reference?: string;
  categorie: "location" | "vente";
  titre: string;
  slug: string;
  type_bien: string;
  ville: string;
  commune: string | null;
  quartier: string | null;
  adresse: string | null;
  adresse_visibilite: "masquee" | "affichee" | "apres_contact";
  latitude: number | string | null;
  longitude: number | string | null;
  prix: number | string | null;
  prix_sur_demande: boolean;
  surface: number | string | null;
  chambres: number | string | null;
  salles_de_bain: number | string | null;
  parking: number | string | null;
  piscine: boolean;
  electricite: boolean;
  eau: boolean;
  description: string;
  statut: "disponible" | "sous_option" | "vendu" | "archive";
  publication: "brouillon" | "publie";
  en_vedette: boolean;
  badges: string[];
  commercial_id: string | null;
  created_at?: string;
  updated_at?: string;
  site_bien_photos?: Array<Pick<Photo, "id" | "chemin" | "ordre">>;
};
export type Formule = {
  id?: string;
  nom: string;
  accroche: string;
  commission: number | string;
  jour_reversement: number | string | null;
  avantages: string[];
  exclusions: string[];
  conditions: string;
  recommande: boolean;
  ordre: number | string;
  publication: "brouillon" | "publie";
};
export type Contenu = { cle: string; titre: string; texte: string; image_url: string | null; updated_at?: string };
export type CommercialSite = { id: string; nom: string };

export const typesBien = ["Villa", "Maison", "Duplex", "Appartement", "Studio", "Terrain", "Local commercial", "Bureau", "Magasin", "Immeuble"];
export const communesAbidjan = ["Abobo", "Adjamé", "Anyama", "Attécoubé", "Bingerville", "Cocody", "Koumassi", "Marcory", "Plateau", "Port-Bouët", "Songon", "Treichville", "Yopougon"];
// Les badges que le site public sait libeller ; il en affiche deux sur la carte.
export const badgesSite: Array<[string, string]> = [["nouveau", "Nouveau"], ["exclusivite", "Exclusivité"], ["premium", "Premium"], ["ideal_investisseur", "Idéal investisseur"]];
export const statutsBien: Array<[Bien["statut"], string]> = [["disponible", "Disponible"], ["sous_option", "Sous option"], ["vendu", "Vendu / loué"], ["archive", "Archivé"]];
export const visibilitesAdresse: Array<[Bien["adresse_visibilite"], string]> = [["masquee", "Masquée"], ["apres_contact", "Après contact"], ["affichee", "Affichée"]];
export const libellesContenus: Record<string, [string, string]> = {
  hero: ["Bandeau d’accueil", "Le grand titre en haut de la page d’accueil."],
  investisseur: ["Investisseurs", "La section dédiée aux opportunités d’investissement."],
  recherche: ["Recherche personnalisée", "L’encart proposé quand un visiteur ne trouve pas son bien."],
};

const CHAMPS_BIEN = [
  "titre", "slug", "categorie", "type_bien", "ville", "commune", "quartier", "adresse", "adresse_visibilite",
  "latitude", "longitude", "prix", "prix_sur_demande", "surface", "chambres", "salles_de_bain", "parking",
  "piscine", "electricite", "eau", "description", "statut", "publication", "en_vedette", "badges", "commercial_id",
] as const;
const CHAMPS_FORMULE = ["nom", "accroche", "commission", "jour_reversement", "avantages", "exclusions", "conditions", "recommande", "ordre", "publication"] as const;
const NUMERIQUES = new Set(["latitude", "longitude", "prix", "surface", "chambres", "salles_de_bain", "parking", "commission", "jour_reversement", "ordre"]);
const TEXTES_FACULTATIFS = new Set(["commune", "quartier", "adresse", "commercial_id"]);

export const nouveauBien = (categorie: Bien["categorie"]): Bien => ({
  categorie, titre: "", slug: "", type_bien: categorie === "vente" ? "Villa" : "Appartement", ville: "Abidjan",
  commune: null, quartier: null, adresse: null, adresse_visibilite: "masquee", latitude: null, longitude: null,
  prix: null, prix_sur_demande: false, surface: null, chambres: null, salles_de_bain: null, parking: null,
  piscine: false, electricite: false, eau: false, description: "", statut: "disponible", publication: "brouillon",
  en_vedette: false, badges: [], commercial_id: null,
});
export const nouvelleFormule = (ordre: number): Formule => ({
  nom: "", accroche: "", commission: 10, jour_reversement: 10, avantages: [], exclusions: [], conditions: "",
  recommande: false, ordre, publication: "brouillon",
});

export const slugify = (texte: string) => texte.normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 90);

const nettoyer = (cle: string, valeur: unknown) => {
  if (NUMERIQUES.has(cle)) return valeur === "" || valeur === null || valeur === undefined ? null : Number(valeur);
  if (TEXTES_FACULTATIFS.has(cle)) return typeof valeur === "string" && valeur.trim() === "" ? null : typeof valeur === "string" ? valeur.trim() : valeur;
  return typeof valeur === "string" && cle !== "description" && cle !== "conditions" ? valeur.trim() : valeur;
};
export function payloadBien(bien: Bien) {
  const payload = Object.fromEntries(CHAMPS_BIEN.map((cle) => [cle, nettoyer(cle, bien[cle])])) as Record<string, unknown>;
  if (!payload.slug) payload.slug = slugify(String(payload.titre ?? ""));
  return payload;
}
export const payloadFormule = (formule: Formule) =>
  Object.fromEntries(CHAMPS_FORMULE.map((cle) => [cle, nettoyer(cle, formule[cle])])) as Record<string, unknown>;

// Mêmes conditions que le déclencheur site_validate_publication, pour prévenir avant l'envoi.
export function verificationsPublication(bien: Bien, nombrePhotos: number) {
  const description = bien.description.trim().length;
  return [
    { ok: bien.titre.trim().length >= 5, texte: "Un titre d’au moins 5 caractères" },
    { ok: description >= 20, texte: `Une description d’au moins 20 caractères (${Math.min(description, 20)}/20)` },
    { ok: bien.prix_sur_demande || (bien.prix !== null && bien.prix !== ""), texte: "Un prix, ou « prix sur demande »" },
    { ok: nombrePhotos > 0, texte: "Au moins une photo" },
  ];
}

export function erreurLisible(erreur: unknown) {
  const message = erreur && typeof erreur === "object" && "message" in erreur ? String(erreur.message) : String(erreur ?? "");
  if (message.includes("site_biens_organisation_id_slug_key")) return "Cette adresse web est déjà utilisée par une autre annonce. Modifiez le titre ou l’adresse web.";
  if (message.includes("row-level security") || message.includes("permission denied")) return "Votre compte ne peut pas modifier le site. Demandez le droit « éditeur » sur le site vitrine.";
  if (message.toLowerCase().includes("jwt")) return "Votre session a expiré. Actualisez la page puis réessayez.";
  if (message.includes("Failed to fetch") || message.includes("NetworkError")) return "Connexion indisponible. Vérifiez votre réseau puis réessayez.";
  if (message.includes("site_biens_check")) return "Le titre doit faire au moins 5 caractères et l’adresse web ne contenir que des lettres, chiffres et tirets.";
  return message || "Une erreur inattendue est survenue.";
}

export const urlPublique = (client: SupabaseClient, chemin: string) => client.storage.from(BUCKET).getPublicUrl(chemin).data.publicUrl;

export const formatPrix = (bien: Pick<Bien, "prix" | "prix_sur_demande" | "categorie">) =>
  bien.prix_sur_demande || bien.prix === null || bien.prix === ""
    ? "Prix sur demande"
    : `${new Intl.NumberFormat("fr-FR").format(Number(bien.prix))} FCFA${bien.categorie === "location" ? " / mois" : ""}`;

const EXTENSIONS: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/avif": "avif" };

// Les photos de téléphone pèsent souvent plusieurs Mo : on les réduit à 2400 px avant l'envoi.
// En cas d'échec (format non décodable, navigateur ancien), le fichier d'origine est conservé.
export async function preparerImage(fichier: File): Promise<File> {
  if (fichier.size < 900 * 1024 || typeof createImageBitmap !== "function") return fichier;
  try {
    const image = await createImageBitmap(fichier);
    const echelle = Math.min(1, 2400 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(image.width * echelle);
    canvas.height = Math.round(image.height * echelle);
    canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.close();
    const encoder = (type: string) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, 0.84));
    let blob = await encoder("image/webp");
    if (!blob || blob.type !== "image/webp") blob = await encoder("image/jpeg");
    if (!blob || blob.size >= fichier.size || !EXTENSIONS[blob.type]) return fichier;
    return new File([blob], fichier.name.replace(/\.[^.]+$/, "") + "." + EXTENSIONS[blob.type], { type: blob.type });
  } catch {
    return fichier;
  }
}

export const imageAcceptee = (fichier: File) => TYPES_IMAGE.includes(fichier.type) && fichier.size > 0 && fichier.size <= TAILLE_MAX;

export async function envoyerImage(client: SupabaseClient, dossier: string, fichier: File) {
  const pret = await preparerImage(fichier);
  if (!imageAcceptee(pret)) throw new Error(`${fichier.name} : JPG, PNG, WebP ou AVIF de 10 Mo maximum.`);
  const chemin = `${ORG_VITRINE}/${dossier}/${crypto.randomUUID()}.${EXTENSIONS[pret.type]}`;
  const { error } = await client.storage.from(BUCKET).upload(chemin, pret, { contentType: pret.type, cacheControl: "31536000" });
  if (error) throw new Error(`${fichier.name} : ${erreurLisible(error)}`);
  return chemin;
}

// Envoie les photos une par une (réseau mobile) et les rattache au bien dans l'ordre choisi.
export async function ajouterPhotos(
  client: SupabaseClient, bienId: string, titre: string, fichiers: File[], dejaPresentes: number,
  progression?: (fait: number, total: number) => void,
) {
  const place = Math.max(0, MAX_PHOTOS - dejaPresentes);
  const ajoutees: Photo[] = [];
  const echecs: File[] = fichiers.slice(place);
  const erreurs: string[] = echecs.length ? [`Maximum ${MAX_PHOTOS} photos par annonce.`] : [];
  const aEnvoyer = fichiers.slice(0, place);
  for (const [index, fichier] of aEnvoyer.entries()) {
    progression?.(index, aEnvoyer.length);
    let chemin: string | null = null;
    try {
      chemin = await envoyerImage(client, bienId, fichier);
      const { data, error } = await client.from("site_bien_photos")
        .insert({ organisation_id: ORG_VITRINE, bien_id: bienId, chemin, alt: titre, ordre: dejaPresentes + ajoutees.length })
        .select("id,bien_id,chemin,alt,ordre").single();
      if (error) throw new Error(`${fichier.name} : ${erreurLisible(error)}`);
      ajoutees.push(data as Photo);
    } catch (erreur) {
      if (chemin) await client.storage.from(BUCKET).remove([chemin]);
      echecs.push(fichier);
      erreurs.push(erreur instanceof Error ? erreur.message : erreurLisible(erreur));
    }
  }
  progression?.(aEnvoyer.length, aEnvoyer.length);
  return { ajoutees, echecs, erreurs };
}
