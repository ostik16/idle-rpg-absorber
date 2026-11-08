import { useEffect, useRef, useState } from 'preact/hooks';
import { closeDeleteConfirm, pendingDeleteId, roster, send } from './store';

/**
 * Bottom sheet that stands between "Delete" and the engine's deleteCharacter command (design 4.1,
 * decisions L15). Lists what is lost and points at the warehouse as the way out.
 */
export function DeleteConfirm() {
  const id = pendingDeleteId.value;
  const cancelRef = useRef<HTMLButtonElement>(null);
  // Keyed by character id so a stale entry never arms a different character.
  const [entry, setEntry] = useState<{ id: string | null; text: string }>({ id: null, text: '' });
  const typed = entry.id === id ? entry.text : '';
  useEffect(() => {
    if (id !== null) cancelRef.current?.focus();
  }, [id]);
  if (id === null) return null;
  const view = roster.value.find((v) => v.id === id);
  if (view === undefined) return null;

  const armed = typed.trim().toLowerCase() === view.name.toLowerCase();
  const confirm = () => {
    if (!armed) return;
    send({ type: 'deleteCharacter', characterId: id }, { saveAfter: true });
    closeDeleteConfirm();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape') closeDeleteConfirm();
  };

  return (
    <div
      class="ab-scrim app__scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="delete-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) closeDeleteConfirm();
      }}
      onKeyDown={onKeyDown}
    >
      <section class="ab-sheet app__sheet app__sheet--tall">
        <span class="ab-sheet__grip" aria-hidden="true" />
        <h2 id="delete-title" class="app__sheet-title">
          Delete {view.name}?
        </h2>
        <p class="app__text">
          {view.name} loses all items, equipment and gold. Nothing moves to the warehouse. Move what
          you want to keep to the warehouse first.
        </p>
        <label class="ab-label" htmlFor="delete-name">
          Type {view.name} to confirm
        </label>
        <input
          id="delete-name"
          class="app__input"
          type="text"
          autocomplete="off"
          autocapitalize="off"
          value={typed}
          onInput={(event) => setEntry({ id, text: event.currentTarget.value })}
        />
        <div class="ab-sheet__actions">
          <button
            ref={cancelRef}
            type="button"
            class="ab-btn ab-btn--ghost ab-btn--block"
            onClick={closeDeleteConfirm}
          >
            Keep
          </button>
          <button type="button" class="ab-btn ab-btn--danger ab-btn--block" disabled={!armed} onClick={confirm}>
            Delete
          </button>
        </div>
      </section>
    </div>
  );
}
