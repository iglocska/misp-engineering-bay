/**
 * reference.js — client-side cache for the offline reference data the element
 * editors need (describeTypes categories/types, and — in later Phase-4 tasks —
 * object templates, taxonomies, galaxy types/clusters).
 *
 * All data is served by the tool's own `/api/*` endpoints (bundled submodules +
 * describeTypes.json; no live MISP). Each dataset is fetched at most once and
 * memoised: `refGet(path)` returns a cached promise; `refPeek(path)` is a
 * synchronous read of already-resolved data (null if not loaded yet) so editors
 * can render immediately when the cache is warm and fill in asynchronously when
 * it is cold.
 *
 * Loaded after common.js (uses apiGet) and before editor.js.
 */

'use strict';

const _refData = {};       // path -> resolved response
const _refInflight = {};   // path -> in-flight promise (dedupes concurrent loads)

// Fetch-and-cache a reference endpoint. Resolves to the cached value on repeat
// calls; a failed request is not cached (so a later call can retry).
function refGet(path) {
    if (path in _refData) return Promise.resolve(_refData[path]);
    if (path in _refInflight) return _refInflight[path];
    const p = apiGet(path)
        .then(data => { _refData[path] = data; delete _refInflight[path]; return data; })
        .catch(err => { delete _refInflight[path]; throw err; });
    _refInflight[path] = p;
    return p;
}

// Synchronous peek — the resolved data if already loaded, else null.
function refPeek(path) {
    return path in _refData ? _refData[path] : null;
}

// --- Typed accessors -------------------------------------------------------
// attribute_field category → type dropdowns + the semantic category+type check.
// Shape: { categories[], category_type_mappings{cat:[type…]}, sane_defaults{type:{default_category,to_ids}} }.
const REF_ATTRIBUTE_CATEGORIES = '/api/attribute-categories';
function loadAttributeCategories() { return refGet(REF_ATTRIBUTE_CATEGORIES); }
function attributeCategoriesNow() { return refPeek(REF_ATTRIBUTE_CATEGORIES); }

// Types valid for a category (empty list if the category is unset/unknown).
function typesForCategory(data, category) {
    if (!data || !category) return [];
    return (data.category_type_mappings && data.category_type_mappings[category]) || [];
}

// tag_field restrict_taxonomies picker. Response: [{namespace, description, …}].
const REF_TAXONOMIES = '/api/taxonomies';
function loadTaxonomies() { return refGet(REF_TAXONOMIES); }
function taxonomiesNow() { return refPeek(REF_TAXONOMIES); }

// galaxy_field restrict_galaxy_types picker. Response: [{type, name, namespace, …}].
const REF_GALAXY_TYPES = '/api/galaxy-types';
function loadGalaxyTypes() { return refGet(REF_GALAXY_TYPES); }
function galaxyTypesNow() { return refPeek(REF_GALAXY_TYPES); }

// Warm the caches the editor is likely to need, so the first element selection
// renders without a fetch round-trip. Best-effort; failures are non-fatal
// (the editors retry on demand).
function prewarmReferenceData() {
    loadAttributeCategories().catch(() => { /* editor retries when a field opens */ });
}
