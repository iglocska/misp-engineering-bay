/**
 * elements.js — structure element factories + property editors (PRD 3.3 + 4.x).
 *
 * 3.3 ships the factories for all 9 types and the *common* property editor
 * (the plain scalar fields shared across types: id, label, content,
 * relationship_type, help, parent). The reference-data-backed and structured
 * fields (misp category/type, object_template picker, from/to selectors,
 * restrict lists, enums…) are filled per type in Phase 4 — each type advertises
 * its follow-up subtask via ELEMENT_META[...].phase.
 *
 * The editor returns an HTML string with `data-path` / `data-optional`
 * annotations; editor.js binds those inputs generically to the selected element
 * via the dotted-path setter. This keeps element markup here and orchestration
 * (state, canvas, validation) in editor.js.
 */

'use strict';

// Minimal structurally-shaped skeletons — only the schema-required keys, so a
// freshly-added element surfaces exactly the "you must fill this" errors and
// nothing spurious. Optional keys are added by their editors when set.
const ELEMENT_FACTORIES = {
    section:          id => ({ type: 'section', id, label: '' }),
    text_block:       id => ({ type: 'text_block', id, content: '' }),
    attribute_field:  id => ({ type: 'attribute_field', id, label: '', misp: { category: '', type: '' } }),
    object_field:     id => ({ type: 'object_field', id, label: '', object_template: { uuid: '', name: '', minimum_version: 1 } }),
    tag_field:        id => ({ type: 'tag_field', id, label: '' }),
    galaxy_field:     id => ({ type: 'galaxy_field', id, label: '' }),
    file_field:       id => ({ type: 'file_field', id, label: '' }),
    event_report:     id => ({ type: 'event_report', id, label: '' }),
    object_reference: id => ({ type: 'object_reference', id, from: '', to: '', relationship_type: '' }),
};

function newElement(type, id) {
    const factory = ELEMENT_FACTORIES[type];
    if (!factory) throw new Error(`Unknown element type: ${type}`);
    return factory(id);
}

// Per-type capability map driving the common editor + the Phase-4 placeholder.
//   label/help/parent — which shared optional/required fields apply
//   phase             — the Phase-4 subtask that adds the type-specific fields
//   extra             — human summary of what Phase 4 will add
const ELEMENT_META = {
    section:          { label: true,  help: true,  parent: false, phase: '4.1', extra: null },
    text_block:       { label: false, help: false, parent: false, phase: '4.1', extra: null },
    attribute_field:  { label: true,  help: true,  parent: true,  phase: '4.2', extra: null },
    object_field:     { label: true,  help: true,  parent: true,  phase: '4.5', extra: 'object-template picker + per-relation overrides, mandatory / repeatable' },
    tag_field:        { label: true,  help: true,  parent: true,  phase: '4.3', extra: 'restrict_taxonomies, multiple, mandatory' },
    galaxy_field:     { label: true,  help: true,  parent: true,  phase: '4.3', extra: 'restrict_galaxy_types, multiple, mandatory' },
    file_field:       { label: true,  help: true,  parent: true,  phase: '4.4', extra: 'as (attachment / malware-sample), repeatable, mandatory' },
    event_report:     { label: true,  help: true,  parent: true,  phase: '4.4', extra: 'default_content, mandatory' },
    object_reference: { label: false, help: false, parent: false, phase: '4.5', extra: 'from / to object_field selectors' },
};

function elementTypeInfo(type) {
    return (typeof ELEMENT_TYPES !== 'undefined' ? ELEMENT_TYPES : []).find(t => t.type === type)
        || { type, label: type, icon: '•' };
}

// One-line summary shown on the canvas row.
function elementSummary(el) {
    if (el.type === 'text_block') {
        const c = (el.content || '').trim();
        return c ? c.slice(0, 60) : 'Text block';
    }
    if (el.type === 'object_reference') {
        return `${el.from || '?'} → ${el.to || '?'}`;
    }
    return el.label || el.id || '(unnamed)';
}

// --- Property editor markup (3.3 common fields) ---------------------------
function renderElementEditor(el, sections) {
    const meta = ELEMENT_META[el.type] || {};
    const info = elementTypeInfo(el.type);
    const rows = [];

    rows.push(field('text', 'id', 'ID', el.id, {
        tip: 'Unique id within the template. Letters, digits and underscores; must start with a letter or underscore.',
    }));
    if (meta.label) {
        rows.push(field('text', 'label', 'Label', el.label || '', {
            tip: 'The field label shown to the user filling the form.',
        }));
    }
    if (el.type === 'text_block') {
        rows.push(field('textarea', 'content', 'Content (Markdown)', el.content || '', {
            rows: 6,
            tip: 'Static Markdown rendered inline in the user form — it is not an input the user fills in.',
        }));
    }
    if (el.type === 'object_reference') {
        rows.push(field('text', 'relationship_type', 'Relationship type', el.relationship_type || '', {
            tip: 'The relationship between the two object fields, e.g. "connects-to", "downloads".',
        }));
    }
    if (meta.help) {
        rows.push(field('textarea', 'help', 'Help (Markdown)', el.help || '', {
            optional: true,
            rows: 3,
            tip: 'Optional Markdown helper text shown beneath the field in the user form.',
        }));
    }
    if (meta.parent) {
        rows.push(parentField(el, sections));
    }
    const extra = renderTypeExtra(el);
    if (extra) {
        rows.push(extra);
    } else if (meta.extra) {
        rows.push(`<p class="et-region-hint">Type-specific fields — ${escapeHtml(meta.extra)}.<span class="tasktag">task ${meta.phase}</span></p>`);
    }

    return `
        <div class="et-el-editor">
            <div class="et-el-editor-head">
                <span class="et-el-badge">${escapeHtml(info.icon)}</span>
                <strong>${escapeHtml(info.label)}</strong>
            </div>
            ${rows.join('')}
        </div>`;
}

