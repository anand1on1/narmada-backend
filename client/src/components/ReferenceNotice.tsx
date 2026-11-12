import React, { useEffect, useId, useState } from "react";
import { REFERENCE_NOTICES, REFERENCE_NOTICE_TITLE } from "@shared/reference-notice";

export function ReferenceNotice() {
  const id = useId();
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [reduced, setReduced] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update(); media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  const rotating = playing && !hovered && !focused && !reduced;
  useEffect(() => {
    if (!rotating) return;
    const timer = window.setInterval(() => setIndex(i => (i + 1) % REFERENCE_NOTICES.length), 8000);
    return () => window.clearInterval(timer);
  }, [rotating]);
  const move = (direction: number) => {
    setPlaying(false);
    setIndex(i => (i + direction + REFERENCE_NOTICES.length) % REFERENCE_NOTICES.length);
  };
  const button = "min-h-11 rounded-md border border-sky-200 bg-white px-3 text-sm text-slate-800 hover:bg-sky-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-800 disabled:opacity-60";
  return <aside aria-labelledby={`${id}-title`} className="my-5 rounded-lg border border-sky-200 bg-sky-50 p-4 text-slate-900"
    data-testid="reference-notice" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false); }}>
    <h2 id={`${id}-title`} className="text-base font-semibold">{REFERENCE_NOTICE_TITLE}</h2>
    <div role="region" aria-roledescription="carousel" aria-label="Reference notices" className="mt-3">
      <div aria-live={rotating ? "off" : "polite"} aria-atomic="true" className="min-h-28">
        <p className="text-xs text-slate-600 mb-2" data-testid="notice-position">Notice {index + 1} of {REFERENCE_NOTICES.length}</p>
        <p role="group" aria-roledescription="slide" aria-label={`${index + 1} of ${REFERENCE_NOTICES.length}`}
          className="text-sm leading-relaxed" data-testid="notice-slide">{REFERENCE_NOTICES[index]}</p>
      </div>
      <div className="flex flex-wrap gap-2 mt-3">
        <button type="button" className={button} onClick={() => move(-1)} aria-label="Previous reference notice" data-testid="notice-prev">Previous</button>
        <button type="button" className={button} onClick={() => setPlaying(v => !v)} disabled={reduced}
          aria-label={reduced ? "Automatic rotation disabled by reduced-motion preference" : playing ? "Pause notice rotation" : "Play notice rotation"}
          data-testid="notice-play">{reduced ? "Rotation off" : playing ? "Pause" : "Play"}</button>
        <button type="button" className={button} onClick={() => move(1)} aria-label="Next reference notice" data-testid="notice-next">Next</button>
      </div>
      <p className="text-xs text-slate-600 mt-2">{reduced ? "Reduced motion is enabled. Use Previous or Next to change notices." :
        "Rotation pauses while you hover here or use the keyboard controls. All statements remain available below."}</p>
    </div>
    <details open className="mt-4 border-t border-sky-200 pt-3" data-testid="notice-full">
      <summary className="cursor-pointer text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-sky-800">Full disclaimer</summary>
      {REFERENCE_NOTICES.map(text => <p key={text} className="text-sm leading-relaxed mt-2">{text}</p>)}
    </details>
  </aside>;
}
