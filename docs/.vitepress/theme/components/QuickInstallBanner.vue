<script setup lang="ts">
import { ref } from 'vue';

const copied = ref(false);
const command = 'npm i tricache';

async function copyCommand() {
  try {
    await navigator.clipboard.writeText(command);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (e) {
    console.error('Failed to copy install command:', e);
  }
}
</script>

<template>
  <div class="pre-footer-banner">
    <div class="banner-text">
      <h3 class="banner-heading">Ready to eliminate cache stampedes?</h3>
      <p class="banner-subheading">Deploy sub-millisecond multi-tier caching in minutes.</p>
    </div>

    <div class="banner-actions">
      <!-- One-click copy install command pill -->
      <div
        class="command-pill"
        :class="{ 'is-copied': copied }"
        @click="copyCommand"
        role="button"
        tabindex="0"
        :title="copied ? 'Copied to clipboard!' : 'Click to copy install command'"
        aria-label="Copy npm install command"
      >
        <span class="prompt-symbol">$</span>
        <span class="command-code">{{ command }}</span>
        <button class="pill-copy-btn" type="button" tabindex="-1">
          <svg v-if="!copied" class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
            <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
            <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
          </svg>
          <svg v-else class="copy-icon text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </button>
      </div>

      <!-- Documentation Button -->
      <a href="/TriCache/getting-started" class="docs-cta-btn">
        <span>Documentation</span>
        <span class="arrow-symbol">→</span>
      </a>
    </div>
  </div>
</template>

<style scoped>
.pre-footer-banner {
  margin: 3.5rem 0 2rem 0;
  padding: 2rem 2.25rem;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
  transition: all 0.25s ease;
}

@media (min-width: 768px) {
  .pre-footer-banner {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 2rem;
  }
}

.dark .pre-footer-banner {
  background: linear-gradient(180deg, rgba(24, 24, 27, 0.75) 0%, rgba(9, 9, 11, 0.95) 100%);
  border-color: rgba(63, 63, 70, 0.6);
  box-shadow: 0 10px 30px -8px rgba(0, 0, 0, 0.5), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

:root:not(.dark) .pre-footer-banner {
  background: linear-gradient(180deg, #ffffff 0%, #edf1f5 100%);
  border-color: #d0d7de;
  box-shadow: 0 4px 16px -4px rgba(15, 43, 72, 0.05);
}

.banner-text {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.banner-heading {
  margin: 0 !important;
  font-family: var(--vp-font-family-heading);
  font-size: 1.25rem;
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.banner-subheading {
  margin: 0 !important;
  font-family: var(--vp-font-family-base);
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}

.banner-actions {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  flex-wrap: wrap;
}

/* Command Pill */
.command-pill {
  display: inline-flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.45rem 0.85rem;
  border-radius: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 0.825rem;
  cursor: pointer;
  user-select: auto;
  transition: all 0.2s ease;
}

.dark .command-pill {
  background-color: #09090b;
  border: 1px solid rgba(63, 63, 70, 0.7);
  color: #e4e4e7;
}

.dark .command-pill:hover {
  background-color: #18181b;
  border-color: #71717a;
  color: #ffffff;
}

:root:not(.dark) .command-pill {
  background-color: #ffffff;
  border: 1px solid #d0d7de;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

:root:not(.dark) .command-pill:hover {
  background-color: #f6f8fa;
  border-color: #94a3b8;
}

.prompt-symbol {
  color: #71717a; /* zinc-500 */
  font-weight: 600;
  user-select: none;
  -webkit-user-select: none;
  margin-right: -0.15rem;
}

.command-code {
  letter-spacing: -0.01em;
  user-select: text;
  -webkit-user-select: text;
}

.pill-copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  color: var(--vp-c-text-2);
  transition: color 0.2s ease;
}

.copy-icon {
  width: 14px;
  height: 14px;
}

.command-pill:hover .copy-icon {
  color: var(--vp-c-text-1);
}

/* Docs Button */
.docs-cta-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.45rem 1rem;
  border-radius: 8px;
  font-family: var(--vp-font-family-base);
  font-size: 0.825rem;
  font-weight: 600;
  letter-spacing: -0.01em;
  text-decoration: none !important;
  transition: all 0.2s ease;
}

.dark .docs-cta-btn {
  background-color: #ffffff;
  color: #09090b !important;
  border: 1px solid #ffffff;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.8), 0 1px 3px rgba(0, 0, 0, 0.4);
}

.dark .docs-cta-btn:hover {
  background-color: #f4f4f5;
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(0, 0, 0, 0.5);
}

:root:not(.dark) .docs-cta-btn {
  background-color: #09090b;
  color: #ffffff !important;
  border: 1px solid #09090b;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
}

:root:not(.dark) .docs-cta-btn:hover {
  background-color: #27272a;
  border-color: #27272a;
  transform: translateY(-1px);
}

.arrow-symbol {
  transition: transform 0.2s ease;
}

.docs-cta-btn:hover .arrow-symbol {
  transform: translateX(2px);
}
</style>
