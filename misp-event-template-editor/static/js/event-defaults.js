/**
 * event-defaults.js — the template-level `event_defaults` panel (PRD Phase 5, D6).
 *
 * 5.1 wires the scalar dropdowns: distribution (+ a conditional sharing_group_id
 * shown only for distribution = 4, where the schema requires it), threat_level_id
 * and analysis. Later tasks extend this file with the info_template builder (5.2)
 * and the default tags / galaxy_clusters pickers (5.3).
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
    updateSharingGroupVisibility();
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
