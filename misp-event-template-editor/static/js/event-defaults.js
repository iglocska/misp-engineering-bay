/**
 * event-defaults.js — the template-level `event_defaults` panel (PRD Phase 5, D6).
 *
 * 5.1 wires the scalar dropdowns: distribution (+ a conditional sharing_group_id
 * shown only for distribution = 4, where the schema requires it), threat_level_id
 * and analysis. 5.2 adds the guided `info_template` builder (a textarea with an
 * insert-variable toolbar + live grammar / {{field:id}} ref validation). Task 5.3
 * extends this file with the default tags / galaxy_clusters pickers.
 *
 * Reads and writes `editorState.definition.event_defaults` in place. All fields
 * are optional in the schema; unset scalars are omitted (delete-when-blank) to
 * keep the canonical doc minimal. Loaded after editor.js's model but its
 * functions are called from initEditor(), so `editorState` exists at call time.
 */

'use strict';

// The always-present-while-editing event_defaults object.
function eventDefaults() {
    const d = editorState.definition;
    if (!d.event_defaults) d.event_defaults = {};
    return d.event_defaults;
}

function renderEventDefaults() {
    const ed = eventDefaults();
    setVal('ed-distribution', ed.distribution != null ? ed.distribution : 0);
    setVal('ed-sharing-group', ed.sharing_group_id != null ? ed.sharing_group_id : '');
    setVal('ed-threat-level', ed.threat_level_id != null ? ed.threat_level_id : '');
    setVal('ed-analysis', ed.analysis != null ? ed.analysis : '');
    setVal('ed-info-template', ed.info_template != null ? ed.info_template : '');
    updateSharingGroupVisibility();
    updateInfoTemplateStatus();
}

function bindEventDefaults() {
    onChange('ed-distribution', e => {
        const ed = eventDefaults();
        ed.distribution = parseInt(e.target.value, 10);
        if (ed.distribution !== 4) delete ed.sharing_group_id;   // only meaningful for a sharing group
        updateSharingGroupVisibility();
        scheduleValidate();
    });
    onInput('ed-sharing-group', e => {
        const ed = eventDefaults();
        const raw = e.target.value.trim();
        if (raw === '') delete ed.sharing_group_id;
        else {
            const n = parseInt(raw, 10);
            ed.sharing_group_id = Number.isNaN(n) ? raw : n;   // keep raw on NaN so the error surfaces
        }
        scheduleValidate();
    });
    onChange('ed-threat-level', e => setOptionalIntDefault('threat_level_id', e.target.value));
    onChange('ed-analysis', e => setOptionalIntDefault('analysis', e.target.value));
    onInput('ed-info-template', e => commitInfoTemplate(e.target.value));
    renderInfoToolbar();
}

// Optional integer scalar: blank option deletes the key, otherwise store the int.
function setOptionalIntDefault(key, rawValue) {
    const ed = eventDefaults();
    if (rawValue === '') delete ed[key];
    else ed[key] = parseInt(rawValue, 10);
    scheduleValidate();
}

// sharing_group_id only applies to (and is required for) distribution = 4.
function updateSharingGroupVisibility() {
    const grp = document.getElementById('ed-sharing-group-group');
    if (grp) grp.style.display = eventDefaults().distribution === 4 ? '' : 'none';
}

// ==========================================================================
// info_template guided builder (task 5.2)
// ==========================================================================
// The three static variables offered by the insert toolbar; the fourth kind,
// {{field:<id>}}, is offered via a dropdown built from the current element ids.
const INFO_STATIC_VARS = ['{{date}}', '{{now}}', '{{user}}'];

