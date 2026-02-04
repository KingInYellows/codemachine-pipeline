<!-- anchor: ui-ux-architecture-title -->
# UI/UX Architecture: AI-Driven Feature Development Workflow
**Status:** UI_REQUIRED

<!-- anchor: 1-0-design-system-specification -->
## 1. Design System Specification
The CLI-first surface still benefits from a codified visual and experiential language so that command output, prompts, and generated artifacts are predictable across shells, terminals, and automated runners. The design system leans on ANSI-safe color tokens, monospace type, and structured spacing that matches markdown exports.

<!-- anchor: 1-1-color-palette -->
### 1.1 Color Palette
The palette defines ANSI-friendly color pairings for both dark and light terminal themes and mirrored markdown outputs.

<!-- anchor: 1-1-1-core-hues -->
#### 1.1.1 Core Hues
- Token `core-bg` — default background, relies on terminal profile but documented as `#0B0E14` for dark and `#FAFBFF` for light exports to align CLI and markdown artifacts.
- Token `core-fg` — primary text, `#F8FAFD` (dark) / `#1B1F23` (light) for maximum contrast and readability during long transcript reviews.
- Token `core-muted` — `#9CA3AF` for descriptive copy, ensuring 4.5:1 contrast to satisfy WCAG in dark terminals.
- Token `core-highlight` — `#3B82F6` for selection and focus states, matching GitHub links and reducing context switching.
- Token `core-border` — `#2D3748` for panel dividers and ASCII boxes that frame CLI blocks.
- Token `core-gradient-start` — `#2563EB` used for markdown callouts and documentation headers.
- Token `core-gradient-end` — `#0EA5E9` for subtle progression bars in TUI-capable shells.
- Token `core-neutral` — `#E5E7EB` references lighten sections when exported to HTML or PDF.
- Token `core-shadow` — `rgba(8, 15, 26, 0.45)` for diagrams rendered in docs.
- Token `core-overlay` — `rgba(11, 14, 20, 0.82)` for modal experiences inside optional TUIs.

<!-- anchor: 1-1-2-semantic-colors -->
#### 1.1.2 Semantic Colors
- Token `semantic-info` — `#38BDF8` for context notes, CLI hints, and documentation tooltips.
- Token `semantic-success` — `#22C55E` for completed steps, PR merges, and validation passes.
- Token `semantic-warning` — `#F97316` for pending approvals, rate-limit jitter warnings, or human action requests.
- Token `semantic-danger` — `#EF4444` for failed validations, merge blockers, or credential issues.
- Token `semantic-neutral-strong` — `#64748B` for neutral headers, e.g., "Context Manifest" block titles.
- Token `semantic-neutral-soft` — `#CBD5F5` for background shading of optional sections.
- Token `semantic-note` — `#C084FC` used sparingly to highlight blueprint references in exported markdown.
- Token `semantic-selection` — `rgba(56, 189, 248, 0.35)` for interactive copy-to-clipboard windows.
- Token `semantic-ghost` — `rgba(255, 255, 255, 0.05)` for ghost buttons in TUI flows.
- Token `semantic-shadow-strong` — `rgba(8, 24, 37, 0.8)` to anchor overlays when CLI launches text editor windows.

<!-- anchor: 1-1-3-terminal-theme-layers -->
#### 1.1.3 Terminal Theme Layers
- Layer `terminal-dark` — default recommended, ensures bright tokens map to 16 ANSI color indexes.
- Layer `terminal-light` — alternative for high-contrast requirements; ensures warnings still exceed 3:1 ratio.
- Layer `markdown-export` — ensures the same colors render in GitHub README previews.
- Layer `pdf-export` — uses CMYK approximations and provides fallback grayscale values in documentation.
- Layer `tui-high-contrast` — boosts brightness for accessible TUIs and screen recordings.
- Layer `ci-logs` — strips colors to plain ASCII while documenting the color codes in metadata for rehydration.
- Layer `observability-dashboard` — uses hex tokens for external dashboards referencing CLI outputs.
- Layer `telemetry-replay` — ensures log replay tools map color-coded severity lines to consistent palette tokens.
- Layer `ai-prompt` — sanitized color descriptions for context included in agent prompts.
- Layer `html-notebook` — for knowledge base exports with inline CSS variables.

<!-- anchor: 1-1-4-usage-guidelines -->
#### 1.1.4 Usage Guidelines
- Always pair `core-fg` with `core-bg` except inside inverted callouts where `core-highlight` becomes background.
- Limit `semantic-danger` to failure states so operators immediately recognize risk.
- Use `semantic-warning` for rate-limit delays or human approval gates; never for success states.
- Within PlantUML diagrams, map `semantic-info` to notes and `semantic-success` to green states for parity.
- Provide text fallbacks describing the color use for screen readers in documentation exports.
- Document all palette tokens inside `.codepipe/design-tokens.json` for future automation.
- Ensure TUIs include toggles for "colorless" mode by disabling ANSI escapes.
- Keep color usage deterministic by referencing tokens, not raw codes, within CLI rendering functions.
- Provide sample color swatches in `codepipe init` documentation to help new operators configure terminals.
- Publish color usage guidelines inside `docs/ui/color.md` with before/after CLI captures for verification.

<!-- anchor: 1-2-typography -->
### 1.2 Typography
Typography ensures CLI transcripts and exported markdown remain legible and scannable.

<!-- anchor: 1-2-1-font-selection -->
#### 1.2.1 Font Selections
- Primary font `JetBrains Mono` ensures ligatures for CLI symbols, fallback `Fira Code`, `IBM Plex Mono`.
- Documentation font pairing `Inter` for headings, `Source Code Pro` for inline code.
- Bold weight used for statuses and route headers; italic reserved for hints and disclaimers.
- Terminal ensures `font-size 14px` baseline with `line-height 20px` for readability.
- Markdown exports set `font-size 16px` for headings to meet accessibility guidelines.
- PlantUML diagrams set default monospace to maintain consistent shaping with CLI output.
- Keep fallback stack `SFMono-Regular`, `Menlo`, `Monaco`, `Consolas`, `Liberation Mono` for OS parity.
- Provide `font-config.json` mapping for TUI frameworks to ensure cross-platform fonts.
- Document "safe fonts" for remote environments lacking custom fonts, e.g., `DejaVu Sans Mono`.
- When generating PDF outputs, embed fonts or substitute with metrics-compatible alternatives.

<!-- anchor: 1-2-2-type-scale -->
#### 1.2.2 Type Scale
- Size token `xs` — 12px / 16px line height for inline badges.
- Token `sm` — 14px / 20px for CLI prompts and metadata lines.
- Token `md` — 16px / 24px for body copy in docs.
- Token `lg` — 18px / 28px for run summary headers.
- Token `xl` — 20px / 28px for feature titles and gating prompts.
- Token `2xl` — 24px / 32px for doc cover pages.
- Token `3xl` — 30px / 40px for diagrams and marketing overlays.
- Token `4xl` — 36px / 44px for limited hero messages when generating onboarding docs.
- Terminal-specific scaling ensures `xs` never used for essential info to respect readability.
- Provide type ramp sample in documentation with reference lines showing baseline alignment.

<!-- anchor: 1-2-3-typographic-behaviors -->
#### 1.2.3 Typographic Behaviors
- Use `md` size for descriptive paragraphs to maximize long-read comfort.
- Apply uppercase sparingly, mostly for CLI step labels to avoid shouting effect.
- Keep code segments enclosed within `` for inline and triple backticks for multi-line blocks.
- Align columns using monospace spacing to maintain parity across terminals.
- Provide textual separation via blank lines after headings and before lists.
- Distinguish statuses using badges rather than text color alone for accessibility.
- Always include textual equivalents for icons, e.g., `[SUCCESS]` to support color-free logs.
- Provide translation-ready copy by isolating microcopy strings in `locale` files.
- Document typographic rules in `docs/ui/typography.md` with CLI snapshots.
- Provide lint check ensuring CLI message templates reference tokens, not literal strings, for consistency.

