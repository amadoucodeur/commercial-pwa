import "next-auth";

type Niveau = "reader" | "editor";

declare module "next-auth" {
  interface User { organisationId?: string; acces?: { commercial: Niveau | null; vitrine: Niveau | null } }
  interface Session {
    accessToken: string;
    acces: { commercial: Niveau | null; vitrine: Niveau | null };
    accessDenied?: "consultant" | "sans_acces" | "inactif";
    user: { id: string; organisationId: string; name?: string | null };
  }
}
