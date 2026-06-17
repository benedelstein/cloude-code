import Domain
import SwiftUI

struct TurnWorkHeaderView: View {
    @Environment(\.theme) private var theme
    @Environment(\.style) private var style

    let expanded: Bool
    let startedAt: Date?
    let endedAt: Date?
    let isStreaming: Bool
    let collapsible: Bool
    let onToggle: () -> Void

    var body: some View {
        if collapsible {
            Button(action: onToggle) {
                content
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isButton)
        } else {
            content
                .accessibilityAddTraits(.updatesFrequently)
        }
    }

    private var content: some View {
        HStack(spacing: style.gridSize) {
            label
                .styledFont(.caption)
                .foregroundStyle(theme.secondaryLabelColor)

            if collapsible {
                Image(systemName: "chevron.right")
                    .font(style.caption2Font)
                    .foregroundStyle(theme.tertiaryLabelColor)
                    .rotationEffect(.degrees(expanded ? 90 : 0))
            }
        }
        .contentShape(Rectangle())
    }

    @ViewBuilder
    private var label: some View {
        if let startedAt, let endedAt {
            Text("Worked for \(Self.durationString(from: startedAt, to: endedAt))")
        } else if let startedAt, isStreaming {
            Text("Working for \(startedAt, style: .timer)")
        } else {
            Text(isStreaming ? "Working" : "Worked")
        }
    }

    private static func durationString(from startDate: Date, to endDate: Date) -> String {
        let totalSeconds = max(0, Int(endDate.timeIntervalSince(startDate)))
        if totalSeconds < 60 {
            return "\(totalSeconds)s"
        }

        let totalMinutes = totalSeconds / 60
        if totalMinutes < 60 {
            return "\(totalMinutes)m \(totalSeconds % 60)s"
        }

        return "\(totalMinutes / 60)h \(totalMinutes % 60)m"
    }
}

extension SessionMessage {
    var workStartedAt: Date? {
        metadataDateValue(forKey: "startedAt")
    }

    var workEndedAt: Date? {
        metadataDateValue(forKey: "endedAt")
    }

    private func metadataDateValue(forKey key: String) -> Date? {
        guard case .object(let object) = metadata, let value = object[key] else {
            return nil
        }
        return value.dateValue
    }
}

private extension JSONValue {
    var dateValue: Date? {
        switch self {
        case .number(let milliseconds):
            Date(timeIntervalSince1970: milliseconds / 1_000)
        case .string(let string):
            Self.isoDate(from: string)
        case .bool, .object, .array, .null:
            nil
        }
    }

    private static func isoDate(from string: String) -> Date? {
        standardISOFormatter.date(from: string) ?? fractionalISOFormatter.date(from: string)
    }

    nonisolated(unsafe) private static let standardISOFormatter = ISO8601DateFormatter()

    nonisolated(unsafe) private static let fractionalISOFormatter: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}
