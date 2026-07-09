# ios-session-composer-pickers Specification

## ADDED Requirements

### Requirement: Repo/branch picker bar
In draft mode the composer SHALL show a repo/branch picker bar rendered above the main composer rect in its own glass container, displaying the selected repo's full name and branch, or a "Select repository" prompt when none is selected. The bar SHALL NOT render once the session is created.

#### Scenario: Bar renders above the composer in draft mode
- **WHEN** the draft screen is visible
- **THEN** the repo/branch bar appears as a separate glass rect above the composer input

#### Scenario: Bar absent for existing sessions
- **WHEN** the screen shows an existing (or just-created) session
- **THEN** no repo/branch bar renders

### Requirement: Repo/branch picker sheet
Tapping the repo/branch bar SHALL open a half sheet (medium detent, expandable to full height) listing the user's repos with a search field (server-backed search; the unfiltered list when the query is empty). Selecting a repo SHALL present its branches with the repo's default branch preselected; confirming SHALL update the bar and persist the selection.

#### Scenario: Search narrows the repo list
- **WHEN** the user types in the sheet's search field
- **THEN** the list updates to matching repos via the repos search endpoint

#### Scenario: Default branch preselected
- **WHEN** the user selects a repo
- **THEN** the branch list shows with the repo's default branch checked

#### Scenario: Sheet expands to full height
- **WHEN** the user drags the sheet upward
- **THEN** it expands to the large detent

### Requirement: Model/provider picker button
In draft mode the composer SHALL show a model picker button to the right of the send button, displaying the selected model as a provider icon plus display name (e.g. "Opus 4.8"), or "Select model" when none is selected.

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
