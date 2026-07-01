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

    // Warm the reference-data cache the element editors will need (best-effort).
    prewarmReferenceData();

    bindEnvelope();
    renderEnvelope();

    renderPalette();
    renderCanvas();
    renderProperties();

    // Seed a UUID for a brand-new template so the required field is populated.
    if (!editorState.definition.uuid) await regenerateUuid();

    scheduleValidate();
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
        scheduleValidate();
    });
    onInput('env-description', e => {
        const v = e.target.value;
        editorState.definition.description = v === '' ? null : v;
        scheduleValidate();
    });
    onChange('env-misp-default', e => { editorState.definition.misp_default = e.target.checked; scheduleValidate(); });
    onClick('env-uuid-regen', () => regenerateUuid().then(scheduleValidate));
    onInput('lib-compat-version', e => { libMeta().compatible_misp_version = e.target.value.trim(); scheduleValidate(); });
    onClick('add-author', () => { libMeta().authors.push({ name: '', contact: '' }); renderAuthors(); focusLast('.author-name'); scheduleValidate(); });
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
        row.querySelector('.author-name').addEventListener('input', e => { authors[i].name = e.target.value; scheduleValidate(); });
        row.querySelector('.author-contact').addEventListener('input', e => { authors[i].contact = e.target.value; });
        row.querySelector('.author-remove').addEventListener('click', () => { authors.splice(i, 1); renderAuthors(); scheduleValidate(); });
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

// ==========================================================================
// Builder canvas (task 3.3): palette · canvas (reorder/select/delete) ·
// properties framework · live validation surface.
// ==========================================================================

// --- Palette --------------------------------------------------------------
function renderPalette() {
    const mount = document.getElementById('palette-region-body');
    if (!mount) return;
    mount.innerHTML = ELEMENT_TYPES.map(t => `
        <button type="button" class="et-palette-btn" data-type="${escapeHtml(t.type)}"
                title="${escapeHtml(t.help)}">
            <span class="et-palette-icon">${escapeHtml(t.icon)}</span>
            <span class="et-palette-label">${escapeHtml(t.label)}</span>
        </button>`).join('');
    mount.querySelectorAll('.et-palette-btn').forEach(btn => {
        btn.addEventListener('click', () => addElement(btn.dataset.type));
    });
}

function addElement(type) {
    const el = newElement(type, nextElementId(type));
    editorState.definition.structure.push(el);
    editorState.selectedId = el.id;
    renderCanvas();
    renderProperties();
    scheduleValidate();
}

// Generate a unique, pattern-valid id: "<type>_<n>".
function nextElementId(type) {
    const used = new Set(editorState.definition.structure.map(e => e.id));
    let n = 1;
    let id = `${type}_${n}`;
    while (used.has(id)) { n += 1; id = `${type}_${n}`; }
    return id;
}

// --- Canvas ---------------------------------------------------------------
function sectionsList() {
    return editorState.definition.structure.filter(e => e.type === 'section');
}

function renderCanvas() {
    const mount = document.getElementById('canvas-region-body');
    if (!mount) return;
    const structure = editorState.definition.structure;
    if (!structure.length) {
        mount.innerHTML = '<p class="et-region-hint">Empty template. Add elements from the palette on the left.</p>';
        return;
    }
    const errIdx = errorIndexMap(editorState._errors || []);
    mount.innerHTML = `<div class="et-canvas-list">${
        structure.map((el, i) => canvasRow(el, i, errIdx.get(i) || 0)).join('')
    }</div>`;

    mount.querySelectorAll('.et-canvas-el').forEach(row => {
        const idx = Number(row.dataset.idx);
        row.addEventListener('click', e => {
            if (e.target.closest('.et-el-remove')) return;
            selectElement(editorState.definition.structure[idx].id);
        });
        row.querySelector('.et-el-remove').addEventListener('click', () => removeElement(idx));
        bindRowDrag(row);
    });
}

