import SwiftAISDK

/// Session transcript messages reuse the AI SDK's UIMessage so chunk streams
/// from the server can be reassembled with SwiftAISDK's UI message stream
/// helpers. Re-exported here so features depend on API, not SwiftAISDK.
public typealias AgentUIMessage = SwiftAISDK.UIMessage
