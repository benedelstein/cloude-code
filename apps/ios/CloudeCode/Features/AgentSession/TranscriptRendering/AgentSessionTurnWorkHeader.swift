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
                    .font(.body(9))
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
            TimelineView(.periodic(from: startedAt, by: 1)) { context in
                Text("Working for \(Self.durationString(from: startedAt, to: context.date))")
            }
        } else {
            Text(isStreaming ? "Working" : "Worked")
        }
    }

    private static func durationString(from startDate: Date, to endDate: Date) -> String {
        let totalSeconds = max(0, Int(endDate.timeIntervalSince(startDate)))
        return durationFormatter.string(from: TimeInterval(totalSeconds)) ?? "\(totalSeconds)s"
    }

    nonisolated(unsafe) private static let durationFormatter: DateComponentsFormatter = {
        let formatter = DateComponentsFormatter()
        formatter.allowedUnits = [.hour, .minute, .second]
        formatter.unitsStyle = .abbreviated
        formatter.maximumUnitCount = 2
        formatter.zeroFormattingBehavior = .dropAll
        return formatter
    }()
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
