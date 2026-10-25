"use client";

import { useState } from "react";

// Liste de raisons ; « Autre » ouvre une saisie libre. À lire avec `lireMotif`.
export function MotifField({ options, label = "Raison" }: { options: readonly string[]; label?: string }) {
  const [choix, setChoix] = useState("");
  return <>
    <label className="field">{label} <b>*</b><select name="motif_choix" required value={choix} onChange={(event) => setChoix(event.target.value)}><option value="" disabled>Choisir une raison</option>{options.map((option) => <option key={option} value={option}>{option}</option>)}</select></label>
    {choix === "Autre" && <label className="field">Préciser la raison <b>*</b><input name="motif_autre" required minLength={3} autoFocus placeholder="Décrivez la raison" /></label>}
  </>;
}

export function lireMotif(form: FormData) {
  const choix = String(form.get("motif_choix") ?? "");
  return (choix === "Autre" ? String(form.get("motif_autre") ?? "") : choix).trim();
}
