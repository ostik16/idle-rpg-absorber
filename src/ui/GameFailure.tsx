/** Shown instead of the app when the game does not start: a failed startup, or a save it must not open. */
export function GameFailure({ lines }: { lines: readonly string[] }) {
  return (
    <main class="app__main">
      <div class="app__content">
        <section class="ab-card" role="alert">
          <div class="ab-card__head">
            <span class="ab-label">Game not started</span>
          </div>
          {lines.map((line) => (
            <p key={line} class="app__text">
              {line}
            </p>
          ))}
        </section>
      </div>
    </main>
  );
}
