// Order matters: tokens first (generated from the design system), then component classes.
import './styles/tokens.css';
import '../design/ui/design-system/components/bundle.css';

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('#app not found');

// Placeholder shell, built from the design system's classes. Replace once the UI stack is chosen.
app.innerHTML = `
  <header class="ab-appbar">
    <h1 class="ab-appbar__title">Idle RPG Absorber</h1>
  </header>
  <main style="padding: var(--space-4)">
    <section class="ab-card">
      <div class="ab-card__head">
        <span class="ab-ornament"></span>
        <span class="ab-label">Status</span>
      </div>
      <p style="margin: 0">Scaffold ready. Nothing to farm yet.</p>
    </section>
  </main>
`;