<!-- anchor: 1-3-spacing-sizing -->
### 1.3 Spacing & Sizing
Spacing ensures CLI sections remain scannable even in dense contexts.

<!-- anchor: 1-3-1-spacing-scale -->
#### 1.3.1 Spacing Scale
- Token `space-0` — 0px, used for tight table columns.
- Token `space-1` — 2px (rare) for micro adjustments in diagrams.
- Token `space-2` — 4px baseline for inline elements.
- Token `space-3` — 8px for separators between badges.
- Token `space-4` — 12px for block-level spacing.
- Token `space-5` — 16px default vertical rhythm between paragraphs.
- Token `space-6` — 20px for section boundaries.
- Token `space-7` — 24px for CLI output grouping.
- Token `space-8` — 32px for page-level sections inside documentation.
- Token `space-9` — 40px for hero elements.

<!-- anchor: 1-3-2-layout-density -->
#### 1.3.2 Layout Densities
- `density-compact` for automation logs with minimal blank lines yet retains bullet indentation.
- `density-cozy` default for CLI; adds one blank line before headings and after tables.
- `density-comfortable` for human review docs; increases spacing tokens by 1 level for readability.
- Provide toggles such as `--compact` flag to shrink whitespace for machine parsing.
- Document spacing tokens in `design-tokens.json` for reuse in knowledge bases.
- Provide sample `layout-recipes.md` demonstrating how to mix densities per artifact type.
- Align ASCII tables with `space-3` padding to avoid wrap in 80-column terminals.
- Provide margin rules for TUI panels ensuring there is at least `space-4` between edges.
- Use `space-7` when presenting multi-step flows to isolate each stage.
- Provide CLI configuration to toggle `density` per user preference.

<!-- anchor: 1-4-component-tokens -->
### 1.4 Component Tokens
Component-level tokens define deterministic shapes, depth, and transitions.

<!-- anchor: 1-4-1-radius-corners -->
#### 1.4.1 Radius & Corners
- Token `radius-none` for ASCII-only frames.
- Token `radius-xs` (2px) for inline badges rendered in docs.
- Token `radius-sm` (4px) for CLI pseudo cards.
- Token `radius-md` (6px) for documentation callouts.
- Token `radius-lg` (8px) for hero cards.
- Token `radius-full` for pills like approval statuses.
- Provide CLI-lint to ensure exported markdown uses consistent radius class names.
- Document how TUIs map radius tokens to border style (rounded vs. square).
- Provide `radius-policy.md` to align 3rd-party adapters (Graphite dashboards) with same shapes.
- Align PlantUML skin parameters to mimic radius using `roundrectangle` shapes.

<!-- anchor: 1-4-2-shadows-depth -->
#### 1.4.2 Shadows & Depth
- Token `shadow-none` for inline text.
- Token `shadow-xs` for CLI cards with subtle depth in docs.
- Token `shadow-sm` for modals.
- Token `shadow-md` for hero sections.
- Token `shadow-lg` for overlay disclaimers.
- Provide ASCII analogs using `|` and `+` characters to mimic structure.
- Document fallback patterns for colorless terminals.
- Provide CSS variables for documentation exports to match CLI tokens.
- Map PlantUML `shadowing true` to tokens described above.
- Provide tests verifying `shadow` tokens remain accessible (no blur for text-laden boxes).

<!-- anchor: 1-4-3-motion-transition -->
#### 1.4.3 Motion & Transition
- CLI uses text-based transitions described via sequential numbering rather than animations.
- Document `transition-fast (100ms)`, `transition-base (250ms)`, `transition-slow (400ms)` for optional TUI states.
- Provide textual cues like `…` to indicate in-progress operations, ensuring screen readers can parse them.
- For CLI modals, print `Press Enter to continue` after transitional statements to avoid confusion.
- Provide `progress indicator` guidelines for multi-line loaders.
- Document fallback for non-interactive shells: show discrete steps with timestamps.
- Avoid complex animations; rely on successive frames and consistent phrasing.
- Provide TUI-specific docs on how to animate progress bars while meeting CPU budgets.
- Provide `motion-lint` conceptual check to ensure no spinner loops exceed 1 second per frame.
- Provide translation guidelines that transitional text remains simple.

<!-- anchor: 1-5-interaction-feedback -->
### 1.5 Interaction Feedback
Feedback ensures CLI states remain clear.

<!-- anchor: 1-5-1-messaging-levels -->
#### 1.5.1 Messaging Levels
- Level `note` — used for informative hints, prefixed with `[note]`.
- Level `task` — indicates action to take, e.g., `[task] Approve PRD`.
- Level `success` — `[done]` label plus `semantic-success` color.
- Level `warning` — `[warn]` label plus `semantic-warning` color.
- Level `error` — `[error]` label, `semantic-danger` color, and recommended action line.
- Level `blocked` — `[blocked]` label for branch protection issues.
- Level `rate-limit` — `[delay]` label describing wait time.
- Provide mapping between levels and CLI exit codes.
- Document probability for human gating messages to avoid autop merges.
- Provide `message-style.md` with templates for each level.

<!-- anchor: 1-5-2-inline-status-patterns -->
#### 1.5.2 Inline Status Patterns
- Use `[✓]`, `[~]`, `[x]`, `[?]` icons accompanied by text.
- Provide `status legend` near start of each CLI output for clarity.
- Document `status alignment` when statuses appear in tables.
- Provide `status-lint` to ensure statuses always include textual explanation.
- Provide mapping between statuses and GitHub states.
- Provide instructions for customizing icons when using fonts lacking these characters.
- Provide `status-color` mapping table referencing design tokens.
- Provide `status semantics` referencing FR/IR requirement IDs for traceability.
- Provide `status in logs` guidelines to keep them parseable.
- Provide `status in docs` guidelines for consistent emoji usage.

<!-- anchor: 1-6-cli-visual-language -->
### 1.6 CLI Visual Language
Defines grammar for CLI prompts, responses, and doc exports.

<!-- anchor: 1-6-1-prompt-structure -->
#### 1.6.1 Prompt Structure
- Always show `Command bar` with command invoked and resolved feature id.
- Provide `Context header` summarizing repo, branch, and config flags.
- Provide `Step indicator` showing progression (e.g., `Step 3/10`).
- Provide `Action summary` describing upcoming behavior.
- Provide `Confirmation prompt` with explicit `[y/N]` default.
- Provide `Keyboard hints` for optional TUIs.
- Provide `Non-interactive instructions` describing how to supply `--yes` or `--json` flags.
- Provide `Error fallback` describing manual file edits if prompt rejected.
- Provide `Prompt-lint` to ensure templating includes necessary metadata.
- Provide `Internationalization` placeholder such as `%featureTitle%` to avoid string duplication.

<!-- anchor: 1-6-2-output-framing -->
#### 1.6.2 Output Framing
- Surround major sections with ASCII rulers `────────────────` for scannability.
- Provide `section label` within the ruler for quick search.
- Provide `table-of-contents` at start of long outputs.
- Provide `metadata block` summarizing runtime, CLI version, Node version.
- Provide `artifact references` linking to run directory files.
- Provide `context manifest` block listing hashed files included.
- Provide `diff summary block` with patch stats.
- Provide `API ledger block` summarizing rate-limit state.
- Provide `next actions block` instructing operator on gating decisions.
- Provide `closing block` showing `codepipe status <id>` hint for returning later.