function canvasRow(el, idx, errCount) {
    const info = elementTypeInfo(el.type);
    const selected = el.id === editorState.selectedId ? ' selected' : '';
    const errBadge = errCount
        ? `<span class="et-el-errdot" title="${errCount} validation error(s)">${errCount}</span>`
        : '';
    const indent = el.parent ? ' et-el-child' : '';
    return `
        <div class="et-canvas-el${selected}${indent}" data-idx="${idx}" draggable="true">
            <span class="et-drag-handle" title="Drag to reorder">⠿</span>
            <span class="et-el-badge" title="${escapeHtml(info.label)}">${escapeHtml(info.icon)}</span>
            <span class="et-el-main">
                <span class="et-el-title">${escapeHtml(elementSummary(el))}</span>
                <span class="et-el-id">#${escapeHtml(el.id)}</span>
            </span>
            ${errBadge}
            <button type="button" class="btn btn-icon btn-danger et-el-remove" title="Remove element">&times;</button>
        </div>`;
}

function selectElement(id) {
    editorState.selectedId = id;
    renderCanvas();
    renderProperties();
}

function removeElement(idx) {
    const [removed] = editorState.definition.structure.splice(idx, 1);
    if (removed && removed.id === editorState.selectedId) editorState.selectedId = null;
    renderCanvas();
    renderProperties();
    scheduleValidate();
}

// --- Drag reorder (native HTML5 DnD, flat list) ---------------------------
function bindRowDrag(row) {
    row.addEventListener('dragstart', e => {
        editorState._dragIdx = Number(row.dataset.idx);
        row.classList.add('et-dragging');
        e.dataTransfer.effectAllowed = 'move';
        // Firefox needs data set for the drag to start.
        try { e.dataTransfer.setData('text/plain', row.dataset.idx); } catch (_) { /* ignore */ }
    });
    row.addEventListener('dragend', () => {
        editorState._dragIdx = null;
        document.querySelectorAll('.et-canvas-el').forEach(r => r.classList.remove('et-dragging', 'et-drop-before', 'et-drop-after'));
    });
    row.addEventListener('dragover', e => {
        if (editorState._dragIdx == null) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const after = isAfter(e, row);
        row.classList.toggle('et-drop-after', after);
        row.classList.toggle('et-drop-before', !after);
    });
    row.addEventListener('dragleave', () => row.classList.remove('et-drop-before', 'et-drop-after'));
    row.addEventListener('drop', e => {
        e.preventDefault();
        moveElement(editorState._dragIdx, Number(row.dataset.idx), isAfter(e, row));
    });
}

function isAfter(e, row) {
    const rect = row.getBoundingClientRect();
    return e.clientY > rect.top + rect.height / 2;
}

function moveElement(from, targetIdx, after) {
    const arr = editorState.definition.structure;
    if (from == null || from < 0 || from >= arr.length) return;
    let insertAt = after ? targetIdx + 1 : targetIdx;
    const [item] = arr.splice(from, 1);
    if (from < insertAt) insertAt -= 1;          // account for the removal shift
    insertAt = Math.max(0, Math.min(insertAt, arr.length));
    arr.splice(insertAt, 0, item);
    editorState._dragIdx = null;
    renderCanvas();
    scheduleValidate();
}

// --- Properties pane ------------------------------------------------------
function selectedElement() {
    return editorState.definition.structure.find(e => e.id === editorState.selectedId) || null;
}

function renderProperties() {
    const mount = document.getElementById('properties-region-body');
    if (!mount) return;
    const el = selectedElement();
    if (!el) {
        mount.innerHTML = '<p class="et-region-hint">Select an element on the canvas, or add one from the palette, to edit its properties.</p>';
        return;
    }
    mount.innerHTML = renderElementEditor(el, sectionsList());
    bindPropertyInputs(mount, el);
    setupReferenceControls(mount, el);
}

// Bind every [data-path] control in the properties pane to the selected element
// via the dotted-path setter. Optional fields delete their key when emptied.
function bindPropertyInputs(mount, el) {
    mount.querySelectorAll('[data-path]').forEach(input => {
        const path = input.dataset.path;
        const optional = input.dataset.optional === '1';
        if (input.type === 'checkbox') {
            input.addEventListener('change', () => onPropertyToggle(el, path, input.checked, optional));
        } else {
            input.addEventListener('input', () => onPropertyEdit(el, path, input.value, optional));
            input.addEventListener('change', () => onPropertyEdit(el, path, input.value, optional));
        }
    });
}

