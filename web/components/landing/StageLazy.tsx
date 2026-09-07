"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

/**
 * The device, loaded only when you are nearly at it.
 *
 * three.js and the device scene are ~280 kB — most of the landing page's weight for
 * something that appears in the last section. Held behind an IntersectionObserver
 * with a viewport of margin, the page judges land on ships the copy and the canvas
 * and nothing else, and the device is already there by the time you scroll to it.
 *
 * `ssr: false` is safe here precisely because it is inside this client component:
 * it opts out this subtree only, so every word on the page still server-renders.
 */
const DeviceStage = dynamic(() => import("../DeviceStage").then((m) => m.DeviceStage), {
  ssr: false,
});

export function StageLazy() {
  const ref = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    let io: IntersectionObserver | null = null;
    const arrive = () => {
      setNear(true);
      io?.disconnect();
      window.removeEventListener("scroll", check);
    };

    // The backstop. Observer callbacks are delivered in the rendering step, so a
    // throttled or backgrounded tab can scroll all the way to the device and never
    // be told — and an empty final section is the one thing this page cannot do.
    const check = () => {
      if (el.getBoundingClientRect().top < window.innerHeight * 2.2) arrive();
    };

    if (typeof IntersectionObserver === "function") {
      io = new IntersectionObserver(([e]) => e.isIntersecting && arrive(), { rootMargin: "120% 0px" });
      io.observe(el);
    }
    window.addEventListener("scroll", check, { passive: true });
    check();

    return () => {
      io?.disconnect();
      window.removeEventListener("scroll", check);
    };
  }, []);

  return <div className="lp-stage" ref={ref}>{near ? <DeviceStage fill={0.88} still /> : null}</div>;
}
