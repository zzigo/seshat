# Phase 3 UI Contract — Curatorial Workspace

## Product shape

The authenticated surface is a dense desktop workspace, not a marketing page. The public landing remains editorial. `/workspace` is the durable working shell.

## Stable shell

- 44px top bar: identity, global actions, save/worker state.
- 248px resizable-looking left rail: search, All references, hierarchical libraries/folders, documents.
- Remaining viewport: mutable Dockview host.
- Desktop-first. Below 760px the tree becomes an overlay and Dockview shows one active group.

## Catalog pod

- Handsontable 17, matching Musiki's current dashboard grid.
- Dense 28px rows, fixed title/author context, filters, sorting, resize, copy/paste and fill handle.
- Editable fields: title, authors, year, type, ISBN, language, tags, citekey, abstract.
- Cell changes autosave per row with visible saving/saved/error state and rollback on error.
- Double-clicking a row opens the document pod.

## Tree contract

- Canonical navigation remains outside Dockview.
- Libraries are hierarchical nodes with counts; references are leaf nodes.
- Selecting a library filters the catalog without destroying its open layout.
- A plus action creates a child folder under the selected library or at root.
- Selecting a reference opens/focuses its document pod.

## Pods and spatial runtime

- Dockview is an adapter implementation, not the domain API.
- `WorkspaceController` exposes `openCatalog`, `openDocument`, `openText`, `openTool`, `serialize`, `restore`.
- Initial pod kinds: catalog, document, extracted text, structure, analysis, annotation, agent.
- PDF uses the private original endpoint; EPUB is rendered lazily; TXT/DOCX use the Markdown derivative.
- Analysis, annotation and agent pods start as functional extension slots with document context.
- Layout persists locally; canonical catalog/library data remains in PostgreSQL.

## Automatic metadata

- Docling Markdown is evidence for the local Ollama identification agent.
- Title, authors and year may be auto-filled when no authoritative provider matches.
- Every inferred write records provider, confidence and evidence stage.
- Fields marked as manually curated are never overwritten by an agent.

## Visual system

- Preserve Seshat paper/ink/green/gold palette and restrained serif display type.
- Workspace chrome uses compact system/monospace typography; document content retains serif reading typography.
- Borders, not cards or shadows, define hierarchy.
- Dockview and Handsontable defaults are fully themed to Seshat.

## Verification

- Keyboard editing and copy/paste work in the grid.
- Tree selection filters rows and document leaves open pods.
- Two documents can be split and compared.
- Reload restores the spatial layout.
- Unauthorized API access remains rejected.
- Manual metadata survives a worker retry.
