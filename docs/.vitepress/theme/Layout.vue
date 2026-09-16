<script setup lang="ts">
import DefaultTheme from 'vitepress/theme';
import { useData } from 'vitepress';
import CopyPageButton from './CopyPageButton.vue';
import HomeFooter from './components/HomeFooter.vue';

const { Layout } = DefaultTheme;
const { frontmatter } = useData();
</script>

<template>
  <Layout>
    <template #doc-before>
      <CopyPageButton />
    </template>
    <template #doc-after>
      <HomeFooter v-if="frontmatter.layout !== 'home'" variant="doc" />
    </template>
    <template #layout-bottom>
      <HomeFooter v-if="frontmatter.layout === 'home'" variant="home" />
    </template>
  </Layout>
</template>
