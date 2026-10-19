import "next-auth";

declare module "next-auth" {
  interface User { organisationId?: string }
  interface Session {
    accessToken: string;
    accessDenied?: "consultant" | "sans_acces";
    user: { id: string; organisationId: string; name?: string | null };
  }
}
