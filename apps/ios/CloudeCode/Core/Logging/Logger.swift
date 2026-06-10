import Foundation

enum LogLevel: String, CaseIterable {
    case debug = "DEBUG"
    case info = "INFO"
    case warning = "WARNING"
    case error = "ERROR"

    var severity: Int {
        switch self {
        case .debug:
            0
        case .info:
            1
        case .warning:
            2
        case .error:
            3
        }
    }
}

protocol LogDestination {
    func log(_ entry: LogEntry)
}

struct LogEntry {
    let message: String
    let level: LogLevel
    let file: String
    let function: String
    let line: Int
    let terminator: String
}

private struct LogContext {
    let level: LogLevel
    let separator: String
    let terminator: String
    let file: String
    let function: String
    let line: Int
}

final class ConsoleLogDestination: LogDestination {
    func log(_ entry: LogEntry) {
        let fileName = URL(fileURLWithPath: entry.file).deletingPathExtension().lastPathComponent
        Swift.print(
            "[\(entry.level.rawValue)] \(fileName).\(entry.function):\(entry.line) - \(entry.message)",
            terminator: entry.terminator
        )
    }
}

final class Logger {
    nonisolated(unsafe) static let shared = Logger()

    var minimumLogLevel: LogLevel = .info

    private var destinations: [LogDestination] = []

    private init() {
        addDestination(ConsoleLogDestination())
    }

    func setDestinations(_ destinations: [LogDestination]) {
        self.destinations = destinations
    }

    func addDestination(_ destination: LogDestination) {
        destinations.append(destination)
    }

    static func setDestinations(_ destinations: [LogDestination]) {
        shared.setDestinations(destinations)
    }

    static func addDestination(_ destination: LogDestination) {
        shared.addDestination(destination)
    }

    private func log(
        _ items: [Any?],
        context: LogContext
    ) {
        guard context.level.severity >= minimumLogLevel.severity else {
            return
        }

        let message = items
            .map { item in
                guard let item else {
                    return "nil"
                }

                return String(describing: item)
            }
            .joined(separator: context.separator)

        for destination in destinations {
            destination.log(LogEntry(
                message: message,
                level: context.level,
                file: context.file,
                function: context.function,
                line: context.line,
                terminator: context.terminator
            ))
        }
    }

    static func debug(
        _ items: Any?...,
        separator: String = " ",
        terminator: String = "\n",
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        shared.log(
            items,
            context: LogContext(
                level: .debug,
                separator: separator,
                terminator: terminator,
                file: file,
                function: function,
                line: line
            )
        )
    }

    static func info(
        _ items: Any?...,
        separator: String = " ",
        terminator: String = "\n",
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        shared.log(
            items,
            context: LogContext(
                level: .info,
                separator: separator,
                terminator: terminator,
                file: file,
                function: function,
                line: line
            )
        )
    }

    static func log(
        _ items: Any?...,
        separator: String = " ",
        terminator: String = "\n",
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        shared.log(
            items,
            context: LogContext(
                level: .info,
                separator: separator,
                terminator: terminator,
                file: file,
                function: function,
                line: line
            )
        )
    }

    static func warning(
        _ items: Any?...,
        separator: String = " ",
        terminator: String = "\n",
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        shared.log(
            items,
            context: LogContext(
                level: .warning,
                separator: separator,
                terminator: terminator,
                file: file,
                function: function,
                line: line
            )
        )
    }

    static func error(
        _ items: Any?...,
        separator: String = " ",
        terminator: String = "\n",
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        shared.log(
            items,
            context: LogContext(
                level: .error,
                separator: separator,
                terminator: terminator,
                file: file,
                function: function,
                line: line
            )
        )
    }

    static func error(
        _ error: Error,
        file: String = #fileID,
        function: String = #function,
        line: Int = #line
    ) {
        shared.log(
            [error.localizedDescription],
            context: LogContext(
                level: .error,
                separator: " ",
                terminator: "\n",
                file: file,
                function: function,
                line: line
            )
        )
    }
}
