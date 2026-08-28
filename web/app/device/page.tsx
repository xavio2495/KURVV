import { DeviceStage } from "../../components/DeviceStage";

export const metadata = { title: "KURVV · device" };

/** Standalone hardware view, for onboarding stills and the deck. */
export default function DevicePage() {
  return (
    <div className="showcase">
      <DeviceStage fill={0.88} idleSpin />
      <p className="showcase-hint">
        Drag to turn · roll the scroll to move · centre to select · skin lives in the panel
      </p>
    </div>
  );
}
