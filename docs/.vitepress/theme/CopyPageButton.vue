<script setup lang="ts">
import { ref } from 'vue';
import { useData } from 'vitepress';

const { page } = useData();
const copied = ref(false);

// Eagerly import all markdown files in docs/ as raw strings
const rawMarkdownMap = import.meta.glob('../../**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

function getPageMarkdown(): string {
  const relativePath = page.value.relativePath || '';
  // Match relativePath e.g. "architecture-internals.md" or "getting-started.md"
  for (const [key, content] of Object.entries(rawMarkdownMap)) {
    if (key.endsWith(relativePath) || key.endsWith('/' + relativePath)) {
      return content;
    }
  }
  // Fallback: extract markdown-like text from vp-doc
  const el = document.querySelector('.vp-doc');
  return el ? (el as HTMLElement).innerText : '';
}

async function handleCopy() {
  const md = getPageMarkdown();
  if (!md) return;
  try {
    await navigator.clipboard.writeText(md);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch (err) {
    console.error('Failed to copy page markdown:', err);
  }
}
</script>

<template>
  <div class="copy-page-wrapper">
    <button
      class="copy-page-btn"
      :class="{ 'is-copied': copied }"
      @click="handleCopy"
      type="button"
      :title="copied ? 'Copied to clipboard!' : 'Copy full page markdown for LLMs / AI'"
      aria-label="Copy page as Markdown"
    >
      <!-- Copy Icon -->
      <svg
        v-if="!copied"
        class="btn-icon"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="1.8"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
        <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
      </svg>
      <!-- Checkmark Icon -->
      <svg
        v-else
        class="btn-icon text-emerald-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        stroke-linejoin="round"
      >
        <polyline points="20 6 9 17 4 12" />
      </svg>
      <span class="btn-text">{{ copied ? 'Copied Markdown!' : 'Copy Page' }}</span>
      <span class="btn-badge">Markdown</span>
    </button>
  </div>
</template>

<style scoped>
.copy-page-wrapper {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 1.25rem;
  padding-bottom: 0.75rem;
  border-bottom: 1px solid var(--vp-c-divider);
}

.copy-page-btn {
  display: inline-flex;
  align-items: center;
  gap: 0.45rem;
  padding: 0.35rem 0.75rem;
  font-size: 0.75rem;
  font-weight: 500;
  font-family: var(--vp-font-family-base);
  letter-spacing: -0.01em;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s ease;
  user-select: none;
}

/* Dark Mode */
.dark .copy-page-btn {
  background-color: rgba(24, 24, 27, 0.75);
  border: 1px solid rgba(63, 63, 70, 0.6);
  color: #d4d4d8;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.2);
}

.dark .copy-page-btn:hover {
  background-color: #27272a;
  border-color: #52525b;
  color: #ffffff;
  transform: translateY(-1px);
}

.dark .copy-page-btn.is-copied {
  border-color: rgba(52, 211, 153, 0.4);
  color: #34d399;
}

/* Light Mode */
:root:not(.dark) .copy-page-btn {
  background-color: #ffffff;
  border: 1px solid #d0d7de;
  color: #475569;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

:root:not(.dark) .copy-page-btn:hover {
  background-color: #f6f8fa;
  border-color: #94a3b8;
  color: #0f172a;
  transform: translateY(-1px);
}

:root:not(.dark) .copy-page-btn.is-copied {
  border-color: #10b981;
  color: #059669;
}

.btn-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.btn-badge {
  font-size: 10px;
  padding: 1px 5px;
  border-radius: 4px;
  font-family: var(--vp-font-family-mono);
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.dark .btn-badge {
  background-color: rgba(63, 63, 70, 0.5);
  color: #a1a1aa;
}

:root:not(.dark) .btn-badge {
  background-color: #edf1f5;
  color: #475569;
}

.is-copied .btn-badge {
  display: none;
}
</style>
