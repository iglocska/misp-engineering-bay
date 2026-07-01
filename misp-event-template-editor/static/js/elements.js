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
    attribute_field:  { label: true,  help: true,  parent: true,  phase: '4.2', extra: 'MISP category → type, to_ids_default, comment_template, default_value, mandatory / repeatable' },
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
    if (meta.extra) {
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
