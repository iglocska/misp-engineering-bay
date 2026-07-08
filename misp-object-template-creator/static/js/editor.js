/**
 * editor.js — Main editor logic: attribute builder, requirements, save/export.
 */

const META_CATEGORIES = [
    { value: 'file', hint: 'File-related objects (executables, documents, archives)' },
    { value: 'network', hint: 'Network-related objects (domains, IPs, URLs, emails)' },
    { value: 'financial', hint: 'Financial data (bank accounts, transactions, fraud)' },
    { value: 'marine', hint: 'Maritime and shipping related data' },
    { value: 'misc', hint: 'General purpose objects that don\'t fit other categories' },
    { value: 'mobile', hint: 'Mobile device and application data' },
    { value: 'internal', hint: 'Internal MISP objects for platform use' },
    { value: 'vulnerability', hint: 'Vulnerability and weakness tracking' },
    { value: 'climate', hint: 'Climate and environmental data' },
    { value: 'iot', hint: 'Internet of Things device data' },
    { value: 'health', hint: 'Health and medical data' },
    { value: 'followthemoney', hint: 'Follow The Money project objects' },
    { value: 'detection', hint: 'Detection rules and signatures' },
];

let attributeCounter = 0;
let isLoading = false;

// Track whether we loaded an existing template (for version auto-increment)
let originalVersion = null;  // version of the loaded template before editing
let isEditingExisting = false;

// ---- Initialisation ----

document.addEventListener('DOMContentLoaded', async () => {
    await loadTypes();
    populateMetaCategories();
    generateUuidOnLoad();
    checkCloneParam();
    schedulePreviewUpdate();

    // Import modal close handlers
    document.querySelector('#import-modal .modal-close').addEventListener('click', closeImportModal);
    document.querySelector('#import-modal .modal-backdrop').addEventListener('click', closeImportModal);
});

function populateMetaCategories() {
    const select = document.getElementById('tpl-meta-category');
    META_CATEGORIES.forEach(mc => {
        const opt = document.createElement('option');
        opt.value = mc.value;
        opt.textContent = mc.value;
        opt.title = mc.hint;
        select.appendChild(opt);
    });
}

async function generateUuidOnLoad() {
    const res = await fetch('/api/uuid');
    const data = await res.json();
    document.getElementById('tpl-uuid').value = data.uuid;
}

async function regenerateUuid() {
    const res = await fetch('/api/uuid');
    const data = await res.json();
    document.getElementById('tpl-uuid').value = data.uuid;
    schedulePreviewUpdate();
}

async function checkCloneParam() {
    const params = new URLSearchParams(window.location.search);
    const cloneName = params.get('clone');
    if (cloneName) {
        const res = await fetch(`/api/templates/${encodeURIComponent(cloneName)}`);
        if (res.ok) {
            const tpl = await res.json();
            loadTemplateIntoEditor(tpl, true);
            showToast(`Cloned template "${tpl.name || cloneName}"`);
        }
    }
}

// ---- Load template into editor ----

function loadTemplateIntoEditor(tpl, isClone = false) {
    isLoading = true;

    document.getElementById('tpl-name').value = isClone ? '' : (tpl.name || '');
    document.getElementById('tpl-description').value = tpl.description || '';
    document.getElementById('tpl-meta-category').value = tpl['meta-category'] || '';

    if (!isClone && tpl.uuid) {
        document.getElementById('tpl-uuid').value = tpl.uuid;
    }

    // Version auto-increment for edits (not clones — clones start at 1)
    if (isClone) {
        document.getElementById('tpl-version').value = 1;
        originalVersion = null;
        isEditingExisting = false;
    } else {
        originalVersion = tpl.version || 1;
        isEditingExisting = true;
        document.getElementById('tpl-version').value = autoIncrementVersion(originalVersion);
    }

    // Clear existing attributes
    document.getElementById('attributes-container').innerHTML = '';
    attributeCounter = 0;

    // Add attributes
    if (tpl.attributes) {
        for (const [name, def] of Object.entries(tpl.attributes)) {
            addAttribute(name, def);
        }
    }

    // Set requirements after attributes are loaded
    setTimeout(() => {
        updateRequirementsCheckboxes();
        if (tpl.required) {
            tpl.required.forEach(r => {
                const cb = document.querySelector(`#required-checkboxes .checkbox-chip[data-name="${r}"]`);
                if (cb) cb.click();
            });
        }
        if (tpl.requiredOneOf) {
            tpl.requiredOneOf.forEach(r => {
                const cb = document.querySelector(`#requiredOneOf-checkboxes .checkbox-chip[data-name="${r}"]`);
                if (cb) cb.click();
            });
        }
        isLoading = false;
        schedulePreviewUpdate();
    }, 50);
}