// A single bound field. `data-path` tells editor.js where to write; an optional
// field carries `data-optional` so an emptied value deletes the key.
function field(kind, path, label, value, opts = {}) {
    const tip = opts.tip
        ? ` <span class="tooltip-trigger" data-tooltip="${escapeHtml(opts.tip)}">&#9432;</span>`
        : '';
    const optAttr = opts.optional ? ' data-optional="1"' : '';
    const rows = opts.rows || 2;
    const control = kind === 'textarea'
        ? `<textarea class="form-input form-textarea" rows="${rows}" data-path="${escapeHtml(path)}"${optAttr}>${escapeHtml(value)}</textarea>`
        : `<input type="text" class="form-input" data-path="${escapeHtml(path)}"${optAttr} value="${escapeHtml(value)}">`;
    return `
        <div class="form-group">
            <label class="form-label">${escapeHtml(label)}${opts.optional ? ' <span class="et-opt">optional</span>' : ''}${tip}</label>
            ${control}
            <div class="field-error" data-error-for="${escapeHtml(path)}"></div>
        </div>`;
}

// --- Type-specific field blocks (Phase 4) ---------------------------------
// Dispatch to the per-type editor extension. Returns an HTML string, or null
// for types whose fields are fully covered by the common editor above
// (section, text_block) — those advertise `extra:null` in ELEMENT_META.
function renderTypeExtra(el) {
    switch (el.type) {
        case 'attribute_field': return renderAttributeField(el);
        case 'tag_field':       return renderTagField(el);
        case 'galaxy_field':    return renderGalaxyField(el);
        default: return null;
    }
}

// attribute_field (task 4.2). `mandatory`/`repeatable` toggles, then the MISP
// pane: category → type dependent dropdowns (populated by editor.js from the
// reference-data cache), the to_ids default, and the comment/value templates.
// The category/type <select>s are rendered as empty shells carrying
// `data-et-ref`; editor.js fills their options and wires the category→type
// cascade. Everything else binds through the generic [data-path] machinery.
function renderAttributeField(el) {
    const misp = el.misp || {};
    return [
        checkboxField('mandatory', 'Mandatory — user must fill this field', !!el.mandatory,
            'Require a value before the event can be created.'),
        checkboxField('repeatable', 'Repeatable — user can add multiple values', !!el.repeatable,
            'Let the user add more than one value for this field.'),
        '<hr class="et-sep">',
        refSelectField('misp.category', 'MISP category',
            'Which MISP attribute category this field records. Determines the available types.'),
        refSelectField('misp.type', 'MISP type', null, 'Types are filtered to the selected category.'),
        `<div class="field-error" data-error-for="misp"></div>`,
        checkboxField('misp.to_ids_default', 'Default the IDS flag on (to_ids)', !!misp.to_ids_default,
            'Pre-tick the to_ids flag on the attribute the user creates.'),
        field('text', 'misp.comment_template', 'Comment template', misp.comment_template || '', {
            optional: true, tip: 'Pre-fills the attribute comment when the user submits.' }),
        field('text', 'misp.default_value', 'Default value', misp.default_value || '', {
            optional: true, tip: 'A value pre-filled into the field for the user.' }),
    ].join('');
}

// tag_field (task 4.3). mandatory / multiple toggles + a taxonomy-restriction
// multipicker. An empty restrict list means the user may pick any tag.
function renderTagField(el) {
    return [
        checkboxField('mandatory', 'Mandatory — user must pick a tag', !!el.mandatory,
            'Require at least one tag before the event can be created.'),
        checkboxField('multiple', 'Allow multiple tags', !!el.multiple,
            'Let the user select more than one tag.'),
        '<hr class="et-sep">',
        renderMultipicker(el, {
            path: 'restrict_taxonomies',
            label: 'Restrict to taxonomies',
            tip: 'Limit the tag picker to the chosen taxonomy namespaces. Leave empty to allow any tag.',
            placeholder: 'Type a taxonomy namespace…',
            hint: 'Empty = any tag. Otherwise restricted to tags from the chosen taxonomies.',
            anyLabel: '(any taxonomy)',
        }),
    ].join('');
}

