export function InfoPanel() {
  return (
    <div
      className="px-4 py-5 lg:px-6 lg:py-6 max-w-3xl mx-auto"
      style={{ color: "var(--ow-fg-0)" }}
    >
      <h2
        className="text-lg lg:text-xl font-bold tracking-tight mb-4"
        style={{ color: "var(--ow-fg-0)" }}
      >
        À propos d'OpenWind
      </h2>

      <section className="mb-5">
        <h3
          className="text-sm font-semibold mb-1.5 uppercase tracking-wider"
          style={{ color: "var(--ow-accent)" }}
        >
          Le projet
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--ow-fg-1)" }}>
          OpenWind rend accessible une météo marine de qualité aux voileux. Les
          modèles AROME, ICON, GFS, ECMWF et les données de vagues, courants et
          marées sont publics et gratuits. Cette app les rassemble dans une vue
          lisible, sans compte ni installation.
        </p>
      </section>

      <section className="mb-5">
        <h3
          className="text-sm font-semibold mb-1.5 uppercase tracking-wider"
          style={{ color: "var(--ow-accent)" }}
        >
          Vos données
        </h3>
        <p className="text-sm leading-relaxed" style={{ color: "var(--ow-fg-1)" }}>
          Aucun tracking, aucun compte, aucune donnée enregistrée vous concernant.
          Tout tourne dans votre navigateur, c'est une page de consultation pure.
          Les requêtes météo partent en direct vers les API publiques.
        </p>
      </section>

      <section className="mb-5">
        <h3
          className="text-sm font-semibold mb-1.5 uppercase tracking-wider"
          style={{ color: "var(--ow-accent)" }}
        >
          Sources des données
        </h3>
        <ul
          className="text-sm leading-relaxed space-y-1"
          style={{ color: "var(--ow-fg-1)" }}
        >
          <li>
            Vent (multi-modèle) :{" "}
            <a
              href="https://open-meteo.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--ow-accent)" }}
            >
              Open-Meteo Forecast
            </a>
            , CC BY 4.0
          </li>
          <li>
            Vagues, courants, hauteur d'eau :{" "}
            <a
              href="https://open-meteo.com/en/docs/marine-weather-api"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--ow-accent)" }}
            >
              Open-Meteo Marine
            </a>{" "}
            (SMOC pour les courants), CC BY 4.0
          </li>
          <li>
            Cartographie :{" "}
            <a
              href="https://www.openstreetmap.org/"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
              style={{ color: "var(--ow-accent)" }}
            >
              OpenStreetMap
            </a>
            , ODbL
          </li>
        </ul>
      </section>

      <section
        className="rounded-xl p-4 lg:p-5"
        style={{
          background: "var(--ow-accent-soft)",
          border: "1px solid var(--ow-accent-line)",
        }}
      >
        <h3
          className="text-sm font-semibold mb-2 uppercase tracking-wider"
          style={{ color: "var(--ow-accent)" }}
        >
          Soutenir le projet
        </h3>
        <p className="text-sm leading-relaxed mb-3" style={{ color: "var(--ow-fg-0)" }}>
          Si vous adorez cette appli autant que moi, sachez qu'il faudra bientôt
          des serveurs dédiés pour la maintenir. Je n'ai pas envie de mettre de
          la pub dans cette app. Si vous non plus, n'hésitez pas à m'aider.
        </p>
        <a
          href="https://ko-fi.com/openwind"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold transition-transform hover:scale-105 active:scale-95"
          style={{
            background: "var(--ow-accent)",
            color: "#fff",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          Soutenir sur Ko-fi
        </a>
      </section>
    </div>
  );
}
