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

## Repository Structure

```
misp-engineering-bay/
├── misp-object-template-creator/   # Object template authoring tool
├── misp-objects/                   # MISP objects library (git submodule)
├── PRD.md                          # Product requirements for the template creator
├── requirements.md                 # Implementation milestones and progress tracking
└── LICENSE                         # AGPL-3.0
```

## Getting Started

Clone the repository with submodules:

```bash
git clone --recurse-submodules https://github.com/<org>/misp-engineering-bay.git
cd misp-engineering-bay
```

Then follow the setup instructions for the specific tool you want to use.

## Contributing

Contributions are welcome. Each tool in this repository is self-contained with its own dependencies, tests, and documentation. When adding a new tool:

1. Create a new directory at the repository root
2. Include a `README.md` with setup and usage instructions
3. Include a test suite and wire it into the CI workflow
4. Keep dependencies isolated (use virtual environments)

## License

This software is licensed under the [GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

Copyright (c) 2026 Andras Iklody
