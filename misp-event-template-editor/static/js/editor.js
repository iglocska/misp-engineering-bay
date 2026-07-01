/**
 * editor.js — builder shell & core state (PRD task 3.1).
 *
 * This file establishes the editor's in-memory model and boots the three-pane
 * builder shell. Later tasks fill the regions:
 *   - 3.2 envelope + library_metadata panel
 *   - 3.3 palette / canvas / properties framework + dotted-path state setter
 *   - 6.x live preview
 *
 * Everything downstream reads and mutates `editorState.definition`, which is
 * always the bare `event-template-v1` library document (no MISP DB envelope).
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

// A fresh, minimal-but-valid-shaped document. schema_version is const 1.
// uuid is filled from /api/uuid on demand (envelope work, task 3.2).
function newDefinition() {
    return {
        schema_version: 1,
        uuid: '',
        name: '',
        description: null,
        misp_default: true, // D9: new library templates default true
        event_defaults: {
            distribution: 0,
        },
        structure: [],
    };
}

// --- Central editor state. Mutated in place by later tasks. ---------------
const editorState = {
    mode: 'public',        // from /api/config; gates persist (D8/D4)
    slug: '',              // directory name (D7); distinct from definition.name
    source: 'draft',       // 'draft' (output/) | 'library' | 'new'
    selectedId: null,      // currently-selected structure element id
    definition: newDefinition(),
};

// --- Boot -----------------------------------------------------------------
async function initEditor() {
    // The Flask template already stamps the mode into the shell for a
    // no-flicker first paint; confirm it against the API (the contract the
    // rest of the UI relies on) and reconcile if they disagree.
    try {
        const cfg = await apiGet('/api/config');
        if (cfg && cfg.mode) setMode(cfg.mode);
    } catch (err) {
        // Offline/degraded: keep the server-rendered mode, note it once.
        console.warn('Could not load /api/config:', err.message);
    }
}

function setMode(mode) {
    editorState.mode = mode;
    const badge = document.getElementById('mode-badge');
    if (badge) {
        badge.dataset.mode = mode;
        badge.textContent = mode;
    }
}

document.addEventListener('DOMContentLoaded', initEditor);
