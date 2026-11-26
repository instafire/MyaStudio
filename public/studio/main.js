// MyaStudio studio entry point.
import { store } from './store.js';
import { registerUi } from './components/ui.js';
import { ProjectHub } from './components/hub.js';
import { Editor } from './components/editor.js';

const App = {
    name: 'MyaStudioApp',
    components: { ProjectHub, Editor },
    setup() {
        return { store };
    },
    template: `
        <project-hub v-if="store.route.name === 'hub'" />
        <editor v-else :key="store.route.projectId" />
        <toast-stack />
        <app-dialog />`
};

const app = Vue.createApp(App);
app.config.errorHandler = (err, instance, info) => {
    console.error('MyaStudio UI error:', info, err);
};
registerUi(app);
app.mount('#app');