// ---- Attribute management ----

function addAttribute(name, def) {
    const container = document.getElementById('attributes-container');
    const template = document.getElementById('attribute-template');
    const card = template.content.cloneNode(true).querySelector('.attribute-card');

    attributeCounter++;
    card.dataset.attrIndex = attributeCounter;
    card.querySelector('.attr-index-label').textContent = `#${attributeCounter}`;

    // Populate if loading existing
    if (name) {
        card.querySelector('.attr-name').value = name;
        card.querySelector('.attr-name-preview').textContent = name;
    }
    if (def) {
        card.querySelector('.attr-description').value = def.description || '';
        card.querySelector('.attr-ui-priority').value = def['ui-priority'] ?? 0;
        if (def.multiple) card.querySelector('.attr-multiple').checked = true;
        if (def.disable_correlation) card.querySelector('.attr-disable-correlation').checked = true;
        if (def.recommended === false) card.querySelector('.attr-recommended').checked = false;
        if (def.to_ids) card.querySelector('.attr-to-ids').checked = true;
    }

    container.appendChild(card);

    // Setup type search
    setupTypeSearch(card, def ? def['misp-attribute'] : null);

    // Setup categories
    setupCategories(card, def ? def['misp-attribute'] : null, def ? def.categories : null);

    // Setup tag inputs
    setupTagInput(card.querySelector('.attr-sane-defaults-input'), card.querySelector('.attr-sane-defaults-tags'), def ? def.sane_default : null);
    setupTagInput(card.querySelector('.attr-values-list-input'), card.querySelector('.attr-values-list-tags'), def ? def.values_list : null);

    // Name preview update
    card.querySelector('.attr-name').addEventListener('input', function () {
        card.querySelector('.attr-name-preview').textContent = this.value || '';
        updateRequirementsCheckboxes();
        schedulePreviewUpdate();
    });

    // Change listeners for live preview
    card.querySelectorAll('input, textarea, select').forEach(el => {
        el.addEventListener('change', () => schedulePreviewUpdate());
        el.addEventListener('input', () => schedulePreviewUpdate());
    });

    if (!isLoading) {
        updateRequirementsCheckboxes();
        schedulePreviewUpdate();
    }
}

function removeAttribute(btn) {
    if (!confirm('Remove this attribute?')) return;
    const card = btn.closest('.attribute-card');
    card.remove();
    renumberAttributes();
    updateRequirementsCheckboxes();
    schedulePreviewUpdate();
}

function duplicateAttribute(btn) {
    const card = btn.closest('.attribute-card');
    const data = readAttributeCard(card);
    if (data) {
        addAttribute(data.name + '-copy', data.def);
    }
}

function moveAttribute(btn, direction) {
    const card = btn.closest('.attribute-card');
    const container = document.getElementById('attributes-container');
    const cards = [...container.children];
    const index = cards.indexOf(card);
    const newIndex = index + direction;
    if (newIndex < 0 || newIndex >= cards.length) return;

    if (direction === -1) {
        container.insertBefore(card, cards[newIndex]);
    } else {
        container.insertBefore(card, cards[newIndex].nextSibling);
    }
    renumberAttributes();
    schedulePreviewUpdate();
}

function toggleAttributeCard(btn) {
    btn.closest('.attribute-card').classList.toggle('collapsed');
}

function renumberAttributes() {
    const cards = document.querySelectorAll('.attribute-card');
    cards.forEach((card, i) => {
        card.querySelector('.attr-index-label').textContent = `#${i + 1}`;
    });
}

// ---- Searchable type dropdown ----