function onPropertyEdit(el, path, rawValue, optional) {
    const value = rawValue;
    if (optional && value.trim() === '') deletePath(el, path);
    else setPath(el, path, value);

    // Editing the id must keep the selection pointer in sync.
    if (path === 'id') editorState.selectedId = el.id;

    renderCanvas();          // refresh the row summary / selection highlight
    scheduleValidate();
}

// Boolean toggle: write true when checked; an optional toggle deletes its key
// when unchecked (keeps the canonical doc minimal), a required one writes false.
function onPropertyToggle(el, path, checked, optional) {
    if (checked) setPath(el, path, true);
    else if (optional) deletePath(el, path);
    else setPath(el, path, false);
    scheduleValidate();      // toggles don't change the canvas row summary
}

// --- Reference-data-backed controls (task 4.2: category→type; later: pickers)
// Called after the generic binder so the generic value-writes fire first and
// these handlers see up-to-date element state.
function setupReferenceControls(mount, el) {
    if (el.type === 'attribute_field') setupAttributeField(mount, el);
    else if (el.type === 'tag_field') setupMultipicker(mount, el, MP_TAXONOMIES);
    else if (el.type === 'galaxy_field') setupMultipicker(mount, el, MP_GALAXY_TYPES);
    else if (el.type === 'object_field') setupObjectField(mount, el);
    else if (el.type === 'object_reference') setupObjectReference(mount, el);
}

// --- object_field (task 4.5): template picker + relations panel -------------
async function setupObjectField(mount, el) {
    const search = mount.querySelector('[data-et-ot-search]');
    const datalist = mount.querySelector('[data-et-ot-datalist]');
    const minver = mount.querySelector('[data-et-ot-minver]');
    const panel = mount.querySelector('[data-et-relations-panel]');
    const box = mount.querySelector('[data-et-ot-box]');
    if (box && search) box.addEventListener('click', () => search.focus());

    // minimum_version must serialise as an integer (schema: integer ≥ 1). Keep
    // the raw string when it isn't a number so the error surfaces live.
    if (minver) {
        minver.addEventListener('input', () => {
            const n = parseInt(minver.value, 10);
            setPath(el, 'object_template.minimum_version', Number.isNaN(n) ? minver.value : n);
            scheduleValidate();
        });
    }

    // Template search → datalist + pick.
    let list;
    try {
        list = await loadObjectTemplates();
    } catch (err) {
        console.warn('Could not load object templates:', err.message);
    }
    if (selectedElement() !== el) return;         // selection changed while loading
    if (list && datalist && search) {
        const byName = new Map(list.map(t => [t.name, t]));
        datalist.innerHTML = list.map(t =>
            `<option value="${escapeHtml(t.name)}">${escapeHtml(`${t.name} · ${t.meta_category || ''} · v${t.version}`)}</option>`).join('');
        search.addEventListener('change', () => {
            const t = byName.get(search.value.trim());
            if (!t) return;
            const prevUuid = el.object_template && el.object_template.uuid;
            el.object_template = {
                uuid: t.uuid,
                name: t.name,
                minimum_version: (prevUuid === t.uuid && el.object_template && el.object_template.minimum_version) || t.version || 1,
            };
            if (prevUuid !== t.uuid) delete el.relations;   // relations belong to the template
            renderProperties();     // full re-render reflects uuid / minver / display / relations
            renderCanvas();
            scheduleValidate();
        });
    }

    // Relations panel (once a template is chosen).
    const uuid = el.object_template && el.object_template.uuid;
    if (uuid && panel) {
        try {
            const tmpl = await loadObjectTemplate(uuid);
            if (selectedElement() !== el) return;
            renderRelations(panel, el, tmpl.relations || []);
        } catch (err) {
            panel.innerHTML = `<p class="field-error">Failed to load relations: ${escapeHtml(err.message)}</p>`;
        }
    }
}

