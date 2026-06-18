//
//  UserMessageView.swift
//  CloudeCode
//
//  Created by Ben Edelstein on 6/14/26.
//
import SwiftUI
import Domain

struct UserMessageView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let message: SessionMessage

    var images: [URL] {
        // todo Image parts are not decoded yet.
        []
    }

    var body: some View {
        HStack(alignment: .top) {
            Spacer(minLength: style.gridSize * 5)
            VStack(alignment: .trailing) {
                imageViews
                Text(verbatim: message.text)
                    .styledFont(.subheadline)
                    .foregroundStyle(theme.labelColor)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(userMessageShape.fill(theme.secondaryBackgroundColor))
            }
        }
    }

    @ViewBuilder
    var imageViews: some View {
        ForEach(images, id: \.self) {
            AsyncImage(url: $0)
                .aspectRatio(contentMode: .fit)
                .frame(maxWidth: 100)
        }
    }

    private var userMessageShape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 12, style: .continuous)
    }
}
