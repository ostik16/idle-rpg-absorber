import { notice } from './store';

/** The latest one-line message from the engine, on every screen (ADR 0002 "Clock going backwards"). */
export function Notice() {
  return notice.value === null ? null : (
    <div class="app__notice">
      <span class="ab-notice" role="status">
        {notice}
      </span>
    </div>
  );
}
