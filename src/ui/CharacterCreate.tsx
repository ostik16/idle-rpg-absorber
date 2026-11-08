import { useState } from 'preact/hooks';
import {
  closeCreation,
  creationNameError,
  creationNameLimits,
  send,
} from './store';

/**
 * Pushed over the roster when the player taps Create (design 4.1, design 6). Local state only;
 * engine-side rules (characterNameError) drive both the help text and the Create button's enable state.
 */
export function CharacterCreate() {
  const { minLength, maxLength } = creationNameLimits();

  const [name, setName] = useState('');
  const trimmed = name.trim();
  const error = creationNameError(name);
  const over = trimmed.length > maxLength;
  const empty = trimmed.length === 0;
  const canCreate = error === null;
  const status: { tone: 'ok' | 'bad' | 'muted'; text: string } = canCreate
    ? { tone: 'ok', text: 'Name is free.' }
    : empty
      ? { tone: 'muted', text: `Type ${minLength} to ${maxLength} characters.` }
      : { tone: 'bad', text: error as string };

  const submit = (event: Event) => {
    event.preventDefault();
    if (!canCreate) return;
    send({ type: 'createCharacter', name }, { saveAfter: true });
    closeCreation();
  };

  return (
    <form class="app__stack" onSubmit={submit}>
      <section class="ab-card app__card">
        <div class="app__field-head">
          <label class="ab-label" htmlFor="char-name">
            Name
          </label>
          <span
            class={`ab-num app__field-count${over ? ' ab-c-danger' : ' ab-c-muted'}`}
            aria-hidden="true"
          >
            {trimmed.length}/{maxLength}
          </span>
        </div>
        <input
          id="char-name"
          class={`app__input${canCreate ? ' app__input--ok' : empty ? '' : ' app__input--bad'}`}
          type="text"
          autocomplete="off"
          aria-describedby="char-name-help"
          aria-invalid={!canCreate && !empty ? 'true' : undefined}
          value={name}
          maxLength={maxLength + 8}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <p id="char-name-help" role="status" class={`app__field-help ab-c-${status.tone === 'ok' ? 'positive' : status.tone === 'bad' ? 'danger' : 'muted'}`}>
          {status.text}
        </p>
        <p class="app__text ab-c-muted">
          {minLength} to {maxLength} characters. Each name is unique in your roster, whatever the case.
        </p>
      </section>

      <div class="app__actions">
        <button type="submit" class="ab-btn ab-btn--primary ab-btn--block" disabled={!canCreate}>
          Create character
        </button>
        <button
          type="button"
          class="ab-btn ab-btn--ghost ab-btn--block"
          onClick={closeCreation}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