function setupTypeSearch(card, initialType) {
    const searchInput = card.querySelector('.attr-type-search');
    const dropdown = card.querySelector('.type-dropdown');
    const typeInfo = card.querySelector('.type-info');
    const types = getAllTypes();
    let highlightedIndex = -1;
    let filteredTypes = types;

    function renderDropdown(filter) {
        const q = (filter || '').toLowerCase();
        filteredTypes = q ? types.filter(t => t.type.includes(q)) : types;
        highlightedIndex = -1;
        dropdown.innerHTML = filteredTypes.slice(0, 50).map((t, i) => `
            <div class="type-option" data-type="${escapeHtml(t.type)}" data-index="${i}">
                <span>${escapeHtml(t.type)}</span>
                <span class="type-option-cat">${t.default_category || ''}</span>
            </div>
        `).join('');
        dropdown.hidden = filteredTypes.length === 0;
    }

    function selectType(mispType) {
        searchInput.value = mispType;
        dropdown.hidden = true;
        const info = getTypeInfo(mispType);
        if (info) {
            typeInfo.hidden = false;
            typeInfo.innerHTML = `Default category: <strong>${escapeHtml(info.default_category || 'none')}</strong> | IDS: <strong>${info.default_to_ids ? 'Yes' : 'No'}</strong> | Valid in ${info.categories.length} categories`;
        }
        setupCategories(card, mispType, null);
        schedulePreviewUpdate();
    }

    searchInput.addEventListener('focus', () => {
        renderDropdown(searchInput.value);
        dropdown.hidden = false;
    });

    searchInput.addEventListener('input', () => {
        renderDropdown(searchInput.value);
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            highlightedIndex = Math.min(highlightedIndex + 1, filteredTypes.length - 1);
            updateHighlight();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            highlightedIndex = Math.max(highlightedIndex - 1, 0);
            updateHighlight();
        } else if (e.key === 'Enter') {
            e.preventDefault();
            if (highlightedIndex >= 0 && highlightedIndex < filteredTypes.length) {
                selectType(filteredTypes[highlightedIndex].type);
            }
        } else if (e.key === 'Escape') {
            dropdown.hidden = true;
        }
    });

    function updateHighlight() {
        dropdown.querySelectorAll('.type-option').forEach((opt, i) => {
            opt.classList.toggle('highlighted', i === highlightedIndex);
            if (i === highlightedIndex) opt.scrollIntoView({ block: 'nearest' });
        });
    }

    dropdown.addEventListener('click', (e) => {
        const opt = e.target.closest('.type-option');
        if (opt) selectType(opt.dataset.type);
    });

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
        if (!card.contains(e.target)) dropdown.hidden = true;
    });

    if (initialType) selectType(initialType);
}

// ---- Category chips ----

function setupCategories(card, mispType, selectedCategories) {
    const container = card.querySelector('.categories-container');
    const allCats = getAllCategories();
    const validCats = mispType ? getCategoriesForType(mispType) : [];

    container.innerHTML = '';

    if (!mispType) {
        container.innerHTML = '<span class="empty-hint">Select a MISP type first to see available categories</span>';
        return;
    }

    allCats.forEach(cat => {
        const isValid = validCats.includes(cat);
        const isSelected = selectedCategories ? selectedCategories.includes(cat) : false;
        const chip = document.createElement('label');
        chip.className = `category-chip ${isValid ? '' : 'disabled'} ${isSelected ? 'selected' : ''}`;
        chip.innerHTML = `<input type="checkbox" ${isSelected ? 'checked' : ''} ${isValid ? '' : 'disabled'}> ${escapeHtml(cat)}`;

        chip.querySelector('input').addEventListener('change', function () {
            chip.classList.toggle('selected', this.checked);
            schedulePreviewUpdate();
        });
        container.appendChild(chip);
    });
}

// ---- Tag input (sane_default, values_list) ----

function setupTagInput(input, tagList, initialValues) {
    const addTag = (value) => {
        value = value.trim();
        if (!value) return;
        // Check for duplicates
        const existing = [...tagList.querySelectorAll('.tag-item')].map(t => t.dataset.value);
        if (existing.includes(value)) return;

        const tag = document.createElement('span');
        tag.className = 'tag-item';
        tag.dataset.value = value;
        tag.innerHTML = `${escapeHtml(value)} <span class="tag-remove">&times;</span>`;
        tag.querySelector('.tag-remove').addEventListener('click', () => {
            tag.remove();
            schedulePreviewUpdate();
        });
        tagList.appendChild(tag);
        input.value = '';
        schedulePreviewUpdate();
    };

    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            addTag(input.value);
        } else if (e.key === 'Backspace' && !input.value) {
            const last = tagList.querySelector('.tag-item:last-child');
            if (last) { last.remove(); schedulePreviewUpdate(); }
        }
    });

    if (initialValues) {
        initialValues.forEach(v => addTag(v));
    }
}

