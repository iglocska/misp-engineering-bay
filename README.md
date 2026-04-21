# MISP Engineering Bay

A collection of supporting tools for the [MISP](https://www.misp-project.org/) threat intelligence sharing platform and its surrounding libraries. The goal of this repository is to provide a set of simple, focused utilities that make life easier when building content, managing data structures, or developing code for the MISP ecosystem.

Whether you are a threat intelligence analyst crafting new object templates, a developer extending MISP's data model, or a maintainer reviewing community contributions, the tools in this repository aim to reduce friction and eliminate the need to manually work with raw data formats.

## Tools

### Object Template Creator

**Path:** [`misp-object-template-creator/`](misp-object-template-creator/)

A Python/Flask web application and REST API for creating, editing, validating, and exporting MISP object template definitions. Instead of hand-editing `definition.json` files, use a guided interface with real-time validation, searchable type lookups, and contextual help.

Key features:
- Visual template editor with guided attribute builder
- Real-time validation driven by MISP's `describeTypes.json` type system
- Browse, load, and modify any of the 388+ existing MISP object templates
- Full REST API for programmatic template management
- Interactive API documentation via Swagger UI
- Import/export of `definition.json` files
- Light and dark themes

See the [Object Template Creator README](misp-object-template-creator/README.md) for installation and usage instructions.

### Galaxy Editor

**Path:** [`misp-galaxy-editor/`](misp-galaxy-editor/)

A Python/Flask web application for creating, editing, validating, and exporting MISP galaxy definitions and their associated cluster collections. Supports both simple galaxies and matrix-style kill chain galaxies (like ATT&CK) with a drag-and-drop matrix editor. Runs in public mode (export zip only) or private mode (persist directly to the misp-galaxy repository).

Key features:
- Unified editor — galaxy metadata is entered once and shared across both the galaxy definition and cluster collection files
- Cluster editor with search, pagination, freeform meta fields (80+ known keys with autocomplete), and relationship management
- Matrix editor with drag-and-drop for kill chain galaxies (multiple scopes/tabs, Ctrl+drag for multi-phase assignment)
- Browse, load, clone, and modify any of the 112+ existing MISP galaxies
- Export as zip matching the misp-galaxy repository structure (`galaxies/` + `clusters/`)
- Real-time validation with live JSON preview
- Public/private mode — public for authoring and export, private for direct repository writes
- Light and dark themes

See the [Galaxy Editor README](misp-galaxy-editor/README.md) for installation and usage instructions.

## Repository Structure

```
misp-engineering-bay/
├── misp-object-template-creator/   # Object template authoring tool
├── misp-galaxy-editor/             # Galaxy definition and cluster editor
├── misp-objects/                   # MISP objects library (git submodule)
├── misp-galaxy/                    # MISP galaxy library (git submodule)
├── update-vendor-libs.sh           # Update bundled JS/CSS libraries
├── PRD.md                          # Product requirements for the template creator
├── requirements.md                 # Implementation milestones and progress tracking
└── LICENSE                         # AGPL-3.0
```

## Getting Started

Clone the repository with submodules:

```bash
git clone --recurse-submodules https://github.com/MISP/misp-engineering-bay.git
cd misp-engineering-bay
```

Then follow the setup instructions for the specific tool you want to use.

## Maintainer Notes

### Updating Vendored Libraries

All third-party JavaScript and CSS libraries (Swagger UI, JSZip) are vendored locally under each tool's `static/vendor/` directory — no external CDN links are used at runtime. Before each release, run the update script to fetch the latest versions:

```bash
./update-vendor-libs.sh
```

This will:
- Resolve the latest version of each library from the npm registry
- Download the files into the correct `static/vendor/` directories for each tool
- Print the versions fetched so you can verify

Review the changes with `git diff --stat` and commit the updated files with the release.

### Updating Submodules

The `misp-objects` and `misp-galaxy` submodules should be updated periodically to pick up new templates and galaxies from the upstream repositories:

```bash
git submodule update --remote
```

### Updating describeTypes.json

The Object Template Creator bundles a snapshot of MISP's canonical type definitions. To update it:

```bash
curl -o misp-object-template-creator/data/describeTypes.json \
  https://raw.githubusercontent.com/MISP/MISP/refs/heads/2.5/describeTypes.json
```

## Contributing

Contributions are welcome. Each tool in this repository is self-contained with its own dependencies, tests, and documentation. When adding a new tool:

1. Create a new directory at the repository root
2. Include a `README.md` with setup and usage instructions
3. Include a test suite and wire it into the CI workflow
4. Keep dependencies isolated (use virtual environments)

## License

This software is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

Copyright (c) 2026 Andras Iklody
