// Périodes prêtes à l'emploi pour les performances, en dates d'Abidjan (UTC+0, sans heure d'été).

export type PeriodeRapide =
  | "aujourdhui" | "hier" | "7j" | "30j"
  | "semaine" | "semaine_derniere" | "mois" | "mois_dernier"
  | "trimestre" | "trimestre_dernier" | "annee" | "annee_derniere";

export const PERIODES_RAPIDES: [PeriodeRapide, string][] = [
  ["aujourdhui", "Aujourd’hui"], ["hier", "Hier"], ["7j", "7 derniers jours"], ["30j", "30 derniers jours"],
  ["semaine", "Cette semaine"], ["semaine_derniere", "Semaine dernière"],
  ["mois", "Ce mois-ci"], ["mois_dernier", "Mois dernier"],
  ["trimestre", "Ce trimestre"], ["trimestre_dernier", "Trimestre dernier"],
  ["annee", "Cette année"], ["annee_derniere", "Année dernière"],
];

export type Plage = { debut: string; fin: string };

const iso = (date: Date) => date.toISOString().slice(0, 10);
const jour = (annee: number, mois: number, j: number) => new Date(Date.UTC(annee, mois, j));

export function plageRapide(cle: PeriodeRapide, maintenant = new Date()): Plage {
  const a = maintenant.getUTCFullYear();
  const m = maintenant.getUTCMonth();
  const j = maintenant.getUTCDate();
  const aujourdHui = jour(a, m, j);
  const decale = (jours: number) => jour(a, m, j + jours);
  const lundi = (j - ((maintenant.getUTCDay() + 6) % 7));
  const t = Math.floor(m / 3) * 3;
  switch (cle) {
    case "aujourdhui": return { debut: iso(aujourdHui), fin: iso(aujourdHui) };
    case "hier": return { debut: iso(decale(-1)), fin: iso(decale(-1)) };
    case "7j": return { debut: iso(decale(-6)), fin: iso(aujourdHui) };
    case "30j": return { debut: iso(decale(-29)), fin: iso(aujourdHui) };
    case "semaine": return { debut: iso(jour(a, m, lundi)), fin: iso(aujourdHui) };
    case "semaine_derniere": return { debut: iso(jour(a, m, lundi - 7)), fin: iso(jour(a, m, lundi - 1)) };
    case "mois": return { debut: iso(jour(a, m, 1)), fin: iso(aujourdHui) };
    case "mois_dernier": return { debut: iso(jour(a, m - 1, 1)), fin: iso(jour(a, m, 0)) };
    case "trimestre": return { debut: iso(jour(a, t, 1)), fin: iso(aujourdHui) };
    case "trimestre_dernier": return { debut: iso(jour(a, t - 3, 1)), fin: iso(jour(a, t, 0)) };
    case "annee": return { debut: iso(jour(a, 0, 1)), fin: iso(aujourdHui) };
    case "annee_derniere": return { debut: iso(jour(a - 1, 0, 1)), fin: iso(jour(a - 1, 11, 31)) };
  }
}

/** Période rapide correspondant exactement à la plage, sinon « personnalisée ». */
export function periodeDe(plage: Plage, maintenant = new Date()): PeriodeRapide | "personnalisee" {
  const trouvee = PERIODES_RAPIDES.find(([cle]) => {
    const p = plageRapide(cle, maintenant);
    return p.debut === plage.debut && p.fin === plage.fin;
  });
  return trouvee?.[0] ?? "personnalisee";
}

export const nombreDeJours = ({ debut, fin }: Plage) =>
  Math.round((Date.parse(`${fin}T00:00:00Z`) - Date.parse(`${debut}T00:00:00Z`)) / 86_400_000) + 1;

export function libellePlage(plage: Plage) {
  const format = (valeur: string, annee: boolean) => new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC", day: "numeric", month: "short", ...(annee ? { year: "numeric" } : {}),
  }).format(new Date(`${valeur}T00:00:00Z`));
  const n = nombreDeJours(plage);
  if (plage.debut === plage.fin) return format(plage.debut, true);
  const memeAnnee = plage.debut.slice(0, 4) === plage.fin.slice(0, 4);
  return `Du ${format(plage.debut, !memeAnnee)} au ${format(plage.fin, true)} · ${n} jours`;
}
