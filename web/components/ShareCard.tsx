"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_H, CARD_W, paintCard, type CardData } from "../lib/share/card";

type Done = "copied" | "saved" | "shared" | null;

/**
 * The share dialog: the painted card, and the three things anyone actually wants to
 * do with it.
 *
 * Copy is first because it is the one the web usually cannot do — it needs a real
 * `ClipboardItem`, and Firefox and Safari differ on whether they will take one. When
 * it is unavailable the button says so rather than failing silently on click.
 */
export function ShareCard({ data, onClose }: { data: CardData; onClose: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const blobRef = useRef<Blob | null>(null);
  const [ready, setReady] = useState(false);
  const [done, setDone] = useState<Done>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const canvas = ref.current;
    if (!canvas) return;
    (async () => {
      await paintCard(canvas, data);
      if (!live) return;
      canvas.toBlob((b) => {
        if (!live) return;
        blobRef.current = b;
        setReady(true);
      }, "image/png");
    })();
    return () => { live = false; };
  }, [data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const flash = (d: Done) => {
    setDone(d);
    window.setTimeout(() => setDone(null), 1600);
  };

  const copy = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    try {
      // `ClipboardItem` is the only way to put an IMAGE on the clipboard; writeText
      // would put the word "[object Blob]" there.
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      flash("copied");
    } catch {
      setErr("This browser will not accept an image on the clipboard — use Download.");
    }
  }, []);

  const download = useCallback(() => {
    const blob = blobRef.current;
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "kurvv.png";
    a.click();
    URL.revokeObjectURL(url);
    flash("saved");
  }, []);

  const share = useCallback(async () => {
    const blob = blobRef.current;
    if (!blob) return;
    const file = new File([blob], "kurvv.png", { type: "image/png" });
    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
    if (!nav.canShare?.({ files: [file] })) {
      download();
      return;
    }
    try {
      await navigator.share({ files: [file], title: "KURVV", text: "Drew the market. The chain traded it." });
      flash("shared");
    } catch { /* dismissed, which is not an error */ }
  }, [download]);

  return (
    <div className="sc-back" role="dialog" aria-modal="true" aria-label="Share your run" onClick={onClose}>
      <div className="sc" onClick={(e) => e.stopPropagation()}>
        <canvas className="sc-img" ref={ref} width={CARD_W} height={CARD_H} aria-label="Your run, as an image" />
        <div className="sc-bar">
          <button className="lp-btn" onClick={copy} disabled={!ready}>
            {done === "copied" ? "Copied" : "Copy"}
          </button>
          <button className="lp-btn" onClick={download} disabled={!ready}>
            {done === "saved" ? "Saved" : "Download"}
          </button>
          <button className="lp-btn lp-btn-go" onClick={share} disabled={!ready}>
            {done === "shared" ? "Shared" : "Share"}
          </button>
          <button className="sc-x" onClick={onClose} aria-label="Close">✕</button>
        </div>
        {err && <p className="sc-err">{err}</p>}
      </div>
    </div>
  );
}
