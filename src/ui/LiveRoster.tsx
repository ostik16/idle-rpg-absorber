import { useState } from 'preact/hooks';
import { roster, send, type CharacterView } from './store';

// Only what proves the wiring: send a command, watch live numbers. The roster screen is #32.

/** Signals sit directly in text positions, so a change updates that text node and nothing renders again (ADR 0001). */
function LiveCharacter({ view }: { view: CharacterView }) {
  return (
    <article class="ab-char">
      <div class="ab-char__avatar">{Array.from(view.name)[0]}</div>
      <div>
        <div class="ab-char__top">
          <span class="ab-char__name">{view.name}</span>
          <span class="ab-status">
            {view.activity} <span class="ab-status__time">{view.timeInActivity}</span>
          </span>
        </div>
        <div class="ab-char__stats">
          <span class="ab-char__stat">
            Lv <b>{view.level}</b>
          </span>
          <span class="ab-char__stat">
            Health <b>{view.health}</b> / {view.maxHealth}
          </span>
          <span class="ab-char__stat">
            Mana <b>{view.mana}</b> / {view.maxMana}
          </span>
          <span class="ab-char__stat">
            XP <b>{view.xpInLevel}</b>
          </span>
        </div>
      </div>
    </article>
  );
}

function NewCharacter() {
  const [name, setName] = useState('');
  const submit = (event: Event) => {
    event.preventDefault();
    send({ type: 'createCharacter', name });
    setName('');
  };
  return (
    <form class="app__form" onSubmit={submit}>
      <input
        class="app__input"
        aria-label="Character name"
        autocomplete="off"
        value={name}
        onInput={(event) => setName(event.currentTarget.value)}
      />
      <button class="ab-btn ab-btn--primary" type="submit">
        Create
      </button>
    </form>
  );
}

export function LiveRoster() {
  return (
    <section class="app__stack">
      {roster.value.map((view) => (
        <LiveCharacter key={view.id} view={view} />
      ))}
      <NewCharacter />
    </section>
  );
}
