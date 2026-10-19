"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { Download, Share2, X } from "lucide-react";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

export function InstallApp() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [ios, setIos] = useState(false);
  const [installed, setInstalled] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true;
    setInstalled(standalone);

    const iosDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIos(iosDevice);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
      setExpanded(false);
    };

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (installed || (!prompt && !ios) || sessionStorage.getItem("commercial-install-dismissed")) return;
    const timer = window.setTimeout(() => setExpanded(true), 3500);
    return () => window.clearTimeout(timer);
  }, [installed, ios, prompt]);

  if (installed || (!prompt && !ios)) return null;

  const install = async () => {
    if (!prompt) {
      setShowInstructions(true);
      setExpanded(true);
      return;
    }
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      setPrompt(null);
      setExpanded(false);
      if (choice.outcome === "accepted") setInstalled(true);
    } catch {
      setExpanded(false);
    }
  };

  const dismiss = () => {
    sessionStorage.setItem("commercial-install-dismissed", "1");
    setExpanded(false);
    setShowInstructions(false);
  };

  return <aside className={`install-app ${expanded ? "expanded" : ""}`} aria-label="Installer Trabad Commercial">
    {expanded ? <>
      <button className="install-close" type="button" onClick={dismiss} aria-label="Fermer l’invitation"><X size={17} /></button>
      <div className="install-heading"><Image src="/icon-192.png" alt="" width={48} height={48} /><div><strong>Trabad Commercial</strong><span>Votre espace, à portée de main</span></div></div>
      {showInstructions ? <p className="install-help">Dans Safari, touchez <Share2 size={15} aria-label="Partager" /> <strong>Partager</strong>, puis <strong>Sur l’écran d’accueil</strong>.</p> :
        <p className="install-help">Ajoutez l’application à votre écran d’accueil pour y accéder rapidement.</p>}
      {!showInstructions && <button className="install-action" type="button" onClick={() => void install()}><Download size={17} /> Installer l’application</button>}
    </> : <button className="install-compact" type="button" onClick={() => void install()}><Download size={17} /> Installer l’application</button>}
  </aside>;
}
