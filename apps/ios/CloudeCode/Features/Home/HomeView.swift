import SwiftUI

struct HomeView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    @State private var viewModel: HomeViewModel

    init(viewModel: HomeViewModel) {
        _viewModel = State(initialValue: viewModel)
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: style.spacing) {
                Text(viewModel.greeting)
                    .styledFont(.title2)

                if viewModel.isLoading {
                    ProgressView()
                }

                if let errorMessage = viewModel.errorMessage {
                    Text(errorMessage)
                        .styledFont(.subheadline)
                        .foregroundStyle(theme.errorRed)
                }

                Button("Reload") {
                    viewModel.loadGreeting()
                }
                .buttonStyle(.borderedProminent)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding()
            .navigationTitle("Cloude Code")
            .task {
                viewModel.loadGreeting()
            }
        }
    }
}
