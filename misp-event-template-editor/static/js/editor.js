/**
 * editor.js — builder shell, core state & envelope panel (PRD tasks 3.1–3.2).
 *
 * Establishes the editor's in-memory model, boots the three-pane builder shell,
 * and (3.2) wires the envelope + library_metadata panel. Later tasks fill the
 * remaining regions:
 *   - 3.3 palette / canvas / properties framework + dotted-path state setter
 *   - 4.x element property editors
 *   - 5.x event_defaults
 *   - 6.x live preview
 *
 * Everything downstream reads and mutates `editorState.definition`, which is
 * always the bare `event-template-v1` library document (no MISP DB envelope).
 * Empty optionals may sit in the working copy while editing; `cleanForOutput()`
 * prunes them into the canonical shape for validate/save/export/preview.
 */

'use strict';

// --- The 9 structure element types (D2). Data only; the palette/canvas that
// consume this land in task 3.3. Kept here so the model and the UI share one
// source of truth for labels/icons/help. ---------------------------------
const ELEMENT_TYPES = [
    { type: 'section',          label: 'Section',          icon: '▩', help: 'Visual grouping header for the fields beneath it.' },
    { type: 'text_block',       label: 'Text block',       icon: '≡', help: 'Static markdown shown to the user (not an input).' },
    { type: 'attribute_field',  label: 'Attribute field',  icon: '◈', help: 'A single MISP attribute (category + type).' },
    { type: 'object_field',     label: 'Object field',     icon: '▦', help: 'A MISP object built from an installed object template.' },
    { type: 'tag_field',        label: 'Tag field',        icon: '▸', help: 'Tag picker, optionally restricted to taxonomies.' },
    { type: 'galaxy_field',     label: 'Galaxy field',     icon: '✲', help: 'Galaxy-cluster picker, optionally restricted by type.' },
    { type: 'file_field',       label: 'File field',       icon: '▤', help: 'File upload (attachment or malware-sample).' },
    { type: 'event_report',     label: 'Event report',     icon: '▧', help: 'A markdown event report with optional default content.' },
    { type: 'object_reference', label: 'Object reference', icon: '↔', help: 'A typed relationship between two object fields.' },
];

// Slug rule mirrors template_store.SLUG_RE (server-side gate).
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// A fresh working document. schema_version is const 1. uuid is filled from
// /api/uuid on init. library_metadata is scaffolded empty for binding and
// pruned by cleanForOutput().
function newDefinition() {
    return {
        schema_version: 1,
        uuid: '',
        name: '',
        description: null,
        misp_default: true, // D9: new library templates default true
        library_metadata: { compatible_misp_version: '', authors: [], tags: [] },
        event_defaults: { distribution: 0 },
        structure: [],
    };
}

// --- Central editor state. Mutated in place by later tasks. ---------------
const editorState = {
    mode: 'public',        // from /api/config; gates persist (D8/D4)
    slug: '',              // directory name (D7); distinct from definition.name
    slugTouched: false,    // once the user edits the slug, stop auto-deriving
    source: 'draft',       // 'draft' (output/) | 'library' | 'new'
    selectedId: null,      // currently-selected structure element id
    definition: newDefinition(),
};

// Convenience: the (always-present while editing) library_metadata object.
function libMeta() {
    const d = editorState.definition;
    if (!d.library_metadata) d.library_metadata = { compatible_misp_version: '', authors: [], tags: [] };
    return d.library_metadata;
}

// --- Canonicalisation for output ------------------------------------------
// Returns a pruned deep copy: drops an empty description, prunes empty
// library_metadata parts (and the object itself if fully empty), and strips
// blank author contacts. Used by validate/save/export/preview (later tasks).
function cleanForOutput(def) {
    const d = JSON.parse(JSON.stringify(def));
    if (!d.description) delete d.description;

    const lm = d.library_metadata || {};
    const out = {};
    if (lm.compatible_misp_version && lm.compatible_misp_version.trim()) {
        out.compatible_misp_version = lm.compatible_misp_version.trim();
    }
    const authors = (lm.authors || [])
        .filter(a => a && a.name && a.name.trim())
        .map(a => {
            const o = { name: a.name.trim() };
            if (a.contact && a.contact.trim()) o.contact = a.contact.trim();
            return o;
        });
    if (authors.length) out.authors = authors;
    const tags = (lm.tags || []).filter(t => t && t.trim());
    if (tags.length) out.tags = tags;

    if (Object.keys(out).length) d.library_metadata = out;
    else delete d.library_metadata;
    return d;
}

// --- Boot -----------------------------------------------------------------
async function initEditor() {
    // The Flask template already stamps the mode into the shell for a
    // no-flicker first paint; confirm it against the API (the contract the
    // rest of the UI relies on) and reconcile if they disagree.
    try {
        const cfg = await apiGet('/api/config');
        if (cfg && cfg.mode) setMode(cfg.mode);
    } catch (err) {
        console.warn('Could not load /api/config:', err.message);
    }

    bindEnvelope();
    renderEnvelope();

    // Seed a UUID for a brand-new template so the required field is populated.
    if (!editorState.definition.uuid) regenerateUuid();
}

function setMode(mode) {
    editorState.mode = mode;
    const badge = document.getElementById('mode-badge');
    if (badge) {
        badge.dataset.mode = mode;
        badge.textContent = mode;
    }
}