// galaxy_field (task 4.3). mandatory / multiple toggles + a galaxy-type
// restriction multipicker. Empty = the user may pick any cluster.
function renderGalaxyField(el) {
    return [
        checkboxField('mandatory', 'Mandatory — user must pick a cluster', !!el.mandatory,
            'Require at least one galaxy cluster before the event can be created.'),
        checkboxField('multiple', 'Allow multiple clusters', !!el.multiple,
            'Let the user select more than one galaxy cluster.'),
        '<hr class="et-sep">',
        renderMultipicker(el, {
            path: 'restrict_galaxy_types',
            label: 'Restrict to galaxy types',
            tip: 'Limit the cluster picker to the chosen galaxy types. Leave empty to allow any cluster.',
            placeholder: 'Type a galaxy type…',
            hint: 'Empty = any cluster. Otherwise restricted to clusters from the chosen galaxy types.',
            anyLabel: '(any galaxy type)',
        }),
    ].join('');
}

// Generic string-array multipicker: removable chips + a datalist-backed search
// input (reuses the envelope's chip-input look). Options and add/remove wiring
// are attached by editor.js (setupMultipicker), which owns the reference cache;
// here we render the shell and the current chips.
function renderMultipicker(el, cfg) {
    const listId = `dl-${cfg.path}`;
    return `
        <div class="form-group et-multipicker" data-et-mp="${escapeHtml(cfg.path)}"
             data-et-mp-any="${escapeHtml(cfg.anyLabel)}">
            <label class="form-label">${escapeHtml(cfg.label)}
                <span class="tooltip-trigger" data-tooltip="${escapeHtml(cfg.tip)}">&#9432;</span>
            </label>
            <div class="tag-input-wrapper" data-et-mp-box>
                <div class="tag-list" data-et-mp-chips>${multipickerChips(el[cfg.path], cfg.anyLabel)}</div>
                <input type="text" class="form-input tag-input" list="${escapeHtml(listId)}"
                       data-et-mp-input placeholder="${escapeHtml(cfg.placeholder)}" autocomplete="off">
                <datalist id="${escapeHtml(listId)}" data-et-mp-datalist></datalist>
            </div>
            <div class="et-field-hint">${escapeHtml(cfg.hint)}</div>
            <div class="field-error" data-error-for="${escapeHtml(cfg.path)}"></div>
        </div>`;
}

// Chip HTML for a string-array value (or the muted "any" hint when empty).
function multipickerChips(values, anyLabel) {
    const arr = Array.isArray(values) ? values : [];
    if (!arr.length) return `<span class="empty-hint" data-et-mp-empty>${escapeHtml(anyLabel)}</span>`;
    return arr.map((v, i) =>
        `<span class="tag-item" data-idx="${i}">${escapeHtml(v)}<span class="tag-remove" data-et-mp-remove="${i}" title="Remove">&times;</span></span>`
    ).join('');
}

// A boolean toggle bound via [data-path]; marked data-optional so unchecking it
// deletes the key (keeps the canonical doc minimal — see editor.js binder).
function checkboxField(path, label, checked, tip) {
    const tipHtml = tip
        ? ` <span class="tooltip-trigger" data-tooltip="${escapeHtml(tip)}">&#9432;</span>`
        : '';
    return `
        <div class="form-group">
            <label class="toggle-label">
                <input type="checkbox" data-path="${escapeHtml(path)}" data-optional="1"${checked ? ' checked' : ''}>
                <span>${escapeHtml(label)}</span>${tipHtml}
            </label>
        </div>`;
}

// A reference-data-backed <select> shell. Options + change wiring are added by
// editor.js (which owns the reference cache); here we only lay out the control
// with its data-path and a stable data-et-ref = the path (editor.js keys on it).
function refSelectField(path, label, tip, hint) {
    const tipHtml = tip
        ? ` <span class="tooltip-trigger" data-tooltip="${escapeHtml(tip)}">&#9432;</span>`
        : '';
    const hintHtml = hint ? `<div class="et-field-hint">${escapeHtml(hint)}</div>` : '';
    return `
        <div class="form-group">
            <label class="form-label">${escapeHtml(label)}${tipHtml}</label>
            <select class="form-select" data-path="${escapeHtml(path)}" data-et-ref="${escapeHtml(path)}"></select>
            ${hintHtml}
            <div class="field-error" data-error-for="${escapeHtml(path)}"></div>
        </div>`;
}

// parent selector — options are the section elements (excluding self).
function parentField(el, sections) {
    const opts = ['<option value="">— none (top level) —</option>'].concat(
        sections
            .filter(s => s.id && s.id !== el.id)
            .map(s => {
                const selected = el.parent === s.id ? ' selected' : '';
                const label = s.label ? `${s.label} (#${s.id})` : `#${s.id}`;
                return `<option value="${escapeHtml(s.id)}"${selected}>${escapeHtml(label)}</option>`;
            })
    ).join('');
    return `
        <div class="form-group">
            <label class="form-label">Parent section <span class="et-opt">optional</span>
                <span class="tooltip-trigger" data-tooltip="Group this field under a section for display. Points at a section element's id.">&#9432;</span>
            </label>
            <select class="form-select" data-path="parent" data-optional="1">${opts}</select>
            <div class="field-error" data-error-for="parent"></div>
        </div>`;
}
