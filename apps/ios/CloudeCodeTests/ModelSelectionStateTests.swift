import API
import CoreAPI
import Domain
import Entities
import Foundation
import Testing
@testable import CloudeCode

@MainActor
struct ModelSelectionStateTests {
    @Test func existingSessionReadinessUsesClientStateWithoutCatalog() {
        let modelPicker = ModelPickerState(modelsAPI: FailingModelsAPI())
        let viewModel = makeViewModel(
            context: .session(makeSession()),
            modelPicker: modelPicker
        )

        #expect(viewModel.isModelSelectionLoading)
        #expect(viewModel.modelSelection == nil)

        var state = SessionClientState.empty
        state.agentSettings = SessionClientState.AgentSettings(
            provider: .openaiCodex,
            model: "gpt-5.5",
            effort: "high",
            maxTokens: 4_096
        )
        viewModel.applyLiveState(state)

        #expect(!viewModel.isModelSelectionLoading)
        #expect(viewModel.modelSelection?.modelId == "gpt-5.5")
        #expect(viewModel.modelSelection?.displayName == "gpt-5.5")
        #expect(viewModel.modelSelection?.effortDisplayName == "high")
    }

    @Test func draftDisplaysCachedSelectionBeforeCatalogValidation() throws {
        let provider = makeProvider()
        let (preferences, cleanup) = try makePreferences()
        defer { cleanup() }
        preferences.persistModel(
            provider: provider,
            model: provider.models[0],
            effort: provider.efforts[0]
        )
        let modelPicker = ModelPickerState(modelsAPI: FailingModelsAPI())
        let draft = makeDraft(modelPicker: modelPicker, preferences: preferences)
        let viewModel = makeViewModel(context: .draft(draft), modelPicker: modelPicker)

        #expect(viewModel.modelSelection?.displayName == "GPT-5.5")
        #expect(!viewModel.isModelSelectionLoading)
        #expect(!draft.isModelSelectionReady)
    }

    @Test func draftWithoutCachedSelectionLoadsUntilCatalogSelectsDefault() async throws {
        let provider = makeProvider()
        let (preferences, cleanup) = try makePreferences()
        defer { cleanup() }
        let modelPicker = ModelPickerState(
            modelsAPI: ModelsAPIStub(response: ModelsResponse(providers: [provider]))
        )
        let draft = makeDraft(modelPicker: modelPicker, preferences: preferences)
        let viewModel = makeViewModel(context: .draft(draft), modelPicker: modelPicker)

        #expect(viewModel.isModelSelectionLoading)

        await draft.load()

        #expect(!viewModel.isModelSelectionLoading)
        #expect(draft.isModelSelectionReady)
        #expect(viewModel.modelSelection?.modelId == "gpt-5.5")
    }
}

private extension ModelSelectionStateTests {
    struct ModelsAPIStub: ModelsAPIProviding {
        let response: ModelsResponse

        func models() async throws -> ModelsResponse {
            response
        }
    }

    struct FailingModelsAPI: ModelsAPIProviding {
        func models() async throws -> ModelsResponse {
            throw URLError(.badServerResponse)
        }
    }

    struct ReposAPIStub: ReposAPIProviding {
        func listRepos(limit: Int?, cursor: String?) async throws -> ListReposResponse {
            ListReposResponse(repos: [], installUrl: "")
        }

        func searchRepos(query: String, limit: Int?) async throws -> SearchReposResponse {
            SearchReposResponse(repos: [])
        }

        func branches(repoId: Int, limit: Int?, cursor: String?) async throws -> ListBranchesResponse {
            ListBranchesResponse(branches: [])
        }
    }

    struct SessionsAPIStub: SessionsAPIProviding {
        func listSessions(
            repoId: Int?,
            repoCursor: String?,
            sessionCursor: String?,
            repoLimit: Int?,
            sessionLimit: Int?
        ) async throws -> SessionSummaryPage {
            throw URLError(.unsupportedURL)
        }

        func createSession(_ request: CreateSessionRequest) async throws -> CreateSessionResponse {
            throw URLError(.unsupportedURL)
        }

        func session(id: String) async throws -> SessionInfoResponse {
            throw URLError(.unsupportedURL)
        }