<!-- anchor: 1-7-accessibility-tokens -->
### 1.7 Accessibility Tokens
- Token `aria-heading` ensures each CLI output starts with textual heading for screen readers.
- Token `aria-region` describes sections like `Context Manifest` or `Plan Stack` with textual start/end markers.
- Token `aria-live` indicates streaming updates by prefixing `~` for incremental lines.
- Token `aria-command` ensures CLI commands are repeated verbatim in backticks.
- Token `aria-shortcut` describes keyboard combos spelled out in full words.
- Token `aria-status` ensures statuses include textual sentence structure.
- Token `aria-focus` describes where interactive focus should return after editing files.
- Token `aria-link` ensures copy contains the actual URL or path spelled out.
- Token `aria-counter` describes progress with both numbers and percentages.
- Token `aria-time` prints timestamps in ISO8601 to support localization tools.

<!-- anchor: 1-8-content-tone -->
### 1.8 Content Tone & Microcopy
- Tone is authoritative yet collaborative; avoid anthropomorphism when referencing agents.
- Always lead instructions with verbs: "Review", "Approve", "Resume".
- Avoid sarcasm or blame; treat errors as actionable events.
- Provide context referencing requirement IDs for clarity.
- Keep sentences under 24 words for CLI readability.
- Provide inclusive language guidelines documented in `docs/ui/microcopy.md`.
- Provide fallback text for automation contexts where humor might fail.
- Provide localization-ready strings with placeholders for nouns.
- Provide consistent references to state machine steps.
- Provide sample microcopy for each command scenario.

<!-- anchor: 1-9-data-density -->
### 1.9 Data Density & Summaries
- Provide summary tables with max 5 columns to avoid wrap.
- Provide link to `--json` output for machine use, but keep human view rich.
- Provide `collapsible` patterns using indentation for optional data.
- Provide `scope indicators` to show which files/paths are touched.
- Provide `density toggles` to switch between `cozy` and `compact` mode.
- Provide `progress snapshots` at every gating step for quick resumption.
- Provide `agent cost summary` with token/money estimates per run.
- Provide `API call summary` linking to rate-limit records.
- Provide `unknowns ledger` capturing open research tasks.
- Provide `diff digest` summarizing patch weight and touched directories.

<!-- anchor: 1-10-diagram-document-styling -->
### 1.10 Diagram & Document Styling
- PlantUML diagrams use monospace fonts and `semantic-info` for notes.
- Provide `grid spacing` aligning nodes to avoid clutter.
- Provide `legend block` describing icons/states for non-visual readers.
- Provide `export pipeline` converting PlantUML to PNG/SVG for docs.
- Provide `diagram naming structure` referencing requirement IDs.
- Provide `diagram versioning` stored under run directories.
- Provide `diagram-lint` verifying anchors exist for diagrams referenced.
- Provide `diagram color tokens` aligning to CLI palette for mental mapping.
- Provide `diagram alt text` near diagrams with textual explanation.
- Provide `diagram retention policy` referencing cleanup commands.

<!-- anchor: 1-11-internationalization -->
### 1.11 Internationalization & Localization
- Strings extracted to `locales/{lang}.json` for CLI and docs.
- Provide `locale fallback` to `en-US` when translation missing.
- Provide `directionality` support for RTL languages in docs.
- Provide `date/time formatting` config (ISO default) to avoid ambiguity.
- Provide `number formatting` following locale but keep CLI decimals dot-based for scripts.
- Provide `glossary terms` ensuring consistent translation of blueprint vocabulary.
- Provide `translation testing checklist` verifying placeholders remain intact.
- Provide `automated extraction` command `codepipe i18n sync` to update dictionaries.
- Provide `component-locale map` showing which CLI sections require translation.
- Provide `localization context` comments for ambiguous phrases.

<!-- anchor: 1-12-documentation-presentation -->
### 1.12 Documentation Presentation System
- Provide `docs/ui` folder mirroring CLI sections and tokens.
- Provide `single-source-of-truth` for tokens consumed by CLI, docs, and adapters.
- Provide `mdx` components for documentation to render CLI transcripts.
- Provide `storybook-like` doc pages describing CLI components via screenshots/gifs.
- Provide `contribution guidelines` for updating design assets.
- Provide `template library` for PRD/spec/plan outputs.
- Provide `diagram index` referencing anchors.
- Provide `glossary` cross-referencing blueprint sections.
- Provide `audit pack` instructions showing which docs to export for compliance.
- Provide `update cadence` requiring design artifacts to be reviewed every quarter.

<!-- anchor: 2-0-component-architecture -->
## 2. Component Architecture
Component architecture follows atomic design but oriented toward CLI modules, documentation renderers, and optional TUIs.

<!-- anchor: 2-1-overview -->
### 2.1 Overview
- Architecture uses `Atoms → Molecules → Organisms → Workspaces` pattern.
- Each CLI output references components to ensure consistent structure.
- Components align with `oclif` command scaffolding, hooking into templating layer.
- Accessibility and localization wrappers exist as HOCs for textual outputs.
- Component props documented via TypeScript interfaces stored under `src/ui`.
- CLI styling functions rely on shared token service.
- Markdown renderers reuse same components to provide parity.
- TUI modules optionally wrap CLI components for interactive sessions.
- Contract tests ensure components degrade gracefully in colorless logs.
- Observability instrumentation attaches to each component to log usage.

<!-- anchor: 2-2-core-components -->
### 2.2 Core Component Specification
Atoms define base textual units, molecules combine them, organisms create CLI views, and workspaces orchestrate flows. Each component lists props, variants, accessibility, and CLI-specific usage.

<!-- anchor: 2-2-1-atoms -->
#### 2.2.1 Atoms
Atoms ensure consistent formatting for minimal units. Each entry lists purpose, props, states, accessibility, responsive behavior, and validation notes.

<!-- anchor: 2-2-1-1-atom-command-label -->
##### 2.2.1.1 Atom: Command Label
- Purpose: display invoked CLI command, e.g., `codepipe start`.
- Props: `command`, `args`, `flags`, `contextPath`.
- States: `default`, `error`, `readonly` when command derived from script.
- Accessibility: always enclosed in backticks with `Command:` prefix.
- Responsive: wraps at 80 columns and duplicates on multi-line for readability.
- Validation: ensures args sanitized before display.

<!-- anchor: 2-2-1-2-atom-badge -->
##### 2.2.1.2 Atom: Status Badge
- Purpose: represent statuses `[done]`, `[warn]`, etc.
- Props: `label`, `status`, `tooltip`, `id`.
- States: `solid`, `ghost`, `outline` for docs vs CLI.
- Accessibility: includes textual explanation following badge.
- Responsive: collapses to emoji for narrow contexts.
- Validation: ensures status matches allowed tokens.

<!-- anchor: 2-2-1-3-atom-divider -->
##### 2.2.1.3 Atom: Divider Rule
- Purpose: separate sections using `─` characters.
- Props: `label`, `length`, `alignment`.
- States: `default`, `highlighted` for gating sections.
- Accessibility: includes textual `Section Start/End` markers.
- Responsive: shortens to `---` for limited width.
- Validation: ensures label unique per output.

<!-- anchor: 2-2-1-4-atom-inline-code -->
##### 2.2.1.4 Atom: Inline Code Capsule
- Purpose: format file paths, commands, tokens.
- Props: `text`, `language`, `wrapPolicy`.
- States: `default`, `danger` for destructive commands.
- Accessibility: uses `` wrappers and textual description.
- Responsive: ensures long values truncated with ellipses but full value logged.
- Validation: ensures no secrets output.