function getTagValues(tagList) {
    return [...tagList.querySelectorAll('.tag-item')].map(t => t.dataset.value);
}

// ---- Requirements checkboxes ----

function updateRequirementsCheckboxes() {
    const attrNames = getAttributeNames();
    updateCheckboxGroup('required-checkboxes', attrNames);
    updateCheckboxGroup('requiredOneOf-checkboxes', attrNames);
}

function updateCheckboxGroup(containerId, names) {
    const container = document.getElementById(containerId);
    // Preserve current selections
    const currentChecked = new Set(
        [...container.querySelectorAll('.checkbox-chip.checked')].map(c => c.dataset.name)
    );

    if (names.length === 0) {
        container.innerHTML = '<span class="empty-hint">Add attributes above first</span>';
        return;
    }

    container.innerHTML = '';
    names.forEach(name => {
        const chip = document.createElement('label');
        chip.className = `checkbox-chip ${currentChecked.has(name) ? 'checked' : ''}`;
        chip.dataset.name = name;
        chip.innerHTML = `<input type="checkbox" ${currentChecked.has(name) ? 'checked' : ''}> ${escapeHtml(name)}`;
        chip.querySelector('input').addEventListener('change', function () {
            chip.classList.toggle('checked', this.checked);
            schedulePreviewUpdate();
        });
        container.appendChild(chip);
    });
}

function getCheckedNames(containerId) {
    return [...document.getElementById(containerId).querySelectorAll('.checkbox-chip.checked')]
        .map(c => c.dataset.name);
}

// ---- Read current state ----

function getAttributeNames() {
    return [...document.querySelectorAll('.attribute-card .attr-name')]
        .map(el => el.value.trim())
        .filter(Boolean);
}

function readAttributeCard(card) {
    const name = card.querySelector('.attr-name').value.trim();
    const mispAttr = card.querySelector('.attr-type-search').value.trim();
    const desc = card.querySelector('.attr-description').value.trim();
    const uiPri = parseInt(card.querySelector('.attr-ui-priority').value) || 0;

    const def = {
        'misp-attribute': mispAttr,
        'ui-priority': uiPri,
        description: desc,
    };

    // Categories
    const selectedCats = [...card.querySelectorAll('.categories-container .category-chip input:checked')]
        .map(cb => cb.parentElement.textContent.trim());
    if (selectedCats.length > 0) {
        def.categories = selectedCats;
    }

    // Flags — only include if explicitly set
    if (card.querySelector('.attr-disable-correlation').checked) def.disable_correlation = true;
    if (card.querySelector('.attr-multiple').checked) def.multiple = true;
    if (!card.querySelector('.attr-recommended').checked) def.recommended = false;
    if (card.querySelector('.attr-to-ids').checked) def.to_ids = true;

    // Tag values
    const saneDefaults = getTagValues(card.querySelector('.attr-sane-defaults-tags'));
    if (saneDefaults.length > 0) def.sane_default = saneDefaults;

    const valuesList = getTagValues(card.querySelector('.attr-values-list-tags'));
    if (valuesList.length > 0) def.values_list = valuesList;

    return { name, def };
}

function buildTemplateJson() {
    const tpl = {};

    // Attributes first (sorted by card order)
    const attributes = {};
    document.querySelectorAll('.attribute-card').forEach(card => {
        const { name, def } = readAttributeCard(card);
        if (name) attributes[name] = def;
    });
    tpl.attributes = attributes;

    tpl.description = document.getElementById('tpl-description').value.trim();
    tpl['meta-category'] = document.getElementById('tpl-meta-category').value;
    tpl.name = document.getElementById('tpl-name').value.trim();

    const required = getCheckedNames('required-checkboxes');
    if (required.length > 0) tpl.required = required;

    const requiredOneOf = getCheckedNames('requiredOneOf-checkboxes');
    if (requiredOneOf.length > 0) tpl.requiredOneOf = requiredOneOf;

    tpl.uuid = document.getElementById('tpl-uuid').value.trim();
    tpl.version = parseInt(document.getElementById('tpl-version').value) || 1;

    return tpl;
}

// ---- Save / Export ----

