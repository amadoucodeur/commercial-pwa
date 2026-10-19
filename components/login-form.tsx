"use client";

import { useState } from "react";
import Image from "next/image";
import { signIn } from "next-auth/react";
import { ArrowRight, LockKeyhole, Sparkles } from "lucide-react";

function accessMessage(code?: string) {
  if (code === "consultant") return "Votre accès est limité à la consultation dans Trabad Gestion. L’application Trabad Commercial n’est pas accessible avec ce profil.";
  if (code === "sans_acces") return "Votre compte ne dispose pas d’un accès à l’application Trabad Commercial. Contactez votre responsable pour obtenir un accès.";
  return "Identifiant ou mot de passe incorrect.";
}

export function LoginForm({ accessDenied }: { accessDenied?: "consultant" | "sans_acces" }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const result = await signIn("credentials", {
        identifiant: String(form.get("identifiant") ?? ""),
        password: String(form.get("password") ?? ""),
        redirect: false,
      });
      if (!result?.ok || result.error) setError(accessMessage(result?.code));
      else window.location.assign("/");
    } catch {
      setError("Connexion impossible. Réessayez dans un instant.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-page">
    <div className="login-glow" />
    <div className="login-shell">
      <div className="login-brand"><Image src="/trabad-logo.png" alt="Trabad Immobilier" width={156} height={43} priority /><span>TRABAD COMMERCIAL</span></div>
      <p className="eyebrow light">VOTRE ESPACE COMMERCIAL</p>
      <h1>Le terrain, <em>simplement.</em></h1>
      <p className="login-intro">Chaque prospect, chaque rendez-vous, chaque action. Tout au même endroit.</p>
      <div className="login-card">
        <div className="login-card-icon"><Sparkles size={19} /></div>
        <h2>Bon retour</h2>
        <p>Connectez-vous avec votre compte commercial Trabad.</p>
        <form onSubmit={submit} className="login-form">
          <label>Identifiant<input name="identifiant" autoComplete="username" required maxLength={255} placeholder="Votre identifiant" /></label>
          <label>Mot de passe<input name="password" type="password" autoComplete="current-password" required maxLength={1024} placeholder="Votre mot de passe" /></label>
          {(error || accessDenied) && <p className="form-error" role="alert">{error || accessMessage(accessDenied)}</p>}
          <button type="submit" className="primary-button" disabled={busy}>{busy ? "Connexion…" : "Accéder à mon espace"}<ArrowRight size={18} /></button>
        </form>
      </div>
      <p className="login-foot"><LockKeyhole size={14} /> Espace réservé à l’équipe commerciale</p>
    </div>
  </main>;
}