// Render + wire the relations panel. Inclusion toggles mutate el.relations and
// re-render the panel (to show/hide overrides); override edits mutate the entry
// in place (no re-render, so inputs keep focus).
function renderRelations(container, el, rels) {
    container.innerHTML = relationsPanelHtml(el, rels);

    container.querySelectorAll('[data-et-rel-toggle]').forEach(cb => {
        cb.addEventListener('change', () => {
            toggleRelation(el, cb.dataset.etRelToggle, cb.checked);
            renderRelations(container, el, rels);
            renderCanvas();
            scheduleValidate();
        });
    });
    const all = container.querySelector('[data-et-rel-all]');
    const none = container.querySelector('[data-et-rel-none]');
    if (all) all.addEventListener('click', e => {
        e.preventDefault();
        rels.forEach(r => ensureRelation(el, r.object_relation));
        renderRelations(container, el, rels);
        renderCanvas();
        scheduleValidate();
    });
    if (none) none.addEventListener('click', e => {
        e.preventDefault();
        delete el.relations;
        renderRelations(container, el, rels);
        renderCanvas();
        scheduleValidate();
    });

    container.querySelectorAll('.et-rel-row').forEach(row => {
        const name = row.dataset.rel;
        row.querySelectorAll('[data-et-rel-field]').forEach(input => {
            const key = input.dataset.etRelField;
            const evt = input.type === 'checkbox' ? 'change' : 'input';
            input.addEventListener(evt, () => {
                const entry = findRelation(el, name);
                if (!entry) return;
                if (input.type === 'checkbox') {
                    if (input.checked) entry[key] = true; else delete entry[key];
                } else if (input.value.trim() === '') {
                    delete entry[key];
                } else {
                    entry[key] = input.value;
                }
                scheduleValidate();
            });
        });
    });
}

function findRelation(el, name) {
    return Array.isArray(el.relations) ? el.relations.find(r => r.object_relation === name) : undefined;
}
function ensureRelation(el, name) {
    if (!Array.isArray(el.relations)) el.relations = [];
    if (!el.relations.some(r => r.object_relation === name)) el.relations.push({ object_relation: name });
}
function toggleRelation(el, name, include) {
    if (include) {
        ensureRelation(el, name);
    } else if (Array.isArray(el.relations)) {
        el.relations = el.relations.filter(r => r.object_relation !== name);
        if (!el.relations.length) delete el.relations;   // empty == "show all"
    }
}

// --- object_reference (task 4.5): from/to sibling-object_field selects -------
// The selects carry data-path, so the generic binder writes the value; here we
// only populate options (siblings, with the current value preserved even if the
// referenced object_field was deleted).
function setupObjectReference(mount, el) {
    const ofs = editorState.definition.structure.filter(e => e.type === 'object_field');
    mount.querySelectorAll('[data-et-of-select]').forEach(sel => {
        const path = sel.dataset.path;               // 'from' | 'to'
        const current = el[path] || '';
        const opts = ['<option value="">— select —</option>'].concat(
            ofs.map(of => {
                const lbl = `${of.label || of.id} (#${of.id})`;
                return `<option value="${escapeHtml(of.id)}"${of.id === current ? ' selected' : ''}>${escapeHtml(lbl)}</option>`;
            }));
        if (current && !ofs.some(of => of.id === current)) {
            opts.push(`<option value="${escapeHtml(current)}" selected>${escapeHtml(current)} (missing)</option>`);
        }
        sel.innerHTML = opts.join('');
        sel.value = current;
    });
}

// Multipicker configs: how to load each field's option universe and map the
// reference records to {value, label} for the datalist. `value` is what gets
// stored in the array; `label` is the (friendlier) datalist display text.
const MP_TAXONOMIES = {
    path: 'restrict_taxonomies',
    load: () => loadTaxonomies(),
    items: data => (data || []).map(t => ({ value: t.namespace, label: t.namespace })),
};
const MP_GALAXY_TYPES = {
    path: 'restrict_galaxy_types',
    load: () => loadGalaxyTypes(),
    items: data => (data || []).map(g => ({ value: g.type, label: g.name || g.type })),
};

