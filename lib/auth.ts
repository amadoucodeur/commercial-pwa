import NextAuth, { CredentialsSignin } from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { createClient } from "@supabase/supabase-js";
import { compare } from "bcryptjs";
import { SignJWT } from "jose";

const requiredEnv = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`Configuration manquante : ${name}`);
  return value;
};

const supabaseAdmin = createClient(
  requiredEnv("NEXT_PUBLIC_SUPABASE_URL"),
  requiredEnv("SUPABASE_SERVICE_ROLE_KEY"),
  { auth: { persistSession: false } },
);

type Refus = "consultant" | "sans_acces" | "inactif";
type Niveau = "reader" | "editor";
export type Acces = { commercial: Niveau | null; vitrine: Niveau | null };
type Roles = { commercial?: string; admin?: string; biens_site?: string } | null;

// Seule l'organisation TRABAD administre le site vitrine (voir can_manage_trabad_vitrine).
const ORGANISATION_VITRINE = "bb05b6ec-8936-41aa-96a4-dbdec4416914";

class CommercialAccessDenied extends CredentialsSignin {
  code: string;

  constructor(code: Refus) {
    super();
    this.code = code;
  }
}

// Un profil commercial désactivé bloque l'agent ; un responsable garde son accès.
async function profilInactif(userId: string, roles: Roles) {
  if (roles?.commercial === "editor" || roles?.admin === "admin") return false;
  const { data } = await supabaseAdmin.from("crm_profiles").select("actif").eq("user_id", userId).maybeSingle();
  return data?.actif === false;
}

// Mêmes règles que la RLS : le droit commercial ouvre le CRM, biens_site (ou admin) la vitrine.
async function droits(user: { id: string; organisation_id: string; roles: Roles }): Promise<{ acces: Acces } | { refus: Refus }> {
  const roles = user.roles ?? {};
  const inactif = (roles.commercial === "reader" || roles.commercial === "editor") && await profilInactif(user.id, roles);
  const commercial = !inactif && (roles.commercial === "reader" || roles.commercial === "editor") ? roles.commercial : null;
  const vitrine = user.organisation_id !== ORGANISATION_VITRINE ? null
    : roles.admin === "admin" || roles.biens_site === "editor" ? "editor"
      : roles.biens_site === "reader" ? "reader" : null;
  if (commercial || vitrine) return { acces: { commercial, vitrine } };
  return { refus: inactif ? "inactif" : roles.commercial === "viewer" ? "consultant" : "sans_acces" };
}

async function accessToken(userId: string, organisationId: string) {
  return new SignJWT({ role: "authenticated", organisation_id: organisationId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(new TextEncoder().encode(requiredEnv("SUPABASE_JWT_SECRET")));
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 7 * 24 * 60 * 60 },
  pages: { signIn: "/connexion" },
  providers: [Credentials({
    credentials: { identifiant: {}, password: {} },
    async authorize(credentials) {
      const identifiant = String(credentials?.identifiant ?? "").trim();
      const password = String(credentials?.password ?? "");
      if (!identifiant || !password || identifiant.length > 255 || password.length > 1024) return null;

      const { data: user } = await supabaseAdmin.from("users")
        .select("id,identifiant,fullname,hashed_password,is_active,organisation_id,roles")
        .eq("identifiant", identifiant).maybeSingle();
      if (!user?.is_active || !user.hashed_password || !await compare(password, user.hashed_password)) return null;

      const resultat = await droits(user);
      if ("refus" in resultat) throw new CommercialAccessDenied(resultat.refus);

      const { data: organisation } = await supabaseAdmin.from("organisations")
        .select("is_active").eq("id", user.organisation_id).maybeSingle();
      if (!organisation?.is_active) return null;
      return { id: user.id, name: user.fullname || user.identifiant.split("@")[0], organisationId: user.organisation_id, acces: resultat.acces };
    },
  })],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.organisationId = user.organisationId;
        token.name = user.name;
        token.acces = user.acces;
      }
      if (token.userId && token.organisationId) {
        const { data: currentUser } = await supabaseAdmin.from("users")
          .select("is_active,roles,organisation_id")
          .eq("id", token.userId).maybeSingle();
        const resultat = currentUser?.is_active && currentUser.organisation_id === token.organisationId
          ? await droits({ id: String(token.userId), organisation_id: currentUser.organisation_id, roles: currentUser.roles })
          : { refus: "sans_acces" as const };
        if ("refus" in resultat) {
          token.accessToken = undefined;
          token.accessTokenExpiresAt = undefined;
          token.acces = undefined;
          token.accessDenied = resultat.refus;
          return token;
        }
        token.acces = resultat.acces;
        token.accessDenied = undefined;
        if (!token.accessTokenExpiresAt || Date.now() > Number(token.accessTokenExpiresAt) - 5 * 60_000) {
          token.accessToken = await accessToken(String(token.userId), String(token.organisationId));
          token.accessTokenExpiresAt = Date.now() + 60 * 60_000;
        }
      }
      return token;
    },
    async session({ session, token }) {
      session.user.id = String(token.userId ?? "");
      session.user.organisationId = String(token.organisationId ?? "");
      session.accessToken = String(token.accessToken ?? "");
      session.acces = (token.acces as Acces | undefined) ?? { commercial: null, vitrine: null };
      session.accessDenied = token.accessDenied === "consultant" || token.accessDenied === "sans_acces" || token.accessDenied === "inactif"
        ? token.accessDenied : undefined;
      return session;
    },
  },
});
