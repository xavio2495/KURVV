"use client";
import { useCallback, useEffect, useState } from "react";

/**
 * Register the service worker, and offer the install.
 *
 * Chromium fires `beforeinstallprompt` and hands over an event that must be kept and
 * replayed from a real click — calling it on load is refused. iOS fires nothing at
 * all and has no programmatic install, so the only honest thing to offer there is
 * the instruction, which is why the two branches are different rather than one
 * button that silently does nothing on half of phones.
 *
 * Nothing is shown once the app is already installed and running standalone.
 */

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches ||
  (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () =>
  /iphone|ipad|ipod/i.test(navigator.userAgent) ||
  // iPadOS 13+ reports as a Mac; a touch point is what separates it from a desktop.
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

export function InstallApp() {
  const [deferred, setDeferred] = useState<InstallEvent | null>(null);
  const [showIosHint, setShowIosHint] = useState(false);
  const [ios, setIos] = useState(false);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    if (isStandalone()) return;
    setIos(isIos());
    setHidden(false);

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as InstallEvent);
    };
    const onInstalled = () => { setDeferred(null); setHidden(true); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // Registration is what makes the browser consider the app installable at all.
    const t = window.setTimeout(() => {
      void navigator.serviceWorker.register("/sw.js").catch(() => {});
    }, 1200);
    return () => window.clearTimeout(t);
  }, []);

  const install = useCallback(async () => {
    if (ios) { setShowIosHint((v) => !v); return; }
    if (!deferred) return;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    if (outcome === "accepted") setHidden(true);
    setDeferred(null);
  }, [deferred, ios]);

  // Chromium before the event arrives has nothing to offer, so it stays quiet.
  if (hidden || (!ios && !deferred)) return null;

  return (
    <>
      <button className="play-share play-install" onClick={install} title="Install KURVV">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M12 3.5v11m0 0 4-4m-4 4-4-4" stroke="currentColor" strokeWidth="1.7"
            strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4.5 16v2.5A1.5 1.5 0 0 0 6 20h12a1.5 1.5 0 0 0 1.5-1.5V16"
            stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
        <span>Install</span>
      </button>
      {showIosHint && (
        <p className="play-ios-hint" role="status">
          Tap <strong>Share</strong> in Safari, then <strong>Add to Home Screen</strong>.
        </p>
      )}
    </>
  );
}
