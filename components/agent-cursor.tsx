/** Shared pointer artwork for agent-controlled surfaces. The hotspot is the upper-left tip. */
export function AgentCursor({ kind }: { kind: string }) {
  return (
    <span className="metis-browser-agent-cursor-shape" data-kind={kind} aria-hidden="true">
      {/* User-provided transparent artwork; CSS selects the variant for the Metis theme. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="metis-agent-cursor-black" src="/cursors/agent-black.png" alt="" draggable={false} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="metis-agent-cursor-white" src="/cursors/agent-white.png" alt="" draggable={false} />
      {kind === "click" ? <span className="metis-browser-agent-cursor-click" /> : null}
      {kind === "scroll" ? <span className="metis-browser-agent-cursor-scroll"><span /></span> : null}
    </span>
  );
}
