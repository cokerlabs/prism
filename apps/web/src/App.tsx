import { useEffect, useState } from "react";
import "./App.css";

type Health = { ok: boolean; service: string };

const EXAMPLE =
  "Show real wage growth versus CPI over the last two decades.";

export function App() {
  const [prompt, setPrompt] = useState("");
  const [health, setHealth] = useState<"checking" | "ok" | "shell">(
    "checking",
  );

  useEffect(() => {
    let cancelled = false;
    const url = `${import.meta.env.BASE_URL}api/health`;

    fetch(url)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((body: Health) => {
        if (!cancelled && body.ok && body.service === "prism") {
          setHealth("ok");
        } else if (!cancelled) {
          setHealth("shell");
        }
      })
      .catch(() => {
        if (!cancelled) setHealth("shell");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="shell">
      <header className="top">
        <div className="brand">
          <span className="wordmark">Prism</span>
          <span className="rule" aria-hidden="true" />
          <span className="kicker">Coker Labs</span>
        </div>
        <p className="status" data-state={health}>
          {health === "checking"
            ? "connecting"
            : health === "ok"
              ? "online"
              : "offline"}
        </p>
      </header>

      <main className="stage">
        <section className="panel composer" aria-labelledby="composer-heading">
          <div className="panel-head">
            <h1 id="composer-heading">Compose</h1>
            <p>Ask for a view. Official series only — we attach the receipts.</p>
          </div>
          <label className="field">
            <span className="field-label">Prompt</span>
            <textarea
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder={EXAMPLE}
              rows={7}
              spellCheck={false}
            />
          </label>
          <div className="actions">
            <button type="button" disabled title="Compose is unavailable">
              Compose
            </button>
            <span className="hint">Compose is unavailable.</span>
          </div>
        </section>

        <section className="panel provenance" aria-labelledby="provenance-heading">
          <div className="panel-head">
            <h2 id="provenance-heading">Provenance</h2>
            <p>Sources, transforms, and caveats for the current view.</p>
          </div>
          <div className="empty">
            <p>
              Sources and transforms appear here after you compose a view.
            </p>
            <p>
              Prism will not draw a series until you can see who published it,
              how it was transformed, and what it is not. That gate is the
              product — not a footer.
            </p>
          </div>
        </section>
      </main>

      <footer className="foot">
        <span>cokerlabs.dev/in/prism</span>
      </footer>
    </div>
  );
}