// Wire a string-array multipicker: fill its datalist from the reference cache
// and bind add (Enter/comma/datalist-select, restricted to known values) and
// remove. The array key is created on first add and deleted when it empties, so
// the canonical doc stays minimal (empty restrict list == "any" == omitted).
async function setupMultipicker(mount, el, cfg) {
    const root = mount.querySelector(`[data-et-mp="${cfg.path}"]`);
    if (!root) return;
    const input = root.querySelector('[data-et-mp-input]');
    const datalist = root.querySelector('[data-et-mp-datalist]');
    const chipsBox = root.querySelector('[data-et-mp-chips]');
    const box = root.querySelector('[data-et-mp-box]');
    const anyLabel = root.dataset.etMpAny || '';

    let data;
    try {
        data = await cfg.load();
    } catch (err) {
        console.warn(`Could not load options for ${cfg.path}:`, err.message);
        return;
    }
    if (selectedElement() !== el) return;        // selection changed while loading

    const items = cfg.items(data);
    const valid = new Set(items.map(it => it.value));
    datalist.innerHTML = items.map(it =>
        `<option value="${escapeHtml(it.value)}">${escapeHtml(it.label)}</option>`).join('');

    const rerender = () => {
        chipsBox.innerHTML = multipickerChips(el[cfg.path], anyLabel);
        bindChipRemoval(chipsBox, el, cfg.path, rerender);
    };
    bindChipRemoval(chipsBox, el, cfg.path, rerender);

    const tryAdd = () => {
        const v = input.value.trim();
        input.value = '';
        if (!v || !valid.has(v)) return;         // only known (datalist-guided) values
        const arr = el[cfg.path] || (el[cfg.path] = []);
        if (!arr.includes(v)) { arr.push(v); rerender(); scheduleValidate(); }
    };
    input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault();
            tryAdd();
        } else if (e.key === 'Backspace' && !input.value) {
            const arr = el[cfg.path];
            if (Array.isArray(arr) && arr.length) {
                arr.pop();
                if (!arr.length) deletePath(el, cfg.path);
                rerender();
                scheduleValidate();
            }
        }
    });
    input.addEventListener('change', tryAdd);     // datalist pick fires change
    if (box) box.addEventListener('click', () => input.focus());
}

function bindChipRemoval(chipsBox, el, path, rerender) {
    chipsBox.querySelectorAll('[data-et-mp-remove]').forEach(x => {
        x.addEventListener('click', e => {
            e.stopPropagation();
            const arr = el[path];
            if (!Array.isArray(arr)) return;
            arr.splice(Number(x.dataset.etMpRemove), 1);
            if (!arr.length) deletePath(el, path);
            rerender();
            scheduleValidate();
        });
    });
}

async function setupAttributeField(mount, el) {
    const catSel = mount.querySelector('[data-et-ref="misp.category"]');
    const typeSel = mount.querySelector('[data-et-ref="misp.type"]');
    if (!catSel || !typeSel) return;

    let data = attributeCategoriesNow();
    if (!data) {
        try {
            data = await loadAttributeCategories();
        } catch (err) {
            console.warn('Could not load attribute categories:', err.message);
            return;
        }
        if (selectedElement() !== el) return;    // selection changed while loading
    }

    const misp = el.misp || (el.misp = { category: '', type: '' });
    fillOptions(catSel, data.categories, misp.category, '— select —');
    fillOptions(typeSel, typesForCategory(data, misp.category), misp.type,
        misp.category ? '— select a type —' : '— select a category first —');

    // Category change cascades to the type list; a now-invalid type is cleared.
    catSel.addEventListener('change', () => {
        const cat = catSel.value;
        const types = typesForCategory(data, cat);
        if (misp.type && !types.includes(misp.type)) setPath(el, 'misp.type', '');
        fillOptions(typeSel, types, misp.type,
            cat ? '— select a type —' : '— select a category first —');
        renderCanvas();
        scheduleValidate();
    });
}

