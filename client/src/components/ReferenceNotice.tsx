import React, { useId, useState } from "react";
import { REFERENCE_NOTICES, REFERENCE_NOTICE_TITLE, REFERENCE_NOTICE_CSS } from "@shared/reference-notice";

export function ReferenceNotice() {
  const id = useId();
  const [paused, setPaused] = useState(false);
  return <>
    <style>{REFERENCE_NOTICE_CSS}</style>
    <aside aria-labelledby={`${id}-title`} className="reference-notice" data-testid="reference-notice" data-paused={paused}>
      <div className="reference-heading">
        <h2 id={`${id}-title`}>{REFERENCE_NOTICE_TITLE}</h2>
        <button type="button" className="reference-control" onClick={() => setPaused(value => !value)}
          aria-label={paused ? "Play reference ticker" : "Pause reference ticker"} data-testid="notice-play">
          {paused ? "Play ticker" : "Pause ticker"}
        </button>
      </div>
      <div className="reference-window">
        <div className="reference-track" data-testid="notice-track">
          <div className="reference-group">
            {REFERENCE_NOTICES.map(text => <p key={text} className="reference-statement">{text}</p>)}
          </div>
          <div className="reference-group" aria-hidden="true">
            {REFERENCE_NOTICES.map(text => <p key={text} className="reference-statement">{text}</p>)}
          </div>
        </div>
      </div>
      <p className="reference-reduced">Reduced motion is enabled. All notices are shown without movement.</p>
      <details data-testid="notice-full">
        <summary>Full disclaimer</summary>
        {REFERENCE_NOTICES.map(text => <p key={text}>{text}</p>)}
      </details>
    </aside>
  </>;
}
