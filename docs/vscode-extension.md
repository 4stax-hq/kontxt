# VS Code Extension Architecture

This document describes the recommended architecture for a VS Code extension that wraps `kontxt`.

## Goal

The extension should make `kontxt` easier to use inside the editor without creating a second datastore or a second continuity engine.

The CLI remains the source of truth.

## Recommended Design

The extension should:

- detect the current workspace root
- call `kontxt session start "<task>" --mode ask --json --dir <workspace>`
- show the returned action and summary in the UI
- let the user choose `Inject`, `Skip`, or `Fresh`
- call `kontxt session end --json --dir <workspace>` on explicit session completion
- expose shortcuts for:
  - `living focus`
  - `living task`
  - `living fact`
  - `living decision`
  - `living note`

## Why Keep The CLI As Source Of Truth

This keeps:

- local storage behavior consistent
- retrieval logic consistent
- session history consistent
- future browser/terminal integrations compatible

Do not duplicate retrieval logic, memory ranking, or transcript processing inside the extension.

## Extension Data Flow

### Session Start

1. Read the active workspace path.
2. Ask the user for a short task description, or infer it from the chat panel input.
3. Run:

```bash
kontxt session start "<task>" --mode ask --provider vscode --dir <workspace> --json
```

4. Parse JSON output.
5. If action is:
   - `inject`: show the summary and allow one-click insertion
   - `ask`: show a preview with `Inject` / `Skip`
   - `skip`: do nothing

### Session End

1. Gather the final transcript or summary from the chat provider if available.
2. Run:

```bash
kontxt session end --provider vscode --dir <workspace> --json
```

with transcript via stdin or a temporary local file.

3. Show a small completion summary in the extension UI.

## Local Invocation

Preferred order:

1. Use `kontxt` from PATH if available
2. Otherwise use `npx -y @4stax/kontxt`

Do not bundle a separate copy of the memory engine into the extension.

## Security Notes

- The extension should never upload the local vault by default
- The extension should treat `kontxt` as the only memory persistence layer
- Any transcript sent to `session end` should be user-visible or user-approved
- The extension should respect `fresh` mode and never force injection
- Do not scrape unrelated editor content silently

## Minimum Viable UI

- Command: `Kontxt: Start Session`
- Command: `Kontxt: End Session`
- Command: `Kontxt: Add Timeline Note`
- Command: `Kontxt: Set Current Focus`
- Command: `Kontxt: Add Decision`
- Status bar item showing current project continuity state

## Future Improvements

- automatic task inference from chat input
- workspace-specific defaults for `auto` / `ask` / `fresh`
- context preview panel
- recent timeline panel
- explicit feedback controls for “useful” / “not useful”
