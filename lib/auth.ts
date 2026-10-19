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

class CommercialAccessDenied extends CredentialsSignin {
  code: string;

  constructor(code: "consultant" | "sans_acces") {
    super();
    this.code = code;
  }
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

      if (user.roles?.commercial === "viewer") throw new CommercialAccessDenied("consultant");
      if (user.roles?.commercial !== "reader" && user.roles?.commercial !== "editor") {
        throw new CommercialAccessDenied("sans_acces");
      }

      const { data: organisation } = await supabaseAdmin.from("organisations")
        .select("is_active").eq("id", user.organisation_id).maybeSingle();
      if (!organisation?.is_active) return null;
      return { id: user.id, name: user.fullname || user.identifiant.split("@")[0], organisationId: user.organisation_id };
    },
  })],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.organisationId = user.organisationId;
        token.name = user.name;
      }
      if (token.userId && token.organisationId) {
        const { data: currentUser } = await supabaseAdmin.from("users")
          .select("is_active,roles,organisation_id")
          .eq("id", token.userId).maybeSingle();
        if (!currentUser?.is_active || currentUser.organisation_id !== token.organisationId ||
          (currentUser.roles?.commercial !== "reader" && currentUser.roles?.commercial !== "editor")) {
          token.accessToken = undefined;
          token.accessTokenExpiresAt = undefined;
          token.accessDenied = currentUser?.roles?.commercial === "viewer" ? "consultant" : "sans_acces";
          return token;
        }
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
      session.accessDenied = token.accessDenied === "consultant" ? "consultant" : token.accessDenied === "sans_acces" ? "sans_acces" : undefined;
      return session;
    },
  },
});
