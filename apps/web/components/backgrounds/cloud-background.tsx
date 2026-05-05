import { CloudField } from "./cloud-field";

// Splash backdrop: sky gradient + parallax cloud field. Drop this as the first
// child of a `relative` container; siblings should use `relative z-10`.
export function CloudBackground() {
  return (
    <>
      <div className="pointer-events-none absolute inset-0 bg-linear-to-b from-background-secondary via-sky-200 to-background-secondary" />
      <CloudField />
    </>
  );
}
