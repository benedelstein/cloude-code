# ios-session-composer-pickers Specification

## ADDED Requirements

### Requirement: Repo/branch picker bar
In draft mode the composer SHALL show a compact, intrinsic-width repo/branch picker pill above the main composer rect. The repository segment SHALL render first and display the selected repo's full name or "Repository" when none is selected. Once a repository is selected, the control SHALL append a base-branch segment. The control SHALL NOT render once the session is created.

#### Scenario: Bar renders above the composer in draft mode
- **WHEN** the draft screen is visible
- **THEN** the compact repo/branch pill appears above the composer input

#### Scenario: Base branch follows repository selection
- **WHEN** the user has selected a repository
- **THEN** the compact control shows the repository segment followed by the selected base branch segment

#### Scenario: Bar absent for existing sessions
- **WHEN** the screen shows an existing (or just-created) session
- **THEN** no repo/branch bar renders

### Requirement: Repository picker sheet
Tapping the repository segment SHALL open a half sheet (medium detent, expandable to full height) listing the user's repos with a search field (server-backed search; the unfiltered list when the query is empty). Selecting a repository SHALL update the repository segment, reset the base branch to the repository default, persist the repository selection, and dismiss the sheet.

#### Scenario: Search narrows the repo list
- **WHEN** the user types in the sheet's search field
- **THEN** the list updates to matching repos via the repos search endpoint

#### Scenario: Selecting a repository reveals the base branch control
- **WHEN** the user selects a repo
- **THEN** the compact control appends a base branch segment showing the repo's default branch

#### Scenario: Selected repository is marked
- **WHEN** the repository picker lists the currently selected repository
- **THEN** that repository row displays a checkmark

#### Scenario: Sheet expands to full height
- **WHEN** the user drags the sheet upward
- **THEN** it expands to the large detent

### Requirement: Base branch picker sheet
Tapping the base branch segment SHALL open a half sheet (medium detent, expandable to full height) listing branches for the selected repository with its default branch selected. Selecting a branch SHALL update the segment and dismiss the sheet.

#### Scenario: Default branch preselected
- **WHEN** the user opens the base branch sheet after selecting a repository
- **THEN** the repository's default branch is checked and rendered as the stable first row before all loaded branches

### Requirement: Picker loading presentation
Initial repository and model catalog loads SHALL render non-interactive redacted rows in the list. Initial branch loading SHALL render the selected repository's known default branch as a normal row, followed by non-interactive redacted rows. While a repository search refines an existing result set, the picker SHALL retain the existing rows and append one non-interactive redacted repository row. The picker SHALL NOT render a standalone progress row.

#### Scenario: Repository search retains previous results while loading
- **WHEN** the user enters a repository search query
- **THEN** the list retains the current repository rows and appends a redacted repository row until the matching results arrive

#### Scenario: Initial picker load shows skeleton rows
- **WHEN** a picker requires its initial network data
- **THEN** it renders redacted rows until that data is available

#### Scenario: Known default branch remains available during branch loading
- **WHEN** the base branch picker is loading branches for a selected repository
- **THEN** the repository's default branch renders as the first normal row before the redacted branch rows

### Requirement: Model/provider picker button
In draft mode the composer SHALL show a model picker button immediately to the left of the send button, displaying the selected model as a provider icon plus display name (e.g. "Opus 4.8"), or "Select model" when none is selected.

#### Scenario: Last model shown on entry
- **WHEN** the draft screen appears and a previously selected model is persisted and still valid
- **THEN** the button shows that provider icon and model name immediately, without waiting for the catalog fetch

#### Scenario: No selection fallback
- **WHEN** no model is selected and no valid persisted selection exists
- **THEN** the button reads "Select model"

### Requirement: Model picker sheet
Tapping the model button SHALL open a half sheet (medium detent, no search) listing providers and their models from `GET /models`. Providers that are not connected (or require reauth) SHALL be rendered disabled with their models unselectable; there SHALL be no in-sheet connect flow. Selecting a model SHALL update the button, persist the selection, and dismiss the sheet. Effort-level selection is out of scope (TODO).

#### Scenario: Disconnected provider disabled
- **WHEN** the sheet lists a provider whose status is not connected
- **THEN** the provider section and its models render disabled and cannot be selected

#### Scenario: Selection persists and dismisses
- **WHEN** the user taps a selectable model
- **THEN** the sheet dismisses, the button shows the new model, and the choice is persisted for future drafts

### Requirement: Last-selection persistence and validation
The app SHALL persist the last selected model (provider id, model id, display name) and last selected repo (id, full name, default branch) in UserDefaults, and validate them when the draft screen loads: a persisted model is used only if its provider is connected without requiring reauth and the model is selectable in the catalog — otherwise the first connected provider's default model is used, or no selection if no provider is connected. A persisted repo is used only if present in the loaded repo list. The branch SHALL reset to the repo's default branch whenever the repo changes.

#### Scenario: Stale model falls back to a connected default
- **WHEN** the persisted model's provider is disconnected at load time
- **THEN** the selection falls back to the first connected provider's default model (or "Select model" if none is connected)

#### Scenario: No model selected still sends
- **WHEN** the user sends with no model selected
- **THEN** the create request omits `settings` and the server applies its defaults

#### Scenario: Repo change resets branch
- **WHEN** the user switches the selected repo
- **THEN** the branch selection resets to the new repo's default branch