<!-- anchor: 2-2-1-5-atom-keybinding -->
##### 2.2.1.5 Atom: Keybinding Token
- Purpose: show `Ctrl+C`, `Enter`, etc.
- Props: `keys`, `action`, `platformVariants`.
- States: `default`, `mac`, `linux`.
- Accessibility: includes spelled-out instructions.
- Responsive: inline with prompts, multi-line for docs.
- Validation: ensures cross-platform parity.

<!-- anchor: 2-2-1-6-atom-timestamp -->
##### 2.2.1.6 Atom: Timestamp Stamp
- Purpose: show ISO time for steps.
- Props: `value`, `timezone`, `relative`.
- States: `absolute`, `relative`, `delta`.
- Accessibility: always spelled out, e.g., `2025-12-15T12:45:22Z (5s ago)`.
- Responsive: hides relative time in compact mode.
- Validation: ensures monotonic order for logs.

<!-- anchor: 2-2-1-7-atom-link-chip -->
##### 2.2.1.7 Atom: Link Chip
- Purpose: show clickable path or URL references.
- Props: `label`, `target`, `type` (file, url, command).
- States: `resolved`, `pending`, `error`.
- Accessibility: prints actual path for screen readers.
- Responsive: wraps with indentation.
- Validation: ensures path sanitized and accessible.

<!-- anchor: 2-2-1-8-atom-progress -->
##### 2.2.1.8 Atom: Progress Indicator
- Purpose: display progress numeric and bar-based.
- Props: `current`, `total`, `label`.
- States: `in-progress`, `paused`, `complete`.
- Accessibility: includes textual `3 of 7 steps complete (43%)`.
- Responsive: condensed to single line in narrow contexts.
- Validation: ensures values not dividing by zero.

<!-- anchor: 2-2-1-9-atom-diffstat -->
##### 2.2.1.9 Atom: Diff Stat Token
- Purpose: show `+123/-45` patch metrics.
- Props: `added`, `removed`, `files`.
- States: `default`, `warning` when diff large.
- Accessibility: includes textual summary `Added 123 lines, removed 45 across 7 files`.
- Responsive: merges numbers when width limited.
- Validation: ensures counts sync with git data.

<!-- anchor: 2-2-1-10-atom-alert-icon -->
##### 2.2.1.10 Atom: Alert Icon
- Purpose: ASCII icon for alerts.
- Props: `level`, `label`, `id`.
- States: `info`, `success`, `warning`, `danger`, `blocked`.
- Accessibility: includes textual explanation after icon.
- Responsive: in compact mode, icon replaced with uppercase label.
- Validation: ensures color usage matches tokens.

<!-- anchor: 2-2-1-11-atom-context-tag -->
##### 2.2.1.11 Atom: Context Tag
- Purpose: tag referencing repo, feature, integration.
- Props: `type`, `value`, `colorToken`.
- States: `default`, `highlighted`, `muted`.
- Accessibility: text includes type prefix, e.g., `Repo: github.com/...`.
- Responsive: condenses to initials when width < 50 characters.
- Validation: ensures type enumerations align with schema.

<!-- anchor: 2-2-1-12-atom-checklist -->
##### 2.2.1.12 Atom: Checklist Item
- Purpose: show gating steps.
- Props: `step`, `status`, `description`, `requirementId`.
- States: `not-started`, `in-progress`, `complete`, `blocked`.
- Accessibility: includes `Requirement FR-11` reference for clarity.
- Responsive: multi-line descriptions indent under bullet.
- Validation: ensures requirement IDs valid.

<!-- anchor: 2-2-1-13-atom-field -->
##### 2.2.1.13 Atom: Field Label
- Purpose: label-value pairs for metadata.
- Props: `label`, `value`, `alignment`.
- States: `default`, `highlighted`, `muted`.
- Accessibility: label always spelled out, value repeated.
- Responsive: ensures colon and spacing consistent.
- Validation: ensures secret values redacted.

<!-- anchor: 2-2-1-14-atom-annotation -->
##### 2.2.1.14 Atom: Annotation Note
- Purpose: inline note referencing blueprint or docs.
- Props: `text`, `source`, `link`.
- States: `info`, `warning`, `risk`.
- Accessibility: includes `See blueprint section...` text.
- Responsive: wraps text with `space-5` indentation.
- Validation: ensures anchors exist.

<!-- anchor: 2-2-1-15-atom-filehash -->
##### 2.2.1.15 Atom: File Hash Token
- Purpose: show file path + hash.
- Props: `path`, `hash`, `size`.
- States: `unchanged`, `modified`, `new`.
- Accessibility: prints entire line for screen readers.
- Responsive: collapses hash to first 8 characters but full stored.
- Validation: ensures hash algorithm documented.

<!-- anchor: 2-2-2-molecules -->
#### 2.2.2 Molecules
Molecules combine atoms into interactive clusters.

<!-- anchor: 2-2-2-1-molecule-command-header -->
##### 2.2.2.1 Molecule: Command Header Block
- Composition: Command Label + Context Tags + Timestamp.
- Variants: `initial`, `resume`, `dry-run`.
- Accessibility: reads as `Command executed at...` string.
- Responsive: collapses tags into list below command for narrow width.
- Validation: ensures run id included.

<!-- anchor: 2-2-2-2-molecule-progress-lane -->
##### 2.2.2.2 Molecule: Progress Lane
- Composition: Progress Indicator + Checklist Items.
- Variants: `horizontal`, `vertical`, `compact`.
- Accessibility: includes summary line `Currently on step X`.
- Responsive: hides secondary descriptions when compact.
- Validation: ensures steps sorted.

<!-- anchor: 2-2-2-3-molecule-context-table -->
##### 2.2.2.3 Molecule: Context Table
- Composition: File Hash Tokens + Field Labels.
- Variants: `files`, `tickets`, `docs`.
- Accessibility: includes instructions on how to open file.
- Responsive: uses multi-column layout >100 char width.
- Validation: ensures table header repeated every 20 rows for readability.

<!-- anchor: 2-2-2-4-molecule-validation-panel -->
##### 2.2.2.4 Molecule: Validation Panel
- Composition: Status Badges + Annotation Notes + Diff Stat Token.
- Variants: `lint`, `test`, `build`, `custom`.
- Accessibility: spells out command executed and exit code.
- Responsive: collapses logs into summary with `--show-logs` hint.
- Validation: ensures commands redacted when containing secrets.

<!-- anchor: 2-2-2-5-molecule-rate-limit-ledger -->
##### 2.2.2.5 Molecule: Rate Limit Ledger
- Composition: Field Labels + Progress Indicator + Annotation for resets.
- Variants: `github`, `linear`, `agent`.
- Accessibility: includes textual `Remaining 350/5000 requests, reset at...`.
- Responsive: optionally hide ledger behind accordion to avoid clutter.
- Validation: ensures data saved to `rate_limits.json`.

<!-- anchor: 2-2-2-6-molecule-approval-gate -->
##### 2.2.2.6 Molecule: Approval Gate Prompt
- Composition: Checklist Items + Keybinding Tokens + Annotation.
- Variants: `prd`, `spec`, `code`, `pr`, `deploy`.
- Accessibility: includes instructions for `--yes` usage.
- Responsive: ensures gating steps have one blank line above and below.
- Validation: ensures gating reason references requirement ID.

<!-- anchor: 2-2-2-7-molecule-plan-graph -->
##### 2.2.2.7 Molecule: Plan Graph Summary
- Composition: Diff Stat + Context Table + ASCII dependency graph.
- Variants: `sequential`, `parallel`, `blocked`.
- Accessibility: includes textual graph legend.
- Responsive: adjusts ASCII char set for limited fonts.
- Validation: ensures plan hash included.

