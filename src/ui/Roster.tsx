import { useComputed } from '@preact/signals';
import { formatGold, phaseDescriptor } from './format';
import { Icon } from './Icon';
import {
  areaOf,
  maxSlots,
  openCharacter,
  openCreation,
  openDeleteConfirm,
  roster,
  selectCharacter,
  unlockedSlots,
  type CharacterView,
} from './store';

/**
 * The roster row (design 4.1, decisions L15, L16). Status pill, area text and gold sit beside the name.
 * Phase and areaId change rarely, so the pill and area line re-render then; level, name and gold sit in
 * signal text nodes (ADR 0001), so a level-up or a gold change updates one text node.
 */
function CharacterRow({ view }: { view: CharacterView }) {
  const status = useComputed(() => phaseDescriptor(view.activity.value));
  const area = useComputed(() => {
    const id = view.areaId.value;
    return id === null ? null : areaOf(id);
  });
  const whereText = useComputed(() => {
    const a = area.value;
    if (a === null) return view.activity.value === 'idle' ? 'In the city' : '';
    return `${a.name} · Lv ${a.levelMin}–${a.levelMax}`;
  });
  const goldText = useComputed(() => formatGold(view.gold.value));
  const open = () => {
    selectCharacter(view.id);
    openCharacter(view.id);
  };
  return (
    <article class="ab-char app__row">
      <span class="ab-char__avatar" aria-hidden="true" onClick={open}>
        {Array.from(view.name)[0]}
      </span>
      <button type="button" class="app__row-body app__row-open" aria-label={`Open ${view.name}`} onClick={open}>
        <div class="ab-char__top">
          <span class="ab-char__name">{view.name}</span>
          <span class="ab-level">
            Lv <b>{view.level}</b>
          </span>
          <span class={`ab-status ab-status--${status.value.modifier}`}>
            <Icon name={status.value.icon} size={14} />
            {status.value.label}
          </span>
        </div>
        <div class="ab-char__where">{whereText}</div>
        <div class="ab-char__stats">
          <span class="ab-char__stat ab-c-gold">
            <Icon name="gold" size={14} />
            <b>{goldText}</b>
          </span>
        </div>
      </button>
      <button
        type="button"
        aria-label={`Delete ${view.name}`}
        class="ab-btn ab-btn--ghost ab-btn--icon ab-btn--sm app__row-del"
        onClick={() => openDeleteConfirm(view.id)}
      >
        <svg class="ab-icon ab-icon--16" viewBox="0 0 24 24" aria-hidden="true">
          <path
            d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"
            fill="none"
            stroke="currentColor"
            stroke-width="1.75"
            stroke-linecap="round"
            stroke-linejoin="round"
          />
        </svg>
      </button>
    </article>
  );
}

function LockedSlot({ index }: { index: number }) {
  return (
    <div class="ab-char ab-char--locked" aria-label={`Slot ${index} locked`}>
      <span class="ab-char__avatar" aria-hidden="true">
        <Icon name="locked" size={16} />
      </span>
      <div class="app__row-body">
        <div class="ab-char__top">
          <span class="ab-char__name">Slot {index}</span>
        </div>
        <div class="ab-char__where">Locked.</div>
      </div>
    </div>
  );
}

function EmptySlot({ index }: { index: number }) {
  return (
    <div class="ab-char ab-char--locked">
      <span class="ab-char__avatar" aria-hidden="true">
        +
      </span>
      <button
        type="button"
        class="app__row-body app__row-open"
        aria-label={`Slot ${index} empty, create character`}
        onClick={openCreation}
      >
        <div class="ab-char__top">
          <span class="ab-char__name">Slot {index}</span>
        </div>
        <div class="ab-char__where">Empty. Tap to create a character.</div>
      </button>
    </div>
  );
}

export function Roster() {
  const views = roster.value;
  const unlocked = unlockedSlots.value;
  const max = maxSlots.value;
  const lockedCount = Math.max(0, max - unlocked);
  const emptyCount = Math.max(0, unlocked - views.length);
  const canCreate = emptyCount > 0;
  const hint = canCreate || views.length < max ? null : 'Every slot is taken.';

  return (
    <section class="app__stack">
      <header class="app__section-head">
        <span class="ab-ornament" aria-hidden="true" />
        <h2 class="ab-label app__section-title">Characters</h2>
        <span class="ab-label app__section-count">
          {views.length} of {max} slots
        </span>
      </header>
      {views.map((view) => (
        <CharacterRow key={view.id} view={view} />
      ))}
      {Array.from({ length: emptyCount }, (_, i) => (
        <EmptySlot key={`empty-${i}`} index={views.length + i + 1} />
      ))}
      {Array.from({ length: lockedCount }, (_, i) => (
        <LockedSlot key={`locked-${i}`} index={unlocked + i + 1} />
      ))}
      {hint !== null && (
        <p class="app__text ab-c-muted" role="status">
          {hint}
        </p>
      )}
      <button
        type="button"
        class="ab-btn ab-btn--primary ab-btn--block"
        onClick={openCreation}
        disabled={!canCreate}
      >
        Create character
      </button>
    </section>
  );
}
