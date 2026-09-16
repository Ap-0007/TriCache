<script setup lang="ts">
withDefaults(
  defineProps<{
    variant?: 'home' | 'doc';
  }>(),
  {
    variant: 'home',
  }
);
</script>

<template>
  <footer class="site-subnav-footer" :class="[`variant-${variant}`]">
    <div class="footer-inner">
      <div class="footer-meta">
        <span class="brand-badge">TRICACHE</span>
        <span class="meta-dot">•</span>
        <span>MIT License</span>
        <span class="meta-dot">•</span>
        <span>© 2026 <a href="https://github.com/Kareem411" target="_blank" rel="noopener noreferrer" class="footer-author-link">Kareem</a></span>
      </div>

      <div class="footer-nav">
        <a href="https://github.com/Kareem411/TriCache" target="_blank" rel="noopener noreferrer" class="footer-link">GitHub</a>
        <a href="https://www.npmjs.com/package/tricache" target="_blank" rel="noopener noreferrer" class="footer-link">npm</a>
        <a href="/TriCache/architecture-internals" class="footer-link">Architecture</a>
        <a href="/TriCache/benchmarks" class="footer-link">Benchmarks</a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.site-subnav-footer {
  width: 100%;
  border-top: 1px solid var(--vp-c-divider);
}

.dark .site-subnav-footer {
  border-top-color: rgba(63, 63, 70, 0.6);
}

/* Home Variant: Full-width container at layout bottom */
.variant-home {
  padding: 2.25rem 1.5rem 3rem 1.5rem;
  margin-top: 3rem;
}

.variant-home .footer-inner {
  max-width: 1152px;
  margin: 0 auto;
}

/* Doc Variant: Compact, tight single-line bar directly below Prev/Next pagination */
.variant-doc {
  padding: 1rem 0 1.25rem 0;
  margin-top: 1.5rem;
}

.variant-doc .footer-inner {
  max-width: 100%;
  flex-direction: row;
  justify-content: space-between;
  align-items: center;
  gap: 1rem;
  font-size: 0.75rem;
}

.variant-doc .footer-meta {
  flex-wrap: nowrap;
  white-space: nowrap;
  gap: 0.5rem;
  justify-content: flex-start;
}

.variant-doc .footer-nav {
  white-space: nowrap;
  gap: 1.25rem;
}

.footer-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  font-size: 0.785rem;
}

@media (min-width: 640px) {
  .footer-inner {
    flex-direction: row;
  }
}

@media (max-width: 639px) {
  .variant-doc .footer-inner {
    flex-direction: column;
    align-items: center;
    gap: 0.75rem;
  }

  .variant-doc .footer-meta {
    justify-content: center;
  }
}

.footer-meta {
  display: flex;
  align-items: center;
  gap: 0.65rem;
  color: var(--vp-c-text-3);
  flex-wrap: wrap;
  justify-content: center;
}

.brand-badge {
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-1);
}

.meta-dot {
  opacity: 0.4;
}

.footer-nav {
  display: flex;
  align-items: center;
  gap: 1.5rem;
}

.footer-link {
  color: var(--vp-c-text-2);
  text-decoration: none !important;
  transition: color 0.2s ease;
  font-weight: 500;
}

.footer-link:hover {
  color: var(--vp-c-text-1);
}

.footer-author-link {
  color: var(--vp-c-text-2);
  text-decoration: none !important;
  transition: color 0.2s ease;
}

.footer-author-link:hover {
  color: var(--vp-c-brand-1, var(--vp-c-text-1));
  text-decoration: underline !important;
}
</style>
