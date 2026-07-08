/**
 * preview.js — live canonical-JSON preview + validation status (PRD task 6.1).
 * The read-only user-form preview tab is filled in by task 6.2.
 *
 * The Preview region (inspector column) shows, side-by-side with the editor:
 *   - a validation / export-readiness status panel (D8 gate): the JSON is always
 *     previewable, but export & persist are blocked until validation passes with
 *     zero errors. Refreshed whenever a server ValidationResult lands
 *     (editor.js applyValidation → updatePreviewStatus).
 *   - a JSON tab rendering the EXACT canonical bytes the tool would export/persist
 *     — byte-identical to the server's template_store.canonical_dumps
 *     (jq -S: recursively sorted keys, 2-space indent, raw UTF-8, trailing newline).
 *
 * Load order: common → reference → elements → event-defaults → preview → editor.
 * Like its siblings this file references editorState / cleanForOutput only inside
 * functions (resolved at call time from editor.js); editor.js calls back into
 * initPreview() / renderPreviewJson() / updatePreviewStatus() guarded by `typeof`.
 */

'use strict';

// Recursively sort object keys (arrays keep their order). Mirrors Python
// json.dumps(sort_keys=True), which sorts keys at every depth.
function sortKeysDeep(v) {
    if (Array.isArray(v)) return v.map(sortKeysDeep);
    if (v && typeof v === 'object') {
        const out = {};
        Object.keys(v).sort().forEach(k => { out[k] = sortKeysDeep(v[k]); });
        return out;
    }
    return v;
}

// Canonical JSON string for a working definition — byte-identical to the server's
// canonical_dumps(cleanForOutput(def)). JSON.stringify(_, null, 2) matches Python
// json.dumps(indent=2, ensure_ascii=False): 2-space indent, ": " / ",\n"
// separators, and no escaping of non-ASCII (em-dashes appear literally). The
// trailing newline is appended to match the on-disk file exactly.
function canonicalJson(def) {
    const clean = (typeof cleanForOutput === 'function') ? cleanForOutput(def) : def;
    return JSON.stringify(sortKeysDeep(clean), null, 2) + '\n';
}

// --- Preview region wiring -------------------------------------------------
let _previewTab = 'json';

function initPreview() {
    document.querySelectorAll('[data-preview-tab]').forEach(btn => {
        btn.addEventListener('click', () => selectPreviewTab(btn.dataset.previewTab));
    });
    const copyBtn = document.getElementById('preview-json-copy');
    if (copyBtn) copyBtn.addEventListener('click', copyPreviewJson);

    selectPreviewTab(_previewTab);
    renderPreview();
    updatePreviewStatus(null);   // "Validating…" until the first result lands
}

// Refresh both preview tabs from the working document. Called by editor.js on
// every edit (via scheduleValidate); both renders are local + cheap.
function renderPreview() {
    renderPreviewJson();
    renderPreviewForm();
}

