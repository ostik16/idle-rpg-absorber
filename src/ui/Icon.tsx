import { iconBodies, type IconName } from './icons';

/** Sizes in px: 20 in buttons and tabs, 16 in rows, 14 in chips (design system README). */
export type IconSize = 20 | 16 | 14;

const SIZE_CLASS: Record<IconSize, string> = {
  20: 'ab-icon',
  16: 'ab-icon ab-icon--16',
  14: 'ab-icon ab-icon--14',
};

/** Decorative: it always sits beside a word, so it is hidden from assistive technology. */
export function Icon({ name, size = 20 }: { name: IconName; size?: IconSize }) {
  return (
    <svg
      class={SIZE_CLASS[size]}
      viewBox="0 0 24 24"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: iconBodies[name] }}
    />
  );
}
