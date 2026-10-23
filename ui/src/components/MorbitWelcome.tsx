import "./MorbitWelcome.css";

/** A finite welcome sequence: readable at rest, with no timers or login gate. */
export function MorbitWelcome() {
  return (
    <aside className="morbit-welcome" lang="zh-Hant" aria-label="關於 mOrbit">
      <div className="morbit-welcome-content">
        <p className="morbit-welcome-position">懂你業務、能辦事的 AI 同事。</p>
        <h2 className="morbit-welcome-title">mOrbit，<br />你的智能同事。</h2>
        <p className="morbit-welcome-description">
          查資料、做報告、跟進任務、開發程式——交代下去，一起完成。
        </p>
        <p className="morbit-welcome-slogan">多一位智能同事，少一堆忙不完的事。</p>
      </div>
    </aside>
  );
}
