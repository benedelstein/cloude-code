import CoreAPI
import SwiftUI

struct ProviderIconView: View {
    let providerId: ProviderId

    var body: some View {
        providerImage
            .aspectRatio(contentMode: .fit)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var providerImage: some View {
        switch providerId {
        case .claudeCode:
            Image("ProviderAnthropic")
                .resizable()
                .renderingMode(.original)
        case .openaiCodex:
            Image("ProviderOpenai")
                .resizable()
                .renderingMode(.template)
        case .unknown:
            // swiftlint:disable:next todo
            // TODO: replace unknown-provider fallback when provider assets are available.
            Image(systemName: "cpu")
                .resizable()
        }
    }
}
