"use client";
import { useState } from "react";
import Link from "next/link";
import { DeviceStage } from "../../../components/DeviceStage";

/**
 * Guided onboarding.
 *
 * Tooltips anchored over the live device rather than a video, so the thing being
 * explained is the thing in front of you. Each step names one control and what it
 * does; nothing here simulates a result the chain has not produced.
 */
const STEPS = [
  {
    title: "This is the device",
    body: "Everything happens on it. Drag anywhere to turn it — the chart on the left is a real screen, not a picture.",
    at: { top: "16%", left: "50%" },
  },
  {
    title: "The scroll moves",
    body: "Roll the ridged wheel on the right edge to walk the panel's cursor. Press the centre to enter a row, then roll to change its value.",
    at: { top: "44%", left: "84%" },
  },
  {
    title: "Set your stake",
    body: "STAKE is the total the Plan may ever spend. Authorising approves exactly that — never an unlimited allowance.",
    at: { top: "22%", left: "78%" },
  },
  {
    title: "Draw the curve",
    body: "Press the curve key at the bottom of the wheel, then draw straight on the screen. Each segment becomes one Leg; its slope becomes that Leg's conviction.",
    at: { top: "72%", left: "62%" },
  },
  {
    title: "Commit once",
    body: "The centre key commits. One signature opens the first Leg, and a Reactivity subscription opens each next Leg as the previous settles.",
    at: { top: "56%", left: "62%" },
  },
];

export default function Demo() {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  return (
    <main className="play demo">
      <DeviceStage fill={0.78} particles idleSpin inert />

      <div className="demo-scrim" />
      <div className="demo-tip" style={{ top: step.at.top, left: step.at.left }}>
        <span className="demo-count">{i + 1} / {STEPS.length}</span>
        <h3>{step.title}</h3>
        <p>{step.body}</p>
        <div className="demo-nav">
          {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
          {i < STEPS.length - 1
            ? <button className="primary" onClick={() => setI(i + 1)}>Next</button>
            : <Link className="btn btn-primary" href="/play">Start drawing</Link>}
        </div>
      </div>

      <div className="play-hud">
        <Link className="play-link" href="/play">Skip →</Link>
      </div>
    </main>
  );
}
