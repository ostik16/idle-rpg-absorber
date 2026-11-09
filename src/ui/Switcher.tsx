import { useEffect, useRef, useState } from 'preact/hooks';
import { locationLabel, phaseDescriptor } from './format';
import { Icon } from './Icon';
import {
  areaOf,
  maxSlots,
  openCreation,
  roster,
  selectCharacter,
  selectedCharacter,
  unlockedSlots,
  type CharacterView,
} from './store';

/** Where a character is, in words: "City", "Farming Mossfang Glade", "Travelling to Mossfang Glade". */
function whereOf(view: CharacterView): string {
  const id = view.areaId.value;
  return locationLabel(view.activity.value, id === null ? null : (areaOf(id)?.name ?? null));
}

function Row({ view, onPick }: { view: CharacterView; onPick: () => void }) {
  const status = phaseDescriptor(view.activity.value);
  return (
    <button
      type="button"
      class="ab-char app__pick"
      aria-current={view.id === selectedCharacter.value?.id ? 'true' : undefined}
      onClick={() => {
        selectCharacter(view.id);
        onPick();
      }}
    >
      <span class="ab-char__avatar" aria-hidden="true">
        {Array.from(view.name)[0]}
      </span>
      <span class="app__row-body">
        <span class="ab-char__top">
          <span class="ab-char__name">{view.name}</span>
          <span class="ab-level">
            Lv <b>{view.level}</b>
          </span>
          <span class={`ab-status ab-status--${status.modifier}`}>
            <Icon name={status.icon} size={14} />
            {status.label}
          </span>
        </span>
        <span class="ab-char__where">{whereOf(view)}</span>
      </span>
    </button>
  );
}

/** The app bar's one control: who is selected and where they are. Opens the list of characters and slots. */
export function Switcher() {
  const [open, setOpen] = useState(false);
  const sheetRef = useRef<HTMLElement>(null);
  // Focus moves into the sheet so Escape works from the keyboard.
  useEffect(() => {
    if (open) sheetRef.current?.focus();
  }, [open]);
  const views = roster.value;
  const selected = selectedCharacter.value;
  const unlocked = unlockedSlots.value;
  const max = maxSlots.value;
  const close = () => setOpen(false);

  return (
    <>
      <button type="button" class="app__who" aria-haspopup="dialog" aria-label="Choose character" onClick={() => setOpen(true)}>
        <span class="ab-char__avatar app__who-avatar" aria-hidden="true">
          {selected === null ? '+' : Array.from(selected.name)[0]}
        </span>
        <span class="app__who-text">
          <span class="ab-char__name">{selected === null ? 'No character' : selected.name}</span>
          <span class="ab-char__where">{selected === null ? 'Create one to start' : whereOf(selected)}</span>
        </span>
        <Icon name="chevronDown" size={16} />
      </button>
      {open && (
        <div
          class="ab-scrim app__scrim"
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') close();
          }}
        >
          <section ref={sheetRef} tabIndex={-1} class="ab-sheet app__sheet app__sheet--tall" role="dialog" aria-modal="true" aria-labelledby="switcher-title">
            <span class="ab-sheet__grip" aria-hidden="true" />
            <div class="app__field-head">
              <h2 id="switcher-title" class="app__sheet-title app__grow">
                Characters
              </h2>
              <span class="ab-label">
                {views.length} of {max} slots
              </span>
            </div>
            {views.map((view) => (
              <Row key={view.id} view={view} onPick={close} />
            ))}
            {Array.from({ length: Math.max(0, unlocked - views.length) }, (_, i) => (
              <button
                type="button"
                key={`empty-${i}`}
                class="ab-char ab-char--locked app__pick"
                onClick={() => {
                  close();
                  openCreation();
                }}
              >
                <span class="ab-char__avatar" aria-hidden="true">
                  +
                </span>
                <span class="app__row-body">
                  <span class="ab-char__name">Slot {views.length + i + 1}</span>
                  <span class="ab-char__where">Empty. Create a character.</span>
                </span>
              </button>
            ))}
            {Array.from({ length: Math.max(0, max - unlocked) }, (_, i) => (
              <div key={`locked-${i}`} class="ab-char ab-char--locked" aria-label={`Slot ${unlocked + i + 1} locked`}>
                <span class="ab-char__avatar" aria-hidden="true">
                  <Icon name="locked" size={16} />
                </span>
                <span class="app__row-body">
                  <span class="ab-char__name">Slot {unlocked + i + 1}</span>
                  <span class="ab-char__where">Locked.</span>
                </span>
              </div>
            ))}
          </section>
        </div>
      )}
    </>
  );
}