// Grammar ported verbatim from the library schema (#/definitions/info_template):
// any run of non-'{' chars, a lone '{' not starting a '{{', or a well-formed
// {{date}}/{{now}}/{{user}}/{{field:<id>}} token. Anything else (e.g. {{foo}},
// an unclosed {{) fails — matching what the server-side structural check rejects.
const INFO_TEMPLATE_RE = /^(?:[^{]+|\{(?!\{)|\{\{(?:date|now|user|field:[a-zA-Z_][a-zA-Z0-9_]*)\}\})*$/;
const INFO_FIELD_REF_RE = /\{\{field:([a-zA-Z_][a-zA-Z0-9_]*)\}\}/g;

// Build the insert-variable toolbar: static-variable buttons + a field-ref
// dropdown that lists the current element ids. Wired once from bindEventDefaults.
function renderInfoToolbar() {
    const bar = document.getElementById('ed-info-toolbar');
    if (!bar) return;
    bar.innerHTML =
        '<span class="et-info-toolbar-label">Insert:</span>' +
        INFO_STATIC_VARS.map(v =>
            `<button type="button" class="btn btn-small btn-secondary et-info-var" data-et-var="${v}">${v}</button>`).join('') +
        '<select class="form-select et-info-field-select" id="ed-info-field-insert" aria-label="Insert a field reference"></select>';

    bar.querySelectorAll('.et-info-var').forEach(btn => {
        btn.addEventListener('click', () => insertInfoVariable(btn.dataset.etVar));
    });
    const sel = bar.querySelector('#ed-info-field-insert');
    if (sel) {
        fillInfoFieldSelect(sel);
        // Rebuild on open so freshly added / renamed element ids are current.
        sel.addEventListener('mousedown', () => fillInfoFieldSelect(sel));
        sel.addEventListener('focus', () => fillInfoFieldSelect(sel));
        sel.addEventListener('change', () => {
            if (sel.value) insertInfoVariable(`{{field:${sel.value}}}`);
            sel.value = '';
        });
    }
}

// (Re)populate the {{field:…}} dropdown from the current structure element ids.
function fillInfoFieldSelect(sel) {
    const ids = editorState.definition.structure.map(e => e.id).filter(Boolean);
    if (!ids.length) {
        sel.innerHTML = '<option value="">{{field:…}} — no elements yet</option>';
        sel.disabled = true;
        return;
    }
    sel.disabled = false;
    sel.innerHTML = '<option value="">{{field:…}}</option>' +
        ids.map(id => `<option value="${escapeHtml(id)}">{{field:${escapeHtml(id)}}}</option>`).join('');
    sel.value = '';
}

// Insert text at the textarea caret (or at the end if no selection), keep the
// caret after the inserted token, then commit the new value.
function insertInfoVariable(text) {
    const ta = document.getElementById('ed-info-template');
    if (!ta) return;
    const start = ta.selectionStart != null ? ta.selectionStart : ta.value.length;
    const end = ta.selectionEnd != null ? ta.selectionEnd : ta.value.length;
    ta.value = ta.value.slice(0, start) + text + ta.value.slice(end);
    const caret = start + text.length;
    if (ta.setSelectionRange) ta.setSelectionRange(caret, caret);
    else { ta.selectionStart = caret; ta.selectionEnd = caret; }
    ta.focus();
    commitInfoTemplate(ta.value);
}

// Write info_template into event_defaults (delete-when-blank keeps the canonical
// doc minimal), refresh the inline status, and re-run the authoritative
// server-side validation (the export/persist gate).
function commitInfoTemplate(raw) {
    const ed = eventDefaults();
    if (raw === '') delete ed.info_template;
    else ed.info_template = raw;
    updateInfoTemplateStatus();
    scheduleValidate();
}

// --- Live grammar + {{field:id}} ref validation ---------------------------
// Pure: does the value satisfy the schema grammar? (Empty is valid.)
function infoTemplateGrammarOk(value) {
    return !value || INFO_TEMPLATE_RE.test(value);
}

// Pure: the distinct field ids referenced by {{field:<id>}} tokens, in order.
function infoTemplateFieldRefs(value) {
    const refs = [];
    if (!value) return refs;
    INFO_FIELD_REF_RE.lastIndex = 0;
    let m;
    while ((m = INFO_FIELD_REF_RE.exec(value)) !== null) {
        if (!refs.includes(m[1])) refs.push(m[1]);
    }
    return refs;
}

// Client-side problems for immediate inline feedback (the server validator is
// the authoritative gate and reports the same issues in the summary list).
function infoTemplateProblems(value) {
    if (!value) return [];
    if (!infoTemplateGrammarOk(value)) {
        return ['Malformed variable — use {{date}}, {{now}}, {{user}} or {{field:<id>}}, and close every {{ with }}.'];
    }
    const ids = new Set(editorState.definition.structure.map(e => e.id));
    const unknown = infoTemplateFieldRefs(value).filter(id => !ids.has(id));
    if (unknown.length) {
        return [`Unknown field id${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')} — {{field:…}} must reference an element id.`];
    }
    return [];
}

// Paint the inline error slot under the info_template textarea. Called on edit,
// on render, and (via editor.js applyValidation) after any structure change so a
// reference that goes dangling on a rename/delete is flagged live.
function updateInfoTemplateStatus() {
    const err = document.getElementById('err-info-template');
    if (!err) return;
    err.textContent = infoTemplateProblems((eventDefaults().info_template) || '').join(' ');
}
