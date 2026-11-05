/** A − / + pair around a live value, the shop's quantity stepper. `label` names the value for assistive technology. */
export function Stepper({
  label,
  text,
  onDown,
  onUp,
  downDisabled = false,
  upDisabled = false,
}: {
  label: string;
  text: string;
  onDown: () => void;
  onUp: () => void;
  downDisabled?: boolean;
  upDisabled?: boolean;
}) {
  return (
    <span class="app__stepper" role="group" aria-label={label}>
      <button type="button" class="ab-btn ab-btn--icon" aria-label={`Lower ${label}`} disabled={downDisabled} onClick={onDown}>−</button>
      <span class="ab-num" aria-live="polite">{text}</span>
      <button type="button" class="ab-btn ab-btn--icon" aria-label={`Raise ${label}`} disabled={upDisabled} onClick={onUp}>+</button>
    </span>
  );
}