<!-- anchor: 2-2-2-8-molecule-agent-prompt -->
##### 2.2.2.8 Molecule: Agent Prompt Capsule
- Composition: Annotation + Inline Code + Context Tag set.
- Variants: `prd`, `spec`, `code`, `summary`.
- Accessibility: includes `Prompt stored at ...` message.
- Responsive: ensures indent 2 spaces for readability.
- Validation: ensures secrets redacted and tokens counted.

<!-- anchor: 2-2-2-9-molecule-log-stream -->
##### 2.2.2.9 Molecule: Log Stream Block
- Composition: Timestamp + Status Badge + Inline Code.
- Variants: `interactive`, `batch`, `silent`.
- Accessibility: includes `Log stream start/end` markers.
- Responsive: collapses to truncated view with `--tail` instructions.
- Validation: ensures log path recorded.

<!-- anchor: 2-2-2-10-molecule-diff-preview -->
##### 2.2.2.10 Molecule: Diff Preview Capsule
- Composition: File Hash Token + Inline Code + Diff Stat Token.
- Variants: `unified`, `split`, `summary`.
- Accessibility: includes instructions to open full diff with `git show`.
- Responsive: collapses to summary lines when diff >50 lines.
- Validation: ensures patch path sanitized.

<!-- anchor: 2-2-3-organisms -->
#### 2.2.3 Organisms
Organisms orchestrate molecules into comprehensive CLI sections.

<!-- anchor: 2-2-3-1-organism-run-overview -->
##### 2.2.3.1 Organism: Run Overview Workspace
- Includes Command Header, Progress Lane, Rate Limit Ledger.
- Shows context summary with repo, feature, branch, runtime health.
- Accessibility: begins with `Run Overview for Feature ...` line.
- Responsive: in compact mode, ledger moves to bottom.
- Data Binding: pulls from `feature.json`, `rate_limits.json`.
- Actions: surfaces `status`, `resume`, `export` instructions.
- Metrics: logs time spent per section for observability.

<!-- anchor: 2-2-3-2-organism-context-workbench -->
##### 2.2.3.2 Organism: Context Workbench
- Aggregates context tables for repo files, tickets, docs.
- Provides summarization toggle for large files.
- Accessibility: describes number of files and summarization level.
- Responsive: groups contexts into tabs for TUI.
- Data Binding: uses `context-manifest.json` hashed list.
- Actions: `open file`, `summarize`, `refresh` commands.
- Observability: logs summarization time and token use.

<!-- anchor: 2-2-3-3-organism-prd-lab -->
##### 2.2.3.3 Organism: PRD Lab
- Contains agent prompt, log stream, diff preview for PRD.
- Supports editing path and gating approvals.
- Accessibility: describes sections, includes references to blueprint FR-9.
- Responsive: ensures editing instructions repeated at end.
- Data Binding: interacts with `prd.md`, `approvals.json`.
- Actions: open external editor, accept, request revisions.
- Observability: logs cost of agent runs.

<!-- anchor: 2-2-3-4-organism-spec-studio -->
##### 2.2.3.4 Organism: Specification Studio
- Similar to PRD lab but includes `unknowns ledger` and `test plan preview`.
- Accessibility: references FR-10, ensures instructions on coverage.
- Responsive: defers long sections into collapsible blocks.
- Data Binding: uses `spec.md`, `plan.json` seeds.
- Actions: accept spec, regenerate sections, annotate risks.
- Observability: metrics for spec iteration count.

<!-- anchor: 2-2-3-5-organism-task-planner -->
##### 2.2.3.5 Organism: Task Planner Console
- Visualizes ExecutionTasks, dependencies, queue states.
- Accessibility: textual adjacency list describing dependencies.
- Responsive: multi-column layout for wide screens, linear list for terminals.
- Data Binding: `plan.json`, `queue.ndjson`.
- Actions: reorder tasks, mark manual completions, rerun.
- Observability: logs per-task durations and retries.

<!-- anchor: 2-2-3-6-organism-execution-monitor -->
##### 2.2.3.6 Organism: Execution Monitor
- Streams logs from commands (lint/test/build) and patch apply operations.
- Accessibility: ensures each command announces start and finish along with exit code.
- Responsive: color-coded statuses degrade to textual icon.
- Data Binding: `logs.ndjson`, `plan.json` references.
- Actions: abort, retry, open log file.
- Observability: collects CPU/memory hints if available.

<!-- anchor: 2-2-3-7-organism-pr-console -->
##### 2.2.3.7 Organism: PR Automation Console
- Summarizes PR metadata, reviewers, branch, diff stats.
- Accessibility: includes textual instructions for GitHub follow-up.
- Responsive: collapses reviewer lists to bullet list for narrow width.
- Data Binding: GitHub adapter responses stored in run directory.
- Actions: create PR, request reviewers, enable auto-merge.
- Observability: track GitHub API consumption per action.

<!-- anchor: 2-2-3-8-organism-deployment-guard -->
##### 2.2.3.8 Organism: Deployment Guard Rail
- Monitors status checks, branch protections, merge readiness.
- Accessibility: enumerates required checks and statuses.
- Responsive: color-coded statuses degrade to `[blocked]` text.
- Data Binding: `deployment.json`, GitHub statuses.
- Actions: enable auto-merge, trigger workflow dispatch, log blocked reasons.
- Observability: records wait durations and backlog counts.

<!-- anchor: 2-2-3-9-organism-export-foundry -->
##### 2.2.3.9 Organism: Export Foundry
- Packages artifacts, calculates checksums, writes manifest.
- Accessibility: includes textual summary of bundle contents.
- Responsive: multi-step progress view for long packaging tasks.
- Data Binding: entire run directory.
- Actions: choose format (md/json), include/exclude sections.
- Observability: logs export duration and size.

<!-- anchor: 2-2-3-10-organism-observability-hub -->
##### 2.2.3.10 Organism: Observability Hub Panel
- Shows metrics, logs, traces summarizing run health.
- Accessibility: describes metric units and severity.
- Responsive: charts convert to textual histograms when necessary.
- Data Binding: `metrics/prometheus.txt`, `logs.ndjson`, `traces.json`.
- Actions: open metrics file, flush logs, tail streaming output.
- Observability: ensures instrumentation health is reported.

