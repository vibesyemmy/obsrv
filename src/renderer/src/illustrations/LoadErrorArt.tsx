/**
 * PLACEHOLDER. The load-error state's illustration, standing in until the real
 * art arrives — swap the markup below and nothing else needs to change.
 *
 * Built to the same rules as `EmptyArt`: inlined rather than an <img> so it
 * themes with the chrome, every colour a palette variable, and no colour at
 * all — see docs/superpowers/specs/2026-08-23-obsrv-ui-style.md. Same 244×192
 * viewBox, so the two states stand at the same height.
 */
export function LoadErrorArt() {
  return (
    <svg viewBox="0 0 244 192" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <circle cx="122" cy="96" r="68" fill="var(--chrome-1)" />
      {/* A window that never filled: chrome at the top, nothing under it. */}
      <rect x="52" y="52" width="140" height="88" rx="6" fill="var(--chrome-2)" stroke="var(--line)" />
      <path d="M52 70h140" stroke="var(--line)" />
      <circle cx="64" cy="61" r="3" fill="var(--chrome-3)" />
      <circle cx="76" cy="61" r="3" fill="var(--chrome-3)" />
      <circle cx="88" cy="61" r="3" fill="var(--chrome-3)" />
      {/* The thread that did not reach: two ends and the gap between them. */}
      <path d="M74 106h34" stroke="var(--text-1)" strokeWidth="2" strokeLinecap="round" />
      <path d="M136 106h34" stroke="var(--text-1)" strokeWidth="2" strokeLinecap="round" />
      <path d="M114 100l6 6-6 6M130 100l-6 6 6 6" stroke="var(--text-1)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