// (Re)populate a <select> with a leading placeholder + options, keeping the
// current value selected when it is still one of the options.
function fillOptions(sel, values, current, placeholder) {
    const valid = !!current && values.includes(current);
    sel.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` +
        values.map(v => `<option value="${escapeHtml(v)}"${v === current ? ' selected' : ''}>${escapeHtml(v)}</option>`).join('');
    sel.value = valid ? current : '';
}

// --- Live validation surface ----------------------------------------------
let _validateTimer = null;

function scheduleValidate() {
    clearTimeout(_validateTimer);
    _validateTimer = setTimeout(runValidate, 350);
}

async function runValidate() {
    try {
        const res = await apiPost('/api/templates/validate', cleanForOutput(editorState.definition));
        applyValidation(res);
    } catch (err) {
        // Transient/offline: leave the last known state, note once.
        console.warn('Validation request failed:', err.message);
    }
}

function applyValidation(res) {
    editorState._errors = res.errors || [];
    editorState._warnings = res.warnings || [];
    renderValidationSummary(res);
    renderCanvas();          // repaint per-row error dots
    paintPropertyErrors(res.errors || []);
}

// Map "$.structure[<i>]..." error paths to element-index counts.
function errorIndexMap(errors) {
    const m = new Map();
    errors.forEach(err => {
        const match = /\$\.structure\[(\d+)\]/.exec(err.path || '');
        if (match) {
            const i = Number(match[1]);
            m.set(i, (m.get(i) || 0) + 1);
        }
    });
    return m;
}

function renderValidationSummary(res) {
    const mount = document.getElementById('validation-summary');
    if (!mount) return;
    const errs = res.errors || [];
    const warns = res.warnings || [];
    const pill = res.valid
        ? '<span class="et-vpill et-valid">✓ Valid</span>'
        : `<span class="et-vpill et-invalid">✕ ${errs.length} error${errs.length === 1 ? '' : 's'}</span>`;
    const warnPill = warns.length
        ? `<span class="et-vpill et-warn">${warns.length} warning${warns.length === 1 ? '' : 's'}</span>`
        : '';
    const list = (errs.concat(warns)).map(e => `
        <li class="et-vitem et-v-${escapeHtml(e.severity || 'error')}">
            <code>${escapeHtml(shortPath(e.path))}</code> ${escapeHtml(e.message)}
        </li>`).join('');
    mount.innerHTML = `
        <div class="et-vhead">${pill}${warnPill}</div>
        ${list ? `<ul class="et-vlist">${list}</ul>` : ''}`;
}

// Highlight the offending property inputs for the selected element.
function paintPropertyErrors(errors) {
    const mount = document.getElementById('properties-region-body');
    if (!mount) return;
    mount.querySelectorAll('.field-error').forEach(n => { n.textContent = ''; });
    const el = selectedElement();
    if (!el) return;
    const idx = editorState.definition.structure.indexOf(el);
    const prefix = `$.structure[${idx}]`;
    errors.forEach(err => {
        const p = err.path || '';
        if (!p.startsWith(prefix)) return;
        // leaf key after the element prefix, e.g. "$.structure[3].misp" -> "misp"
        const rest = p.slice(prefix.length).replace(/^\./, '');
        const target = mount.querySelector(`.field-error[data-error-for="${cssEscape(rest)}"]`);
        if (target) target.textContent = err.message;
    });
}

function shortPath(path) {
    return (path || '$').replace(/^\$\.?/, '') || '(root)';
}
function cssEscape(s) {
    return String(s).replace(/["\\]/g, '\\$&');
}

// --- Tiny DOM helpers (null-safe; some elements are editor-page only) ------
function setVal(id, value) { const el = document.getElementById(id); if (el) el.value = value; }
function onInput(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('input', fn); }
function onChange(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('change', fn); }
function onClick(id, fn) { const el = document.getElementById(id); if (el) el.addEventListener('click', fn); }
function focusLast(selector) { const els = document.querySelectorAll(selector); if (els.length) els[els.length - 1].focus(); }

document.addEventListener('DOMContentLoaded', initEditor);
