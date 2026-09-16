import DefaultTheme from 'vitepress/theme';
import Layout from './Layout.vue';
import DiagramCard from './components/DiagramCard.vue';
import IntegrationGrid from './components/IntegrationGrid.vue';
import QuickInstallBanner from './components/QuickInstallBanner.vue';
import HomeFooter from './components/HomeFooter.vue';
import './custom.css';

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component('DiagramCard', DiagramCard);
    app.component('IntegrationGrid', IntegrationGrid);
    app.component('QuickInstallBanner', QuickInstallBanner);
    app.component('HomeFooter', HomeFooter);
  },
};