async function saveTemplate() {
    markAllTouched();
    const tpl = buildTemplateJson();
    const name = tpl.name;
    if (!name) {
        showToast('Please enter a template name', 'error');
        schedulePreviewUpdate();
        return;
    }

    // Check if it exists (to decide POST vs PUT)
    const checkRes = await fetch(`/api/templates/${encodeURIComponent(name)}`);
    let res;
    if (checkRes.ok) {
        const existing = await checkRes.json();
        if (existing._source === 'misp-objects') {
            // Save as user override
            res = await fetch(`/api/templates/${encodeURIComponent(name)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tpl),
            });
        } else {
            res = await fetch(`/api/templates/${encodeURIComponent(name)}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tpl),
            });
        }
    } else {
        res = await fetch('/api/templates', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tpl),
        });
    }

    const data = await res.json();
    if (res.ok) {
        showToast('Template saved successfully');
    } else {
        showToast(data.errors ? `Validation failed: ${data.errors.length} error(s)` : (data.error || 'Save failed'), 'error');
        if (data.errors) updateValidationDisplay(data);
    }
}

function exportJson() {
    const tpl = buildTemplateJson();
    const json = JSON.stringify(tpl, null, 2);
    const blob = new Blob([json + '\n'], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'definition.json';
    a.click();
    URL.revokeObjectURL(url);
}

function copyJson() {
    const tpl = buildTemplateJson();
    navigator.clipboard.writeText(JSON.stringify(tpl, null, 2));
    showToast('JSON copied to clipboard');
}

// ---- Import ----

function importJson() {
    document.getElementById('import-modal').hidden = false;
}

function closeImportModal() {
    document.getElementById('import-modal').hidden = true;
    document.getElementById('import-textarea').value = '';
    document.getElementById('import-file').value = '';
}

function doImport() {
    const file = document.getElementById('import-file').files[0];
    const text = document.getElementById('import-textarea').value.trim();

    if (file) {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const tpl = JSON.parse(e.target.result);
                loadTemplateIntoEditor(tpl, false);
                closeImportModal();
                showToast('Template imported');
            } catch (err) {
                showToast('Invalid JSON file: ' + err.message, 'error');
            }
        };
        reader.readAsText(file);
    } else if (text) {
        try {
            const tpl = JSON.parse(text);
            loadTemplateIntoEditor(tpl, false);
            closeImportModal();
            showToast('Template imported');
        } catch (err) {
            showToast('Invalid JSON: ' + err.message, 'error');
        }
    } else {
        showToast('Please upload a file or paste JSON', 'error');
    }
}

// ---- Load existing template ----

let loadAllTemplates = [];

async function openLoadExisting() {
    const modal = document.getElementById('load-modal');
    modal.hidden = false;

    const list = document.getElementById('load-templates-list');
    list.innerHTML = '<div class="loading">Loading templates...</div>';

    const res = await fetch('/api/templates');
    loadAllTemplates = await res.json();

    // Populate category filter
    const catFilter = document.getElementById('load-category-filter');
    const cats = [...new Set(loadAllTemplates.map(t => t['meta-category']).filter(Boolean))].sort();
    catFilter.innerHTML = '<option value="">All categories</option>';
    cats.forEach(cat => {
        const opt = document.createElement('option');
        opt.value = cat;
        opt.textContent = cat;
        catFilter.appendChild(opt);
    });

    filterLoadTemplates();
}

function filterLoadTemplates() {
    const query = (document.getElementById('load-search').value || '').toLowerCase();
    const cat = document.getElementById('load-category-filter').value;
    let filtered = loadAllTemplates;
    if (query) {
        filtered = filtered.filter(t =>
            t.name.toLowerCase().includes(query) || (t.description && t.description.toLowerCase().includes(query))
        );
    }
    if (cat) {
        filtered = filtered.filter(t => t['meta-category'] === cat);
    }
    renderLoadTemplates(filtered);
}

