import CoreAPI
import SwiftUI

struct ProviderIconView: View {
    let providerId: ProviderId

    var body: some View {
        providerImage
            .resizable()
            .renderingMode(.template)
            .aspectRatio(contentMode: .fit)
            .accessibilityHidden(true)
    }

    private var providerImage: Image {
        switch providerId {
        case .claudeCode:
            Image("ProviderAnthropic")
        case .openaiCodex:
            Image("ProviderOpenai")
        case .unknown:
            // swiftlint:disable:next todo
            // TODO: replace unknown-provider fallback when provider assets are available.
            Image(systemName: "cpu")
        }
    }
}
