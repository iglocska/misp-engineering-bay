/**
 * common.js — utilities shared across the editor and browser pages.
 *
 * Loaded before the page-specific script. Deliberately dependency-free and
 * side-effect-free (only defines globals) so both pages can reuse it.
 */

// --- HTML escaping ---------------------------------------------------------
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str == null ? '' : String(str);
    return div.innerHTML;
}

// --- Toast notifications ---------------------------------------------------
// type: 'success' (default) | 'error'
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => { toast.remove(); }, 3000);
}

// --- REST helpers ----------------------------------------------------------
// Thin fetch wrappers that parse JSON and surface API errors uniformly.
// On a non-2xx response they throw an Error carrying the server's `error`
// message (when present) so callers can `catch` and toast it.
async function apiGet(path) {
    const res = await fetch(path);
    return _parseJson(res);
}

async function apiPost(path, body) {
    const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body ?? {}),
    });
    return _parseJson(res);
}

async function apiSend(method, path, body) {
    const res = await fetch(path, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
    });
    return _parseJson(res);
}

async function _parseJson(res) {
    let data = null;
    try {
        data = await res.json();
    } catch (_) {
        // non-JSON body (e.g. a raw file download or empty response)
    }
    if (!res.ok) {
        const msg = (data && (data.error || data.message)) || `Request failed (${res.status})`;
        const err = new Error(msg);
        err.status = res.status;
        err.data = data;
        throw err;
    }
    return data;
}

// --- Misc ------------------------------------------------------------------
// Trailing-edge debounce for live-preview / search inputs.
function debounce(fn, wait = 200) {
    let t = null;
    return function (...args) {
        clearTimeout(t);
        t = setTimeout(() => fn.apply(this, args), wait);
    };
}