// --- Envelope panel (task 3.2) --------------------------------------------
function renderEnvelope() {
    const d = editorState.definition;
    setVal('env-slug', editorState.slug);
    setVal('env-name', d.name || '');
    setVal('env-description', d.description || '');
    setVal('env-uuid', d.uuid || '');
    const md = document.getElementById('env-misp-default');
    if (md) md.checked = d.misp_default !== false;
    setVal('lib-compat-version', libMeta().compatible_misp_version || '');
    renderAuthors();
    renderTags();
    validateSlugField();
}

function bindEnvelope() {
    onInput('env-slug', e => {
        editorState.slug = e.target.value.trim();
        editorState.slugTouched = editorState.slug !== '';
        validateSlugField();
    });
    onInput('env-name', e => {
        editorState.definition.name = e.target.value;
        maybeDeriveSlug();
    });
    onInput('env-description', e => {
        const v = e.target.value;
        editorState.definition.description = v === '' ? null : v;
    });
    onChange('env-misp-default', e => { editorState.definition.misp_default = e.target.checked; });
    onClick('env-uuid-regen', regenerateUuid);
    onInput('lib-compat-version', e => { libMeta().compatible_misp_version = e.target.value.trim(); });
    onClick('add-author', () => { libMeta().authors.push({ name: '', contact: '' }); renderAuthors(); focusLast('.author-name'); });
    setupTagInput();
}

async function regenerateUuid() {
    try {
        const res = await apiGet('/api/uuid');
        if (res && res.uuid) {
            editorState.definition.uuid = res.uuid;
            setVal('env-uuid', res.uuid);
        }
    } catch (err) {
        showToast('Could not generate a UUID: ' + err.message, 'error');
    }
}

// Auto-derive the slug from the name until the user takes over the slug field.
function maybeDeriveSlug() {
    if (editorState.slugTouched) return;
    const slug = slugify(editorState.definition.name);
    editorState.slug = slug;
    setVal('env-slug', slug);
    validateSlugField();
}

function slugify(s) {
    return (s || '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function validateSlugField() {
    const err = document.getElementById('err-slug');
    if (!err) return;
    const slug = editorState.slug;
    err.textContent = (slug && !SLUG_RE.test(slug))
        ? 'Use lowercase letters, digits and hyphens only (no leading/trailing hyphen).'
        : '';
}

// Authors — repeatable {name, contact}. Re-render only on add/remove so
// per-keystroke edits keep input focus.
function renderAuthors() {
    const c = document.getElementById('authors-container');
    if (!c) return;
    const authors = libMeta().authors;
    if (!authors.length) {
        c.innerHTML = '<p class="empty-hint">No authors yet — the library review checklist expects at least one.</p>';
        return;
    }
    c.innerHTML = authors.map((a, i) => `
        <div class="author-row form-row" data-idx="${i}">
            <div class="form-group flex-1">
                <input type="text" class="form-input author-name" placeholder="Name (required)" value="${escapeHtml(a.name || '')}">
            </div>
            <div class="form-group flex-1">
                <input type="text" class="form-input author-contact" placeholder="Contact — e.g. email (optional)" value="${escapeHtml(a.contact || '')}">
            </div>
            <button type="button" class="btn btn-icon btn-danger author-remove" title="Remove author">&times;</button>
        </div>`).join('');
    c.querySelectorAll('.author-row').forEach(row => {
        const i = Number(row.dataset.idx);
        row.querySelector('.author-name').addEventListener('input', e => { authors[i].name = e.target.value; });
        row.querySelector('.author-contact').addEventListener('input', e => { authors[i].contact = e.target.value; });
        row.querySelector('.author-remove').addEventListener('click', () => { authors.splice(i, 1); renderAuthors(); });
    });
}

// Tags — free strings, deduped.
function renderTags() {
    const list = document.getElementById('lib-tags-list');
    if (!list) return;
    const tags = libMeta().tags;
    list.innerHTML = tags.map((t, i) =>
        `<span class="tag-item">${escapeHtml(t)}<span class="tag-remove" data-idx="${i}" title="Remove">&times;</span></span>`
    ).join('');
    list.querySelectorAll('.tag-remove').forEach(x => x.addEventListener('click', () => {
        tags.splice(Number(x.dataset.idx), 1);
        renderTags();
    }));
}

function setupTagInput() {
    const input = document.getElementById('lib-tags-input');
    const wrapper = document.getElementById('lib-tags-wrapper');
    if (!input) return;
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            const v = input.value.trim().replace(/,+$/, '').trim();
            const tags = libMeta().tags;
            if (v && !tags.includes(v)) { tags.push(v); renderTags(); }
            input.value = '';
        } else if (e.key === 'Backspace' && !input.value && libMeta().tags.length) {
            libMeta().tags.pop();
            renderTags();
        }
    });
    if (wrapper) wrapper.addEventListener('click', () => input.focus());
}

// --- Tiny DOM helpers (null-safe; some elements are editor-page only) ------
function setVal(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function onInput(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('input', fn); }
function onChange(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('change', fn); }
function onClick(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
function focusLast(selector) { const els = document.querySelectorAll(selector); if (els.length) els[els.length - 1].focus(); }

document.addEventListener('DOMContentLoaded', initEditor);