<!-- anchor: 2-3-component-hierarchy-diagram -->
### 2.3 Component Hierarchy Diagram (PlantUML)
~~~plantuml
@startuml
skinparam backgroundColor #0b0e14
skinparam defaultFontName "JetBrains Mono"
skinparam defaultFontSize 14
skinparam classBackgroundColor #111827
skinparam classBorderColor #38BDF8
skinparam classAttributeIconColor #22C55E
rectangle "Tokens" as Tokens {
  [ColorPalette]
  [Typography]
  [Spacing]
  [AccessibilityTokens]
}
rectangle "Atoms" as Atoms {
  [CommandLabel]
  [StatusBadge]
  [DividerRule]
  [InlineCode]
  [KeybindingToken]
  [TimestampStamp]
  [LinkChip]
  [ProgressIndicator]
  [DiffStatToken]
  [AlertIcon]
  [ContextTag]
  [ChecklistItem]
  [FieldLabel]
  [AnnotationNote]
  [FileHashToken]
}
rectangle "Molecules" as Molecules {
  [CommandHeader]
  [ProgressLane]
  [ContextTable]
  [ValidationPanel]
  [RateLimitLedger]
  [ApprovalGate]
  [PlanGraph]
  [AgentPrompt]
  [LogStream]
  [DiffPreview]
}
rectangle "Organisms" as Organisms {
  [RunOverview]
  [ContextWorkbench]
  [PRDLab]
  [SpecStudio]
  [TaskPlanner]
  [ExecutionMonitor]
  [PRConsole]
  [DeploymentGuard]
  [ExportFoundry]
  [ObservabilityHub]
}
rectangle "Workspaces" as Workspaces {
  [InitializationWorkspace]
  [ContextWorkspace]
  [ResearchWorkspace]
  [PlanningWorkspace]
  [ExecutionWorkspace]
  [ReviewWorkspace]
  [DeploymentWorkspace]
  [ExportWorkspace]
  [ResumeWorkspace]
  [TelemetryWorkspace]
}
Tokens --> Atoms
Atoms --> Molecules
Molecules --> Organisms
Organisms --> Workspaces
[CommandHeader] --> [RunOverview]
[ProgressLane] --> [RunOverview]
[RateLimitLedger] --> [RunOverview]
[ContextTable] --> [ContextWorkbench]
[AgentPrompt] --> [PRDLab]
[AgentPrompt] --> [SpecStudio]
[PlanGraph] --> [TaskPlanner]
[LogStream] --> [ExecutionMonitor]
[DiffPreview] --> [PRConsole]
[ApprovalGate] --> [DeploymentGuard]
[ExportFoundry] --> [ExportWorkspace]
[ObservabilityHub] --> [TelemetryWorkspace]
[ChecklistItem] --> [ApprovalGate]
[DiffStatToken] --> [DiffPreview]
[CommandLabel] --> [CommandHeader]
[StatusBadge] --> [ValidationPanel]
[AnnotationNote] --> [AgentPrompt]
@enduml
~~~

<!-- anchor: 2-4-interaction-templates -->
### 2.4 Interaction Templates
- Template `context-intake` defines structured prompts for context gathering.
- Template `approval-flow` standardizes gating prompts with statuses, commands, instructions.
- Template `execution-loop` outlines log streaming layout with start/stop markers.
- Template `rate-limit-warning` ensures consistent display with countdown timer.
- Template `resume-summary` presents `last_step`, `last_error`, and next actions.
- Template `pr-snapshot` organizes PR metadata, diff stats, reviewer statuses.
- Template `deploy-guard` shows required checks, auto-merge status, manual actions.
- Template `export-report` lists artifacts, hashes, and instructions for sharing.
- Template `agent-briefing` collects context for AI invocation referencing tokens.
- Template `diagnostic-report` surfaces configuration and environment health.

<!-- anchor: 2-5-state-wrappers -->
### 2.5 Accessibility & State Wrappers
- `LiveRegionWrapper` announces updates for streaming logs.
- `FocusRingWrapper` adds textual focus cues when interactive prompts appear.
- `ErrorExplainer` attaches remediation instructions referencing blueprint requirement numbers.
- `LocalizationWrapper` injects locale-specific strings and fallback logic.
- `TokenizedRenderer` ensures color/text tokens resolved consistently.
- `RedactionWrapper` filters secrets from displayed values.
- `TelemetryWrapper` logs component usage for future analysis.
- `DensityWrapper` toggles layout spacing per user preference.
- `OutputFormatWrapper` differentiates CLI vs markdown vs JSON outputs.
- `ComplianceWrapper` adds trace IDs and anchors to exported documentation.

<!-- anchor: 3-0-application-structure -->
## 3. Application Structure & User Flows
The CLI organizes experiences around commands corresponding to pipeline stages. Each command maps to workspace components and ensures resumability.

<!-- anchor: 3-1-route-definitions -->
### 3.1 Route Definitions
Routes correspond to CLI commands and optional subcommands.

| Route/Command | Description | Primary Components | Access Level | Notes |
| --- | --- | --- | --- | --- |
| `codepipe init` | Initialize repo config and validate integrations | InitializationWorkspace, CommandHeader, ValidationPanel | Maintainer | Requires git repo detection |
| `codepipe start --prompt` | Begin feature run from prompt | RunOverview, PRDLab, ContextWorkbench | Maintainer/Operator | Gating at PRD acceptance |
| `codepipe start --linear` | Start run from Linear issue | ContextWorkbench, ResearchWorkspace | Maintainer | Includes Linear snapshot |
| `codepipe start --spec` | Start from spec file | ContextWorkbench, SpecStudio | Maintainer | Preloads spec.md |
| `codepipe status <id>` | View run state machine | RunOverview, TaskPlanner, ExecutionMonitor | Maintainer/Reviewer | Supports `--json` |
| `codepipe resume <id>` | Resume failed run | ResumeWorkspace, ExecutionWorkspace | Maintainer | Enforces idempotent steps |
| `codepipe plan <id>` | Review/modify plan | TaskPlanner, ContextWorkbench | Maintainer | Exposes DAG editing |
| `codepipe pr create <id>` | Create PR | PRConsole, DeploymentGuard | Maintainer | Requires approvals |
| `codepipe pr reviewers <id>` | Request reviewers | PRConsole | Maintainer | Uses GitHub adapter |
| `codepipe pr disable-auto-merge <id>` | Manage auto-merge | DeploymentGuard | Maintainer | Logs governance notes |
| `codepipe deploy <id>` | Trigger deploy/merge | DeploymentWorkspace | Maintainer | Checks required statuses |
| `codepipe export <id>` | Build artifact bundle | ExportWorkspace | Maintainer/Compliance | Supports md/json |
| `codepipe observe` | Monitor merged PRs | TelemetryWorkspace | Maintainer/Ops | Cron-friendly |
| `codepipe cleanup` | Manage run dirs | TelemetryWorkspace | Maintainer | Provides dry-run |

<!-- anchor: 3-1-1-command-groups -->
#### 3.1.1 Command Grouping Strategy
- Group commands by pipeline stage to align documentation and CLI help.
- Provide `codepipe help` output listing groups: `init`, `start`, `status`, `plan`, `run`, `pr`, `deploy`, `export`, `ops`.
- Provide subcommand help referencing anchors in docs.
- Provide `--json` flag for commands returning structured data.
- Provide `--yes` to skip prompts when automation safe and approvals recorded.
- Provide `--dry-run` to show actions without side effects for audit review.
- Provide `--silent` to reduce logs when piping to other tools.
- Provide `--density` and `--color` toggles for accessibility.
- Provide `--trace` to print trace IDs for logs/troubleshooting.
- Provide `--log-level` to tune verbosity per command.

<!-- anchor: 3-1-2-context-handling -->
#### 3.1.2 Context Handling per Route
- `init` collects repo metadata, ensures config path `.codepipe/config.json` exists.
- `start` commands create new feature directories using ULID/UUIDv7, storing run context.
- `status` fetches `feature.json`, `plan.json`, `logs.ndjson`, `approvals.json` for view.
- `resume` checks `last_step`, `last_error`, ensures dependencies resolved before continuing.
- `plan` loads DAG and allows editing via CLI or external editor.
- `pr` commands require verifying branch existence; surfaces branch creation instructions.
- `deploy` ensures PR merged or auto-merge enabled before triggering workflows.
- `export` references entire run directory, verifying manifest completeness.
- `observe` reads repo config to find monitors, ensures concurrency locks.
- `cleanup` uses `manifest.json` to determine retention policies.