function selectPreviewTab(tab) {
    _previewTab = tab;
    document.querySelectorAll('[data-preview-tab]').forEach(btn => {
        const on = btn.dataset.previewTab === tab;
        btn.classList.toggle('active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('[data-preview-panel]').forEach(p => {
        p.hidden = p.dataset.previewPanel !== tab;
    });
}

// Re-serialise the working document into the JSON tab. Cheap + synchronous, so
// editor.js calls this on every edit (via scheduleValidate) for a live view —
// independent of the debounced server validation.
function renderPreviewJson() {
    const pre = document.getElementById('preview-json');
    if (!pre) return;
    let text;
    try {
        text = canonicalJson(editorState.definition);
    } catch (err) {
        pre.textContent = '// Could not serialise the document: ' + err.message;
        return;
    }
    pre.textContent = text;

    const meta = document.getElementById('preview-json-meta');
    if (meta) {
        const lines = text.replace(/\n$/, '').split('\n').length;
        meta.textContent = `${lines} line${lines === 1 ? '' : 's'} · ${formatBytes(byteLength(text))}`;
    }
}

// UTF-8 byte length (canonical files are UTF-8; multibyte chars like em-dashes
// count for more than one byte, so report the true on-disk size).
function byteLength(str) {
    if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(str).length;
    return unescape(encodeURIComponent(str)).length;   // legacy fallback
}
function formatBytes(n) {
    return n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KB`;
}

// Export-readiness status (D8). `res` is the server ValidationResult
// ({valid, errors[], warnings[]}) or null before the first validation lands.
// The detailed per-path error list lives in the canvas summary; this panel is
// the gate verdict — can this document be exported yet, and what's advisory.
function updatePreviewStatus(res) {
    const mount = document.getElementById('preview-status');
    if (!mount) return;
    if (!res) {
        mount.className = 'et-preview-status et-status-pending';
        mount.innerHTML = '<span class="et-status-line">Validating…</span>';
        return;
    }
    const nErr = (res.errors || []).length;
    const nWarn = (res.warnings || []).length;
    const ready = !!res.valid && nErr === 0;

    const verdict = ready
        ? '<span class="et-status-icon">✓</span> Passes validation — ready to export'
        : `<span class="et-status-icon">✗</span> Not exportable — ${nErr} error${nErr === 1 ? '' : 's'} to fix`;
    const warnLine = nWarn
        ? `<div class="et-status-warn">⚠ ${nWarn} warning${nWarn === 1 ? '' : 's'} (advisory — does not block export)</div>`
        : '';

    mount.className = 'et-preview-status ' + (ready ? 'et-status-ok' : 'et-status-bad');
    mount.innerHTML = `<span class="et-status-line">${verdict}</span>${warnLine}`;
}

// Copy the canonical JSON to the clipboard (Clipboard API + legacy fallback).
async function copyPreviewJson() {
    const text = canonicalJson(editorState.definition);
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
        } else {
            legacyCopy(text);
        }
        showToast('Canonical JSON copied to clipboard');
    } catch (err) {
        showToast('Could not copy: ' + err.message, 'error');
    }
}

function legacyCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } finally { ta.remove(); }
}

// ==========================================================================
// Read-only user-form preview (task 6.2)
//
// Mirrors MISP's userForm renderer (app/View/Elements/eventTemplates/userForm/*):
//   - the flat structure is grouped into section cards by DOCUMENT ORDER — a
//     `section` starts a new card and the elements after it are its body until
//     the next section (content before the first section → a headerless lead
//     card). MISP groups by order, not by the `parent` field, so the preview
//     shows exactly what the real form does.
//   - object_reference elements NEVER render into the form (they materialise a
//     relationship at instantiation); a muted footnote flags any that exist.
//   - every field is disabled (this is a look-only preview; it never posts).
// ==========================================================================

// Distribution / threat-level / analysis labels (mirror editor.html option text).
const PV_DISTRIBUTION = ['Your organisation only', 'This community only', 'Connected communities', 'All communities', 'Sharing group'];
const PV_THREAT = { 1: 'High', 2: 'Medium', 3: 'Low', 4: 'Undefined' };
const PV_ANALYSIS = { 0: 'Initial', 1: 'Ongoing', 2: 'Completed' };

// object_field templates still loading — tracked so we fire one background fetch
// per uuid and re-render once when it lands (renders synchronously from cache
// after). `_pvFailedUuids` records uuids that 404'd (template genuinely not in
// the bundle) so we show MISP's "not installed" note and stop re-fetching.
const _pvLoadingUuids = new Set();
const _pvFailedUuids = new Set();

function renderPreviewForm() {
    const mount = document.getElementById('preview-form');
    if (!mount) return;
    const def = editorState.definition || {};
    const structure = Array.isArray(def.structure) ? def.structure : [];

    const groups = groupStructure(structure);
    const bodyHtml = groups.length
        ? groups.map(groupHtml).join('')
        : '<p class="et-region-hint">Add elements from the palette to see the form a template user would fill.</p>';

    const nRefs = structure.filter(e => e.type === 'object_reference').length;
    const refNote = nRefs
        ? `<p class="etf-footnote">${nRefs} object reference${nRefs === 1 ? '' : 's'} defined — these are materialised as object↔object relationships at instantiation and do not appear on the user form.</p>`
        : '';

    mount.innerHTML = eventHeadHtml(def) + `<div class="etf-body">${bodyHtml}</div>` + refNote;
}

// Group the flat structure by document order (mirrors userForm shell.ctp).
function groupStructure(structure) {
    const groups = [];
    let current = { section: null, children: [] };
    structure.forEach(el => {
        if (el.type === 'section') {
            if (current.children.length || current.section) groups.push(current);
            current = { section: el, children: [] };
        } else if (el.type === 'object_reference') {
            // never user-facing
        } else {
            current.children.push(el);
        }
    });
    if (current.children.length || current.section) groups.push(current);
    return groups;
}

function groupHtml(group) {
    const header = group.section ? sectionHeaderHtml(group.section) : '';
    const cls = group.section ? 'etf-section-group' : 'etf-section-group etf-lead-group';
    const body = group.children.map(fieldHtml).join('');
    return `<section class="${cls}">${header}<div class="etf-section-body">${body}</div></section>`;
}

function sectionHeaderHtml(el) {
    const help = el.help ? `<div class="etf-section-help">${mdLite(el.help)}</div>` : '';
    return `<header class="etf-section-header"><h4 class="etf-section-title">${escapeHtml(el.label || el.id)}</h4>${help}</header>`;
}

// Dispatch one non-section element to its field renderer.
function fieldHtml(el) {
    switch (el.type) {
        case 'text_block': return textBlockHtml(el);
        case 'attribute_field': return attributeFieldHtml(el);
        case 'tag_field': return tagFieldHtml(el);
        case 'galaxy_field': return galaxyFieldHtml(el);
        case 'file_field': return fileFieldHtml(el);
        case 'event_report': return eventReportHtml(el);
        case 'object_field': return objectFieldHtml(el);
        default: return '';
    }
}

// --- shared field chrome ---------------------------------------------------
function fieldLabel(el, hint) {
    const req = el.mandatory ? '<span class="etf-req" title="Mandatory">*</span>' : '';
    const h = hint ? ` <span class="etf-typehint">(${escapeHtml(hint)})</span>` : '';
    return `<label class="etf-label">${escapeHtml(el.label || el.id)}${req}${h}</label>`;
}
function fieldHelp(el) {
    return el.help ? `<div class="etf-help">${mdLite(el.help)}</div>` : '';
}
function fieldWrap(el, inner, hint) {
    return `<div class="etf-field" data-etf-type="${escapeHtml(el.type)}">${fieldLabel(el, hint)}${fieldHelp(el)}${inner}</div>`;
}

// --- per-type renderers (all inputs disabled) ------------------------------
function textBlockHtml(el) {
    return `<div class="etf-text-block">${mdLite(el.content || '')}</div>`;
}

function attributeFieldHtml(el) {
    const misp = el.misp || {};
    const hint = [misp.category, misp.type].filter(Boolean).join(' / ');
    const val = misp.default_value != null ? String(misp.default_value) : '';
    const add = el.repeatable ? '<button type="button" class="etf-addbtn" disabled>+ Add another</button>' : '';
    const input = `<input type="text" class="etf-input" value="${escapeHtml(val)}" disabled>`;
    return fieldWrap(el, input + add, hint);
}

function tagFieldHtml(el) {
    const multiple = !!el.multiple;
    const ph = multiple ? 'Comma-separated tag names (e.g. tlp:amber, kill-chain:reconnaissance)' : 'A single tag name (e.g. tlp:amber)';
    const taxs = Array.isArray(el.restrict_taxonomies) ? el.restrict_taxonomies : [];
    const restrict = taxs.length
        ? `<div class="etf-restrict">Restricted to taxonomies: ${taxs.map(t => `<code>${escapeHtml(t)}</code>`).join(', ')}.</div>`
        : '';
    const row = `<div class="etf-picker-row">
        <input type="text" class="etf-input" placeholder="${escapeHtml(ph)}" disabled>
        <button type="button" class="etf-choose" disabled>Choose…</button>
    </div>`;
    return fieldWrap(el, row + restrict);
}

function galaxyFieldHtml(el) {
    const multiple = !!el.multiple;
    const ph = multiple ? 'Comma-separated galaxy cluster values (e.g. APT41, FIN7)' : 'A single galaxy cluster value (e.g. APT41)';
    const types = Array.isArray(el.restrict_galaxy_types) ? el.restrict_galaxy_types : [];
    const restrict = types.length
        ? `<div class="etf-restrict">Restricted to galaxy types: ${types.map(t => `<code>${escapeHtml(t)}</code>`).join(', ')}.</div>`
        : '<div class="etf-restrict etf-muted">No galaxy-type restriction; values are typed manually.</div>';
    const choose = types.length ? '<button type="button" class="etf-choose" disabled>Choose…</button>' : '';
    const row = `<div class="etf-picker-row"><input type="text" class="etf-input" placeholder="${escapeHtml(ph)}" disabled>${choose}</div>`;
    return fieldWrap(el, row + restrict);
}

function fileFieldHtml(el) {
    const as = el.as || 'attachment';
    const input = `<input type="file" class="etf-file" disabled${el.repeatable ? ' multiple' : ''}>`;
    const note = as === 'malware-sample'
        ? '<div class="etf-restrict etf-muted">Uploads are zipped and password-encrypted as MISP malware samples before storage.</div>'
        : '';
    return fieldWrap(el, input + note, `stored as ${as}`);
}

function eventReportHtml(el) {
    const ta = `<textarea class="etf-input etf-textarea" rows="6" disabled>${escapeHtml(el.default_content || '')}</textarea>`;
    return fieldWrap(el, ta, 'event report');
}

// object_field: bordered card with the template's relations as read-only rows.
// Relations come from the installed object template (loaded lazily, cached
// per-uuid); the authored `relations[]` overrides which show + their labels.
function objectFieldHtml(el) {
    const ot = el.object_template || {};
    const req = el.mandatory ? '<span class="etf-req" title="Mandatory">*</span>' : '';
    const help = fieldHelp(el);

    if (!ot.uuid) {
        return `<div class="etf-object">
            <div class="etf-object-title">${escapeHtml(el.label || el.id)}${req}</div>${help}
            <div class="etf-object-warn">No object template selected yet.</div>
        </div>`;
    }

    const titleName = `<span class="etf-typehint">(${escapeHtml(ot.name || ot.uuid)})</span>`;
    if (_pvFailedUuids.has(ot.uuid)) {
        return `<div class="etf-object">
            <div class="etf-object-title">${escapeHtml(el.label || el.id)}${req} ${titleName}</div>${help}
            <div class="etf-object-warn">Referenced object template is not installed
                (uuid ${escapeHtml(ot.uuid)} at version ≥ ${escapeHtml(String(ot.minimum_version ?? '?'))}).</div>
        </div>`;
    }

    const tmpl = refPeek(`/api/object-templates/${encodeURIComponent(ot.uuid)}`);
    if (!tmpl) {
        loadObjectTemplateForPreview(ot.uuid);
        return `<div class="etf-object">
            <div class="etf-object-title">${escapeHtml(el.label || el.id)}${req} ${titleName}</div>${help}
            <div class="etf-muted">Loading template relations…</div>
        </div>`;
    }

    const meta = `<span class="etf-typehint">${escapeHtml((tmpl.meta_category || '') + ' · v' + (tmpl.version || '?'))}</span>`;
    const reqBox = objectRequirementsHtml(tmpl);
    const rows = objectRelationRows(el, tmpl);
    const add = el.repeatable ? '<button type="button" class="etf-addbtn" disabled>+ Add another instance</button>' : '';
    return `<div class="etf-object">
        <div class="etf-object-title">${escapeHtml(el.label || el.id)}${req} ${meta}</div>${help}
        ${reqBox}
        <div class="etf-object-relations">${rows}</div>
        ${add}
    </div>`;
}

function objectRequirementsHtml(tmpl) {
    const required = Array.isArray(tmpl.required) ? tmpl.required : [];
    const oneOf = Array.isArray(tmpl.requiredOneOf) ? tmpl.requiredOneOf : [];
    if (!required.length && !oneOf.length) return '';
    const chips = arr => arr.map(r => `<code>${escapeHtml(r)}</code>`).join(', ');
    const a = required.length ? `<div><strong>Required:</strong> ${chips(required)}</div>` : '';
    const b = oneOf.length ? `<div><strong>At least one of:</strong> ${chips(oneOf)}</div>` : '';
    return `<div class="etf-object-req">${a}${b}</div>`;
}

// Which relations to show: the authored subset (in order, honouring
// hidden/label_override/help_override) when `relations[]` is set, else all
// template relations.
function objectRelationRows(el, tmpl) {
    const all = Array.isArray(tmpl.relations) ? tmpl.relations : [];
    const byName = new Map(all.map(r => [r.object_relation, r]));
    let show;
    if (Array.isArray(el.relations) && el.relations.length) {
        show = el.relations
            .filter(o => !o.hidden)
            .map(o => ({ rel: byName.get(o.object_relation), override: o }))
            .filter(x => x.rel);
    } else {
        show = all.map(r => ({ rel: r, override: null }));
    }
    if (!show.length) return '<div class="etf-muted">No relations to fill.</div>';
    return show.map(({ rel, override }) => {
        const ov = override || {};
        const label = ov.label_override || rel.object_relation;
        const mand = ov.mandatory ? '<span class="etf-req" title="Mandatory">*</span>' : '';
        const help = ov.help_override ? `<div class="etf-help">${mdLite(ov.help_override)}</div>`
            : (rel.description ? `<div class="etf-help etf-muted">${escapeHtml(rel.description)}</div>` : '');
        const val = ov.default_value != null ? String(ov.default_value) : '';
        return `<div class="etf-rel">
            <label class="etf-rel-label">${escapeHtml(label)}${mand}
                <span class="etf-typehint">(${escapeHtml(rel.misp_attribute || '')})</span></label>
            ${help}
            <input type="text" class="etf-input" value="${escapeHtml(val)}" disabled>
        </div>`;
    }).join('');
}

function loadObjectTemplateForPreview(uuid) {
    if (_pvLoadingUuids.has(uuid)) return;
    _pvLoadingUuids.add(uuid);
    loadObjectTemplate(uuid)
        .then(() => { _pvLoadingUuids.delete(uuid); renderPreviewForm(); })
        .catch(() => { _pvLoadingUuids.delete(uuid); _pvFailedUuids.add(uuid); renderPreviewForm(); });
}

// --- event header (what the operator sees for the event itself) ------------
function eventHeadHtml(def) {
    const ed = def.event_defaults || {};
    const info = ed.info_template
        ? infoTemplatePreview(ed.info_template)
        : '<span class="etf-muted">No info template — the user names the event.</span>';

    const bits = [];
    if (ed.distribution != null && PV_DISTRIBUTION[ed.distribution]) {
        let d = PV_DISTRIBUTION[ed.distribution];
        if (ed.distribution === 4 && ed.sharing_group_id != null) d += ` #${escapeHtml(String(ed.sharing_group_id))}`;
        bits.push(`Distribution: ${escapeHtml(d)}`);
    }
    if (ed.threat_level_id != null && PV_THREAT[ed.threat_level_id]) bits.push(`Threat level: ${PV_THREAT[ed.threat_level_id]}`);
    if (ed.analysis != null && PV_ANALYSIS[ed.analysis]) bits.push(`Analysis: ${PV_ANALYSIS[ed.analysis]}`);
    const meta = bits.length ? `<div class="etf-event-meta">${bits.map(escapeHtml).join(' · ')}</div>` : '';

    const tagChips = (ed.tags || []).map(t =>
        `<span class="etf-chip${t.locked ? ' etf-chip-locked' : ''}">${t.locked ? '🔒 ' : ''}${escapeHtml(t.name || '')}</span>`).join('');
    const gcChips = (ed.galaxy_clusters || []).map(g =>
        `<span class="etf-chip etf-chip-galaxy${g.locked ? ' etf-chip-locked' : ''}">${g.locked ? '🔒 ' : ''}${escapeHtml((g.galaxy_type || '') + ': ' + (g.value || ''))}</span>`).join('');
    const chips = (tagChips || gcChips) ? `<div class="etf-chips">${tagChips}${gcChips}</div>` : '';

    return `<div class="etf-event-head">
        <div class="etf-event-label">Event</div>
        <div class="etf-event-info">${info}</div>
        ${meta}${chips}
    </div>`;
}

// Render an info_template with its {{…}} variables as chips (values are
// substituted at instantiation; here they are just highlighted).
function infoTemplatePreview(tpl) {
    return escapeHtml(tpl).replace(/\{\{[^}]+\}\}/g, m => `<span class="etf-var">${m}</span>`);
}

// --- minimal, XSS-safe markdown for help / text_block / section help -------
// Full markdown is MISP's server-side EventTemplateMarkdown; here we escape
// first, then apply a few inline forms + line breaks — enough to preview help.
function mdLite(text) {
    let s = escapeHtml(text == null ? '' : String(text));
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/\n{2,}/g, '</p><p>').replace(/\n/g, '<br>');
    return `<p>${s}</p>`;
}
