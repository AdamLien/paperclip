import { useEffect, useState } from "react";
import slides from "./welcome-slides.json";
import "./MorbitWelcome.css";

export function MorbitWelcome() {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(() => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
  const [interacting, setInteracting] = useState(false);
  useEffect(() => {
    const motion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    const onMotion = () => { if (motion?.matches) setPaused(true); };
    motion?.addEventListener("change", onMotion);
    return () => motion?.removeEventListener("change", onMotion);
  }, []);
  useEffect(() => {
    if (paused || interacting) return;
    const timer = window.setInterval(() => {
      if (!document.hidden) setIndex(value => (value + 1) % slides.length);
    }, 7000);
    return () => window.clearInterval(timer);
  }, [paused, interacting, index]);
  const slide = slides[index];
  return (
    <aside className="morbit-welcome" lang="zh-Hant" aria-label="關於 mDeck"
      onMouseEnter={() => setInteracting(true)} onMouseLeave={event => setInteracting(event.currentTarget.contains(document.activeElement))}
      onFocus={() => setInteracting(true)} onBlur={event => setInteracting(event.currentTarget.contains(event.relatedTarget))}>
      <div className="morbit-welcome-content">
        <div className="morbit-welcome-slide" key={index} aria-live="off">
          <p className="morbit-welcome-position">{slide.position}</p>
          <h2 className="morbit-welcome-title">{slide.title}</h2>
          <p className="morbit-welcome-description">{slide.description}</p>
          <p className="morbit-welcome-slogan">{slide.slogan}</p>
        </div>
        <nav className="morbit-welcome-controls" aria-label="歡迎輪播">
          <div>{slides.map((item, page) => <button key={page} type="button" aria-label={`第 ${page + 1} 張：${item.position}`} aria-current={index === page} onClick={() => setIndex(page)}>{page + 1}</button>)}</div>
          <button type="button" onClick={() => setPaused(value => !value)}>{paused ? "播放輪播" : "暫停輪播"}</button>
        </nav>
      </div>
    </aside>
  );
}