function renderLoadTemplates(templates) {
    const list = document.getElementById('load-templates-list');
    if (templates.length === 0) {
        list.innerHTML = '<div class="empty-state">No templates match your search.</div>';
        return;
    }
    list.innerHTML = templates.map(t => `
        <div class="load-template-row" data-dir="${escapeHtml(t.dir || t.name)}" data-name="${escapeHtml(t.name)}">
            <span class="load-template-name">${escapeHtml(t.name)}</span>
            <span class="load-template-desc">${escapeHtml(t.description || '')}</span>
            <span class="load-template-meta">${escapeHtml(t['meta-category'])} | ${t.attribute_count} attrs | v${t.version}</span>
        </div>
    `).join('');

    list.querySelectorAll('.load-template-row').forEach(row => {
        row.addEventListener('click', () => doLoadExisting(row.dataset.dir, row.dataset.name));
    });
}

async function doLoadExisting(dir, displayName) {
    const res = await fetch(`/api/templates/${encodeURIComponent(dir)}`);
    if (!res.ok) {
        showToast('Failed to load template', 'error');
        return;
    }
    const tpl = await res.json();
    const mode = document.querySelector('input[name="load-mode"]:checked').value;
    const isClone = mode === 'clone';
    loadTemplateIntoEditor(tpl, isClone);
    closeLoadModal();
    const label = displayName || dir;
    showToast(isClone ? `Cloned "${label}" as new template` : `Loaded "${label}" for editing`);
}

function closeLoadModal() {
    document.getElementById('load-modal').hidden = true;
    document.getElementById('load-search').value = '';
}

document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('load-search').addEventListener('input', filterLoadTemplates);
    document.getElementById('load-category-filter').addEventListener('change', filterLoadTemplates);
    document.querySelector('#load-modal .modal-close').addEventListener('click', closeLoadModal);
    document.querySelector('#load-modal .modal-backdrop').addEventListener('click', closeLoadModal);
});

// ---- Version auto-increment ----

/**
 * Detect whether a version is date-based (YYYYMMDD or YYYYMMDDNN) or numeric,
 * and return an appropriately incremented value.
 *
 * Date-based (>= 20000000): replace with today's date (YYYYMMDD). If the
 * existing version already matches today's date, append or increment a
 * two-digit suffix (e.g. 20260406 -> 2026040601 -> 2026040602).
 *
 * Numeric: increment by 1.
 */
function autoIncrementVersion(version) {
    const v = parseInt(version, 10);
    if (isNaN(v) || v < 1) return 1;

    // Date-based threshold: >= 20000000 looks like YYYYMMDD
    if (v >= 20000000) {
        const today = new Date();
        const yyyy = today.getFullYear();
        const mm = String(today.getMonth() + 1).padStart(2, '0');
        const dd = String(today.getDate()).padStart(2, '0');
        const todayStr = `${yyyy}${mm}${dd}`;
        const todayNum = parseInt(todayStr, 10);

        const vStr = String(v);
        const vDatePart = vStr.substring(0, 8);

        if (vDatePart === todayStr) {
            // Already today — increment suffix
            if (vStr.length <= 8) {
                return parseInt(todayStr + '01', 10);
            } else {
                const suffix = parseInt(vStr.substring(8), 10) + 1;
                return parseInt(todayStr + String(suffix).padStart(2, '0'), 10);
            }
        }
        return todayNum;
    }

    // Numeric — simple increment
    return v + 1;
}

// ---- Persist to repository (private mode) ----

async function persistTemplate() {
    markAllTouched();
    const tpl = buildTemplateJson();
    if (!tpl.name) {
        showToast('Please enter a template name', 'error');
        schedulePreviewUpdate();
        return;
    }

    if (!confirm(`This will write "${tpl.name}" directly to the misp-objects repository. Continue?`)) {
        return;
    }

    const res = await fetch('/api/templates/persist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tpl),
    });

    const data = await res.json();
    if (res.ok) {
        showToast('Template persisted to repository');
    } else {
        showToast(data.errors ? `Validation failed: ${data.errors.length} error(s)` : (data.error || 'Persist failed'), 'error');
        if (data.errors) updateValidationDisplay(data);
    }
}

// ---- Reset ----

function resetEditor() {
    if (!confirm('Clear the editor and start a new template?')) return;
    document.getElementById('tpl-name').value = '';
    document.getElementById('tpl-description').value = '';
    document.getElementById('tpl-meta-category').value = '';
    document.getElementById('tpl-version').value = '1';
    document.getElementById('attributes-container').innerHTML = '';
    attributeCounter = 0;
    originalVersion = null;
    isEditingExisting = false;
    updateRequirementsCheckboxes();
    regenerateUuid();
    schedulePreviewUpdate();
}
