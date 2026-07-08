/**
 * browse.js — the library browser page (PRD task 7.1).
 *
 * Lists the bundled misp-event-templates library + local drafts (output/),
 * filters by name/slug/description/tag and by source, and links each row into
 * the editor to load (?slug=), clone (?clone=) or view its canonical JSON. Draft
 * rows can be deleted (output/ only; the API refuses library-only slugs).
 *
 * Reuses common.js (apiGet/apiSend/escapeHtml/showToast/debounce); no editor
 * state or reference data needed here.
 */

'use strict';

let _allTemplates = [];
let _modalTemplate = null;

async function initBrowse() {
    wireControls();
    await loadTemplates();
}

async function loadTemplates() {
    const grid = document.getElementById('templates-grid');
    try {
        _allTemplates = await apiGet('/api/templates');
    } catch (err) {
        if (grid) grid.innerHTML = `<div class="empty-state">Could not load templates: ${escapeHtml(err.message)}</div>`;
        return;
    }
    populateTagFilter();
    applyFilters();
}

function wireControls() {
    const search = document.getElementById('search-input');
    if (search) search.addEventListener('input', debounce(applyFilters, 150));
    ['source-filter', 'tag-filter'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', applyFilters);
    });

    const modal = document.getElementById('json-modal');
    if (modal) {
        modal.querySelector('.modal-close').addEventListener('click', closeModal);
        modal.querySelector('.modal-backdrop').addEventListener('click', closeModal);
    }
    const copyBtn = document.getElementById('modal-copy');
    if (copyBtn) copyBtn.addEventListener('click', copyModalJson);
    const cloneBtn = document.getElementById('modal-clone');
    if (cloneBtn) cloneBtn.addEventListener('click', () => { if (_modalTemplate) gotoClone(_modalTemplate._slug); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });
}

function populateTagFilter() {
    const sel = document.getElementById('tag-filter');
    if (!sel) return;
    const tags = [...new Set(_allTemplates.flatMap(t => t.tags || []))].sort((a, b) => a.localeCompare(b));
    sel.innerHTML = '<option value="">All tags</option>' +
        tags.map(t => `<option value="${escapeHtml(t)}">${escapeHtml(t)}</option>`).join('');
}

// Pure filter — kept side-effect-free so it can be unit-tested.
function filterTemplates(all, q, source, tag) {
    let out = all;
    if (source) out = out.filter(t => t.source === source);
    if (tag) out = out.filter(t => (t.tags || []).includes(tag));
    if (q) {
        const s = q.toLowerCase();
        out = out.filter(t =>
            (t.name || '').toLowerCase().includes(s) ||
            (t.slug || '').toLowerCase().includes(s) ||
            (t.description || '').toLowerCase().includes(s) ||
            (t.tags || []).some(x => x.toLowerCase().includes(s)));
    }
    return out;
}

function applyFilters() {
    renderTemplates(filterTemplates(_allTemplates, val('search-input'), val('source-filter'), val('tag-filter')));
}

function renderTemplates(list) {
    const grid = document.getElementById('templates-grid');
    const count = document.getElementById('result-count');
    if (count) count.textContent = `${list.length} template${list.length === 1 ? '' : 's'}`;
    if (!grid) return;
    if (!list.length) {
        grid.innerHTML = '<div class="empty-state">No templates match your filters.</div>';
        return;
    }
    grid.innerHTML = list.map(cardHtml).join('');
    grid.querySelectorAll('[data-act]').forEach(btn => {
        btn.addEventListener('click', () => handleAction(btn.dataset.act, btn.dataset.slug));
    });
}

function cardHtml(t) {
    const isDraft = t.source === 'user';
    const badge = isDraft
        ? '<span class="badge badge-user">draft</span>'
        : '<span class="badge badge-submodule">library</span>';
    const tags = (t.tags || []).slice(0, 6).map(x => `<span class="meta-badge">${escapeHtml(x)}</span>`).join('');
    const del = isDraft
        ? `<button class="btn btn-small btn-danger" data-act="delete" data-slug="${escapeHtml(t.slug)}">Delete</button>`
        : '';
    const n = t.element_count;
    return `<div class="template-card">
        <div class="template-card-header">
            <h3 class="template-name">${escapeHtml(t.name || t.slug)}</h3>
            ${badge}
        </div>
        <p class="template-desc">${escapeHtml(t.description || 'No description')}</p>
        <div class="template-meta">
            <span class="meta-info">#${escapeHtml(t.slug)}</span>
            <span class="meta-info">${n} element${n === 1 ? '' : 's'}</span>
            ${t.misp_default ? '<span class="meta-info">misp default</span>' : ''}
        </div>
        <div class="template-tags">${tags}</div>
        <div class="template-actions">
            <button class="btn btn-small btn-secondary" data-act="view" data-slug="${escapeHtml(t.slug)}">View JSON</button>
            <button class="btn btn-small btn-secondary" data-act="clone" data-slug="${escapeHtml(t.slug)}">Clone</button>
            <button class="btn btn-small btn-primary" data-act="edit" data-slug="${escapeHtml(t.slug)}">Edit</button>
            ${del}
        </div>
    </div>`;
}

function handleAction(act, slug) {
    if (act === 'edit') gotoEdit(slug);
    else if (act === 'clone') gotoClone(slug);
    else if (act === 'view') viewJson(slug);
    else if (act === 'delete') deleteDraft(slug);
}

function gotoEdit(slug) { window.location.href = `/?slug=${encodeURIComponent(slug)}`; }
function gotoClone(slug) { window.location.href = `/?clone=${encodeURIComponent(slug)}`; }

async function viewJson(slug) {
    try {
        const tpl = await apiGet(`/api/templates/${encodeURIComponent(slug)}`);
        _modalTemplate = tpl;
        const clean = {};
        Object.keys(tpl).forEach(k => { if (!k.startsWith('_')) clean[k] = tpl[k]; });
        setText('modal-title', tpl.name || slug);
        setText('modal-json', JSON.stringify(sortDeep(clean), null, 2));
        const modal = document.getElementById('json-modal');
        if (modal) modal.hidden = false;
    } catch (err) {
        showToast(`Could not load "${slug}": ${err.message}`, 'error');
    }
}

// Deep key-sort so the modal view matches the editor's canonical key order.
function sortDeep(v) {
    if (Array.isArray(v)) return v.map(sortDeep);
    if (v && typeof v === 'object') {
        const o = {};
        Object.keys(v).sort().forEach(k => { o[k] = sortDeep(v[k]); });
        return o;
    }
    return v;
}

function copyModalJson() {
    const el = document.getElementById('modal-json');
    const text = el ? el.textContent : '';
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => showToast('JSON copied to clipboard'));
    } else {
        showToast('Clipboard not available', 'error');
    }
}

function closeModal() { const m = document.getElementById('json-modal'); if (m) m.hidden = true; }

async function deleteDraft(slug) {
    if (!window.confirm(`Delete draft "${slug}"? This removes it from output/ and cannot be undone.`)) return;
    try {
        await apiSend('DELETE', `/api/templates/${encodeURIComponent(slug)}`);
        showToast(`Draft "${slug}" deleted`);
        await loadTemplates();
    } catch (err) {
        showToast(`Could not delete "${slug}": ${err.message}`, 'error');
    }
}

// --- tiny DOM helpers ------------------------------------------------------
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function setText(id, t) { const el = document.getElementById(id); if (el) el.textContent = t; }

document.addEventListener('DOMContentLoaded', initBrowse);
