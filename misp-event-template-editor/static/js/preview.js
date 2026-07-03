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
    renderPreviewJson();
    updatePreviewStatus(null);   // "Validating…" until the first result lands
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