<!-- anchor: 3-1-3-access-control -->
#### 3.1.3 Access Control & Roles
- Maintainers execute most commands; auditors primarily use `status`, `export`.
- Provide `role` metadata in config to restrict commands via wrapper scripts if needed.
- Document recommended GitHub PAT scopes for each command.
- Provide `sudo?` guidelines for operations interacting with system-level watchers (rare).
- Provide `ops` role for `observe`, `cleanup`, `telemetry` commands.
- Provide `agent` pseudo-role for automation hooking into CLI; use `--json` outputs.
- Provide `safe-mode` blocking PR/deploy commands unless `safety.require_human_approval_for_merge` false.
- Provide instructions to integrate with `sudo` wrappers for multi-user systems.
- Provide logging of user or agent id executing each command via environment variable.
- Provide `audit` command (future) referencing same components for compliance.

<!-- anchor: 3-2-critical-user-journeys -->
### 3.2 Critical User Journeys (PlantUML)
~~~plantuml
@startuml
skinparam backgroundColor #0b0e14
skinparam defaultFontName "JetBrains Mono"
skinparam activityBackgroundColor #111827
skinparam activityBorderColor #3B82F6
skinparam activityArrowColor #F8FAFD
skinparam noteBackgroundColor #0F172A
skinparam noteBorderColor #38BDF8
start
:User runs `codepipe start --prompt`;
:CLI displays Command Header & Context Intake;
if (RepoConfig valid?) then (yes)
  :Context Gathering w/ summaries;
  :PRD Draft using Agent Adapter;
  :User reviews PRD Gate;
  if (PRD approved?) then (approved)
    :Spec Draft & Research tasks;
    if (Spec approved?) then (approved)
      :Plan generation & ExecutionTask graph;
      :Execution Engine runs validations;
      if (Validation pass?) then (pass)
        :PR Console prepares PR metadata;
        :User approves PR creation gate;
        :GitHub Adapter creates PR & requests reviewers;
        :Deployment Guard monitors checks;
        if (Checks pass?) then (pass)
          :User triggers deploy/merge;
          :Export Foundry bundles artifacts;
          :Run marked deployed;
        else (blocked)
          :CLI surfaces blocked reasons and wait strategy;
        endif
      else (fail)
        :CLI records failure, logs path, and awaits resume;
      endif
    else (revise)
      :Spec Studio opens editing instructions;
    endif
  else (revise)
    :PRD Lab loops until acceptance;
  endif
else (invalid)
  :CLI instructs to rerun init and fix config;
endif
stop
@enduml
~~~

<!-- anchor: 3-2-1-journey-summaries -->
#### 3.2.1 Journey Summaries
- **Prompt-to-PR** flow described above ensures deterministic gating.
- **Linear-to-Resume** flow mirrors start but adds ticket snapshot steps.
- **Spec-ingest** flow begins at spec acceptance, generating missing PRD fields automatically.
- Each flow includes error forks for API rate limiting, gating rejections, and validation failures.
- CLI always records `last_step` and `last_error` for resume capability.
- Observability instrumentation records durations for each stage for later tuning.
- Approvals recorded with signatures and hashed artifacts for audit.
- CLI ensures human decision points have explicit instructions referencing docs.
- Export bundle produced regardless of gating stage when `--include-incomplete` provided.
- CLI caches results to avoid re-fetching unchanged contexts between loops.

<!-- anchor: 3-2-2-flow-variants -->
#### 3.2.2 Flow Variants
- **Rate Limit Degradation**: when hitting GitHub or Linear limits, CLI switches to read-only mode, logs wait, stores `retry-after` data.
- **Offline Continuation**: if network offline, CLI instructs operator to continue with local tasks, storing stub entries for missing data.
- **Manual Research**: operator can insert manual research results; CLI records origin metadata.
- **Agent Swap**: CLI can switch to alternate agent provider mid-run, logging capability manifest.
- **Auto-Merge**: when enabled and approvals recorded, CLI toggles auto-merge and updates DeploymentRecord.
- **Deploy-only**: when code already merged, CLI allows `deploy` command to run status checks and documentation updates only.
- **Plan-only**: for pre-planning, CLI runs up to plan stage without code execution.
- **Spec Review Loop**: operator can request spec revisions, generating new tasks and storing change log entries.
- **Export-only**: CLI can package existing runs for auditors without continuing pipeline.
- **Cleanup Flow**: `cleanup` command runs independent flow verifying retention policies.

<!-- anchor: 3-3-user-flow-details -->
### 3.3 Additional User Flow Details
- Provide textual walkthrough for each command referencing components and tokens.
- Document fallback instructions when editing with `$EDITOR` is not available.
- Provide microcopy for confirming destructive operations (e.g., deleting run directories) requiring double confirmation.
- Provide user flow for `observe` command showing lock acquisition and release steps.
- Provide user flow for `resume` command showing detection of stale approvals.
- Provide user flow for `plan` editing, including concurrency warnings.
- Provide user flow for `export` command when run is incomplete, clarifying missing artifacts.
- Provide user flow for `deploy` command when branch protection fails, detailing manual remediation.
- Provide user flow for `start` command receiving spec file containing unsupported schema, showing validation error path.
- Provide user flow for `start` command hitting missing tokens, describing security message.

<!-- anchor: 3-4-failure-modes -->
### 3.4 Failure & Recovery Patterns
- For transient errors, CLI retries with exponential backoff and logs attempt counts.
- For permanent errors, CLI outputs `[error]` block referencing documentation anchor.
- For human-action errors, CLI prints `[blocked]` along with task instructions and file references.
- Resume flow ensures no repeated writes; uses file locks and step hashing.
- CLI stores `failure.json` summarizing cause, stack trace, and recommended command.
- Provide `codepipe diagnose <id>` (future) referencing same architecture to gather logs.
- Provide `--force` guard rails require documented justification stored in `governance_notes`.
- Provide `safe abort` instructions ensuring partial artifacts remain intact.
- Provide `ratelimit fallback` script to pause and resume automatically after wait.
- Provide `lock detection` to avoid concurrent runs on same feature.

<!-- anchor: 3-5-user-education -->
### 3.5 User Education & Onboarding Flow
- Provide onboarding script `codepipe tour` showing sample command outputs referencing components.
- Provide `docs/onboarding.md` linking to design system tokens.
- Provide tutorial run with sample repo to illustrate full pipeline.
- Provide CLI hints referencing `foundation` for design decisions.
- Provide `glossary` command summarizing blueprint terms.
- Provide interactive `--explain` flag to show rationale for each gating step.
- Provide `video/gif` captures referencing CLI transcripts for asynchronous training.
- Provide `FAQ` section referencing failure patterns and tips.
- Provide `cheat sheet` for command flags and statuses.
- Provide `release notes` describing UI/UX changes per CLI version.

<!-- anchor: 4-0-cross-cutting-concerns -->
## 4. Cross-Cutting Concerns
Cross-cutting disciplines ensure the CLI remains coherent as features grow.

<!-- anchor: 4-1-state-management -->
### 4.1 State Management
- Approach: central store using lightweight event-sourced pattern with JSON files.
- CLI loads run state via `RunStateService`, caching data while command executes.
- Server state vs client state: CLI `status` commands treat remote API data as server state; run directory data is client state.
- Provide per-command state slices: `config`, `feature`, `plan`, `queue`, `approvals`, `telemetry`.
- Update flow: actions create new files or append to `logs.ndjson`; watchers update metrics file.
- Concurrency: file locks prevent multiple commands from mutating same run concurrently.
- Derived data: CLI calculates derived statuses (e.g., `percentage complete`) upon render.
- Hydration: `resume` rehydrates state from disk, verifying hashes to ensure determinism.
- State diff: `status --json` includes `changeSince` metadata for automation.
- Testing: unit tests stub RunStateService with fixtures to ensure deterministic outputs.