        func messages(sessionId: String) async throws -> [SessionMessage] {
            throw URLError(.unsupportedURL)
        }

        func plan(sessionId: String) async throws -> SessionPlanResponse {
            throw URLError(.unsupportedURL)
        }

        func updateTitle(sessionId: String, title: String) async throws -> UpdateSessionTitleResponse {
            throw URLError(.unsupportedURL)
        }

        func createPullRequest(sessionId: String) async throws -> PullRequestResponse {
            throw URLError(.unsupportedURL)
        }

        func pullRequest(sessionId: String) async throws -> PullRequestStatusResponse {
            throw URLError(.unsupportedURL)
        }

        func archive(sessionId: String) async throws {
            throw URLError(.unsupportedURL)
        }

        func delete(sessionId: String) async throws {
            throw URLError(.unsupportedURL)
        }

        func sessionWebSocketToken(sessionId: String) async throws -> WebSocketToken {
            throw URLError(.unsupportedURL)
        }

        func userSessionsWebSocketToken() async throws -> WebSocketToken {
            throw URLError(.unsupportedURL)
        }
    }

    struct AttachmentsAPIStub: AttachmentsAPIProviding {
        func uploadImages(
            _ files: [AttachmentUploadFile],
            sessionId: String?
        ) async throws -> [UploadedAttachment] {
            []
        }

        func deleteAttachment(id attachmentId: String) async throws {}
    }

    struct TranscriptBuilderStub: AgentSessionTranscriptBuilding {
        func build(
            message: SessionMessage,
            providerId: AgentProviderID?
        ) -> [AgentSessionRenderItem] {
            []
        }

        func finalResponseStartIndex(renderItems: [AgentSessionRenderItem]) -> Int? {
            nil
        }
    }

    func makeViewModel(
        context: AgentSessionViewModel.Context,
        modelPicker: ModelPickerState
    ) -> AgentSessionViewModel {
        AgentSessionViewModel(
            context: context,
            modelPicker: modelPicker,
            makeSocket: { sessionId in
                SessionSocket(
                    baseURL: URL(fileURLWithPath: "/dev/null"),
                    sessionId: sessionId,
                    tokenCache: WebSocketTokenCache {
                        throw URLError(.userAuthenticationRequired)
                    }
                )
            },
            sessionMessageStore: SessionMessageStore(),
            sessionSummaryStore: SessionSummaryStore(),
            transcriptBuilder: TranscriptBuilderStub(),
            attachmentsAPI: AttachmentsAPIStub()
        )
    }

    func makeDraft(
        modelPicker: ModelPickerState,
        preferences: NewSessionPreferences
    ) -> NewSessionDraft {
        NewSessionDraft(
            sessionsAPI: SessionsAPIStub(),
            reposAPI: ReposAPIStub(),
            modelPicker: modelPicker,
            preferences: preferences
        )
    }

    func makeSession() -> SessionSummaryModel {
        SessionSummaryModel(SessionSummary(
            id: "session-1",
            repoId: 1,
            repoFullName: "octo/repo",
            archived: false,
            workingState: "idle",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            hasUnread: false
        ))
    }

    func makeProvider() -> ProviderCatalogEntry {
        ProviderCatalogEntry(
            providerId: .openaiCodex,
            providerName: "OpenAI Codex",
            connected: true,
            requiresReauth: false,
            defaultModel: "gpt-5.5",
            defaultEffort: "high",
            authMethods: [],
            models: [
                ProviderCatalogModel(
                    id: "gpt-5.5",
                    displayName: "GPT-5.5",
                    isDefault: true,
                    selectable: true
                )
            ],
            efforts: [
                ProviderCatalogEffort(
                    id: "high",
                    displayName: "High",
                    isDefault: true,
                    selectable: true
                )
            ]
        )
    }

    func makePreferences() throws -> (NewSessionPreferences, () -> Void) {
        let suiteName = "ModelSelectionStateTests-\(UUID().uuidString)"
        let userDefaults = try #require(UserDefaults(suiteName: suiteName))
        return (
            NewSessionPreferences(userDefaults: userDefaults),
            { userDefaults.removePersistentDomain(forName: suiteName) }
        )
    }
}
