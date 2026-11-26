// Shared UI building blocks: icons, modals, menus, toasts, dialogs, time fields.
import { ICONS } from '../icons.js';
import { store, dismissToast, closeDialog } from '../store.js';
import { fmtPrecise, parseTime } from '../util.js';

const { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } = Vue;

export const Icon = {
    name: 'Icon',
    props: { name: { type: String, required: true } },
    computed: { svg() { return ICONS[this.name] || ''; } },
    template: `<span class="ico" aria-hidden="true" v-html="svg"></span>`
};

export const Modal = {
    name: 'Modal',
    props: {
        title: String,
        size: { type: String, default: '' },
        closeOnBackdrop: { type: Boolean, default: true }
    },
    emits: ['close'],
    setup(props, { emit }) {
        const root = ref(null);
        const onKey = event => {
            if (event.key === 'Escape') {
                event.stopPropagation();
                emit('close');
            }
        };
        onMounted(() => {
            window.addEventListener('keydown', onKey, true);
            nextTick(() => {
                const target = root.value && root.value.querySelector('[autofocus], input, textarea, select, button.btn-primary');
                if (target) target.focus();
            });
        });
        onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
        const backdrop = event => {
            if (props.closeOnBackdrop && event.target === event.currentTarget) emit('close');
        };
        return { root, backdrop };
    },
    template: `
        <div class="modal-backdrop" @mousedown="backdrop">
            <div ref="root" class="modal" :class="size ? 'modal-' + size : ''" role="dialog" aria-modal="true" :aria-label="title">
                <div class="modal-head" v-if="title || $slots.head">
                    <slot name="head"><h2>{{ title }}</h2></slot>
                    <button class="icon-btn" type="button" aria-label="Close" @click="$emit('close')"><icon name="x" /></button>
                </div>
                <div class="modal-body"><slot /></div>
                <div class="modal-foot" v-if="$slots.foot"><slot name="foot" /></div>
            </div>
        </div>`
};

// A button that opens a small menu; closes on outside click or Escape.
export const MenuButton = {
    name: 'MenuButton',
    props: {
        label: { type: String, default: 'More actions' },
        icon: { type: String, default: 'more' },
        btnClass: { type: String, default: 'icon-btn' },
        text: { type: String, default: '' },
        up: Boolean,
        left: Boolean
    },
    setup() {
        const open = ref(false);
        const wrap = ref(null);
        const onDoc = event => {
            if (open.value && wrap.value && !wrap.value.contains(event.target)) open.value = false;
        };
        const onKey = event => { if (event.key === 'Escape') open.value = false; };
        onMounted(() => {
            document.addEventListener('pointerdown', onDoc, true);
            document.addEventListener('keydown', onKey);
        });
        onBeforeUnmount(() => {
            document.removeEventListener('pointerdown', onDoc, true);
            document.removeEventListener('keydown', onKey);
        });
        return { open, wrap };
    },
    template: `
        <div class="menu-wrap" ref="wrap" @click.stop>
            <button type="button" :class="btnClass" :aria-label="label" :title="label" :aria-expanded="open ? 'true' : 'false'" @click="open = !open">
                <icon :name="icon" /><span v-if="text">{{ text }}</span>
            </button>
            <div v-if="open" class="menu" :class="{ 'menu-up': up, 'menu-left': left }" role="menu" @click="open = false">
                <slot />
            </div>
        </div>`
};

export const ToastStack = {
    name: 'ToastStack',
    setup() {
        const icon = type => (type === 'error' ? 'error' : type === 'info' ? 'info' : 'check');
        return { store, dismissToast, icon };
    },
    template: `
        <div class="toasts" aria-live="polite">
            <div v-for="item in store.toasts" :key="item.id" class="toast" :class="'is-' + item.type" role="status">
                <icon :name="icon(item.type)" />
                <span>{{ item.message }}</span>
                <button v-if="item.action" class="link-btn" type="button" @click="item.action.run(); dismissToast(item.id)">{{ item.action.label }}</button>
            </div>
        </div>`
};

export const AppDialog = {
    name: 'AppDialog',
    setup() {
        const value = ref('');
        watch(() => store.dialog, dialog => { if (dialog && dialog.kind === 'prompt') value.value = dialog.value || ''; });
        const confirm = () => {
            if (!store.dialog) return;
            closeDialog(store.dialog.kind === 'prompt' ? value.value : true);
        };
        const cancel = () => closeDialog(store.dialog && store.dialog.kind === 'prompt' ? null : false);
        return { store, value, confirm, cancel };
    },
    template: `
        <modal v-if="store.dialog" :title="store.dialog.title" @close="cancel">
            <p v-if="store.dialog.message">{{ store.dialog.message }}</p>
            <div v-if="store.dialog.kind === 'prompt'" class="field">
                <label v-if="store.dialog.label">{{ store.dialog.label }}</label>
                <input class="input" v-model="value" :placeholder="store.dialog.placeholder" autofocus @keydown.enter.prevent="confirm" maxlength="120">
            </div>
            <template #foot>
                <button class="btn btn-ghost" type="button" @click="cancel">{{ store.dialog.cancelLabel || 'Cancel' }}</button>
                <button class="btn" :class="store.dialog.danger ? 'btn-danger' : 'btn-primary'" type="button" @click="confirm">{{ store.dialog.confirmLabel }}</button>
            </template>
        </modal>`
};

// Time input that shows m:ss.s and accepts "75", "1:15" or "1:15.5".
export const TimeField = {
    name: 'TimeField',
    props: {
        modelValue: { type: Number, default: 0 },
        min: { type: Number, default: 0 },
        max: { type: Number, default: Infinity },
        ariaLabel: { type: String, default: 'Time' },
        small: Boolean
    },
    emits: ['update:modelValue', 'commit'],
    setup(props, { emit }) {
        const text = ref(fmtPrecise(props.modelValue));
        const editing = ref(false);
        watch(() => props.modelValue, value => { if (!editing.value) text.value = fmtPrecise(value); });
        const commit = () => {
            editing.value = false;
            const parsed = parseTime(text.value);
            if (parsed === null) {
                text.value = fmtPrecise(props.modelValue);
                return;
            }
            const value = Math.min(props.max, Math.max(props.min, parsed));
            text.value = fmtPrecise(value);
            emit('update:modelValue', Math.round(value * 100) / 100);
            emit('commit', value);
        };
        return { text, editing, commit };
    },
    template: `<input class="input input-time" :class="{ 'input-sm': small }" v-model="text" :aria-label="ariaLabel" inputmode="decimal"
        @focus="editing = true; $event.target.select()" @blur="commit" @keydown.enter.prevent="$event.target.blur()">`
};

export function registerUi(app) {
    app.component('icon', Icon);
    app.component('modal', Modal);
    app.component('menu-button', MenuButton);
    app.component('toast-stack', ToastStack);
    app.component('app-dialog', AppDialog);
    app.component('time-field', TimeField);
}

export { computed };