<!-- anchor: 4-2-responsive-design -->
### 4.2 Responsive Design (Mobile-First for Terminals)
- Breakpoints defined by terminal width: `<80`, `80-120`, `>120` characters.
- `mobile` (<80) collapses tables to stacked label-value pairs.
- `tablet` (80-120) uses two-column layout and limited indentation.
- `desktop` (>120) uses multi-column sections with context cards side-by-side.
- Provide detection routine to measure terminal width and a `--width` override for automation.
- Provide sample outputs for each breakpoint in docs.
- Ensure `--json` unaffected by visual layouts.
- For markdown exports, use CSS media queries to mimic breakpoints when viewed online.
- Provide `ascii charts` that degrade to textual bullet lists when width limited.
- Provide `diagram scaling` instructions referencing PlantUML `scale` parameter.

<!-- anchor: 4-3-accessibility -->
### 4.3 Accessibility (WCAG 2.1 AA)
- Semantic text: each CLI section begins with textual heading describing content.
- Keyboard-only interaction: CLI prompts always respond to Enter/Escape; no hidden interactions.
- Screen reader support: textual markers `Section Start/End` and `List Start/End` spelled out.
- Color contrast: tokens guarantee >4.5:1 contrast on both dark/light backgrounds.
- Focus management: CLI indicates when editing external files and how to return.
- Alt text: documentation includes alt text for diagrams and sample outputs.
- Error descriptions: errors include action, context, and remediation with plain language.
- Skip patterns: `--json` and `--silent` for screen readers wanting structured data.
- Input timeouts: CLI waits indefinitely for user input unless `--timeout` set; warnings emitted before aborting.
- Testing: incorporate accessibility lint script verifying sample outputs for contrast and language.

<!-- anchor: 4-4-performance -->
### 4.4 Performance & Optimization
- Targets: CLI cold start < 500ms, context gather < 30s for small repos, < 2m for medium.
- Bundles: aim for CLI help text < 200KB, lazy-load heavy modules (agent, GitHub clients).
- Strategies: use streaming output, incremental updates, `undici` for HTTP, caching context results.
- Code splitting: rely on dynamic imports for adapters triggered by capability flags.
- Memoization: store summarization results hashed by file path + commit SHA.
- Pagination: chunk context tables into manageable sets with `--page` flag.
- CLI caching: store config validation results for 15 minutes.
- Logging: default to info-level; debug-level triggered by `CODEPIPE_DEBUG=1` to reduce noise.
- Observability: track execution durations for each stage to detect regressions.
- Performance testing: include `vitest` suites measuring render functions and plan generation.

<!-- anchor: 4-5-backend-integration -->
### 4.5 Backend Integration Patterns
- HTTP client centralization ensures consistent headers, rate limit handling, telemetry.
- Authentication: CLI loads tokens from env, warns when missing scopes.
- Error handling: map HTTP statuses to CLI messages referencing documentation anchors.
- Retry logic: use exponential backoff with jitter; log attempts and abide by rate-limit headers.
- Data caching: store API responses relevant to run to reduce repeated calls.
- Secrets: redaction applied before writing to disk and before rendering CLI output.
- Git operations: CLI uses `simple-git` or native commands, ensuring branch creation without force pushes.
- Linear integration: uses `@linear/sdk` when available; fallback GraphQL queries described.
- Agent integration: capability manifests define tokens to send, ensuring consistent prompts.
- Observability: HTTP client logs request/response metadata (without secrets) to `logs.ndjson`.

<!-- anchor: 4-6-security -->
### 4.6 Security & Privacy Safeguards
- Secrets environment detection ensures CLI refuses to run operations needing tokens when absent.
- Redaction pipeline replaces tokens with `***REDACTED***` before display.
- Audit logs record user identities per command invocation via `CODEPIPE_ACTOR` env var.
- Branch protection awareness ensures CLI does not merge until checks satisfied.
- File access control ensures CLI respects `constraints.must_not_touch_paths`.
- Run directory permission guidance ensures directories default to `700` on POSIX.
- Telemetry scrubbing ensures exported bundles exclude secrets by default.
- Provide `security.md` describing token scopes per integration per blueprint directive.
- Provide `incident response` section describing how to handle leaked tokens in logs.
- Provide `governance notes` file capturing escalations or overrides.

<!-- anchor: 4-7-observability -->
### 4.7 Observability & Diagnostics
- Logging: JSON lines with timestamp, level, component, message, context.
- Metrics: Prometheus text file capturing latency, queue depth, retry counts, token usage.
- Tracing: file-based OpenTelemetry traces linking CLI operations to API calls.
- Dashboards: optional template for homelab Prometheus + Grafana mapping CLI metrics.
- Alerts: CLI prints warnings when retries exceed thresholds, referencing docs.
- Diagnostics command: `codepipe observe` tail logs and summarises anomalies.
- Rate-limit ledger: CLI updates `rate_limits.json` after each API call.
- Replay: `logs.ndjson` includes event IDs enabling deterministic replay of flows.
- Diagnostics bundler: `codepipe export` can include optional `diagnostics/` folder.
- Telemetry privacy: data stays local-first; CLI warns when optional remote sink configured.

<!-- anchor: 4-8-content-strategy -->
### 4.8 Content Strategy & Traceability
- Each CLI block references requirement IDs when relevant.
- Run directories include `trace.json` linking PRD goals → spec requirements → tasks.
- Content traces stored with anchors to blueprint sections for cross-team alignment.
- CLI outputs include `Trace ID` lines referencing logs/traces.
- Export bundle includes `manifest.json` enumerating files + hashes for audit.
- CLI ensures prompts include `seed` values for deterministic agent behavior.
- Content diffs versioned using `git` within run directory for editing.
- Provide style guides for PRD, spec, plan, and log content.
- Provide `glossary` to maintain consistent vocabulary across outputs.
- Provide `trace-validate` script verifying references before finalizing run.

<!-- anchor: 5-0-tooling-dependencies -->
## 5. Tooling & Dependencies
Tooling ensures consistent developer experience and CLI reliability.

<!-- anchor: 5-1-core-dependencies -->
### 5.1 Core Dependencies
- Framework: `oclif` for CLI scaffolding, plugin support, testing.
- Language: TypeScript with `ts-node` for development convenience.
- HTTP: `undici` for adapters, ensuring `Accept` and `X-GitHub-Api-Version` headers enforced.
- Config validation: `zod` for schema enforcement on `.codepipe/config.json`.
- File system helpers: `fs-extra` for run directory creation and locking.
- Git integration: `simple-git` or native CLI wrapper for branch, patch, diff operations.
- Logging: custom JSON logger plus `pino` for structured piping.
- Prompting: `enquirer` or `prompts` for interactive gating, with fallbacks for non-TTY.
- Telemetry: `@opentelemetry/sdk-trace-node` with file exporter.
- PlantUML: CLI uses local jar or API for diagram generation as part of docs.

<!-- anchor: 5-2-development-tooling -->
### 5.2 Development Tooling
- Testing: `vitest` with coverage output to `.artifacts/tests`.
- Linting: `eslint` with `@typescript-eslint` configs enforcing strict typing.
- Formatting: `prettier` to maintain consistent markdown, JSON, TS formatting.
- Mocking: `msw` or `nock` for adapter contract tests.
- Docs: `typedoc` for generating API documentation referencing UI components.
- Bundling: `tsup` or `esbuild` for packaging CLI with tree-shaking.
- Release automation: `changesets` for versioning aligning with blueprint revisions.
- CI: GitHub Actions running lint/test/build plus CLI smoke tests with sample repo.
- Docker: Node v24 base image for reproducible environment, ensures CLI commands documented work.
- Monitoring: optional integration with `promtail` to ship logs from run directories if operator opts in.
