export function GrainOverlay(): JSX.Element {
  return (
    <svg className="tc-grain-overlay" aria-hidden="true" width="100%" height="100%">
      <filter id="tc-grain-noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch" />
      </filter>
      <rect width="100%" height="100%" filter="url(#tc-grain-noise)" />
    </svg>
  );
}
