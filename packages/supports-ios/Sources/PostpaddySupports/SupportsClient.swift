// PostpaddySupports — thin Swift client for the Supports backend.
// REST + GCS uploads + history + send. Realtime subscription is left to the
// host app (use Supabase Swift SDK or simple polling).
//
// All endpoints + payloads match the React Native SDK and are documented in
// docs/postpaddy-mobile-spec.md.
import Foundation

public struct SupportsConfig {
  public let widgetId: String
  public let supabaseURL: URL
  public let supabaseAnonKey: String
  public init(widgetId: String, supabaseURL: URL, supabaseAnonKey: String) {
    self.widgetId = widgetId
    self.supabaseURL = supabaseURL
    self.supabaseAnonKey = supabaseAnonKey
  }
}

public struct WidgetConfig: Decodable {
  public let brand_id: String
  public let brand_name: String
  public let brand_color: String?
  public let assistant_name: String?
}

public struct Attachment: Codable {
  public let url: String
  public let mime: String
  public let kind: String          // "image" | "video"
  public var width: Int?
  public var height: Int?
  public var duration_ms: Int?
  public init(url: String, mime: String, kind: String,
              width: Int? = nil, height: Int? = nil, duration_ms: Int? = nil) {
    self.url = url; self.mime = mime; self.kind = kind
    self.width = width; self.height = height; self.duration_ms = duration_ms
  }
}

public struct Message: Decodable {
  public let id: String
  public let conversation_id: String
  public let sender: String
  public let sender_name: String?
  public let content: String?
  public let translated_content: String?
  public let original_language: String?
  public let translated_language: String?
  public let attachment_url: String?
  public let created_at: String
}

public struct StartConversationResult {
  public let visitorToken: String
  public let conversationId: String
  public let visitorLanguage: String?
}

public enum SupportsError: Error {
  case http(Int, String)
  case decoding(String)
  case missingIdentity
}

public final class SupportsClient {
  private let cfg: SupportsConfig
  private let session: URLSession
  private let defaults = UserDefaults.standard
  private let TOKEN_KEY = "postpaddy.supports.contact_token"
  private let VUID_KEY  = "postpaddy.supports.visitor_uid"

  public init(_ cfg: SupportsConfig, session: URLSession = .shared) {
    self.cfg = cfg
    self.session = session
  }

  // MARK: - Public API

  public func bootstrap() async throws -> WidgetConfig {
    return try await call("widget-bootstrap", body: ["widget_id": cfg.widgetId])
  }

  public func identify(name: String? = nil, email: String? = nil,
                       phone: String? = nil, externalUserId: String? = nil) async throws {
    let vuid = visitorUID()
    var body: [String: Any] = ["widget_id": cfg.widgetId, "visitor_uid": vuid]
    if let v = name { body["name"] = v }
    if let v = email { body["email"] = v }
    if let v = phone { body["phone"] = v }
    if let v = externalUserId { body["external_user_id"] = v }
    let res: IdentifyResponse = try await call("widget-start", body: body)
    if let tok = res.contact_token { defaults.set(tok, forKey: TOKEN_KEY) }
  }

  public func startConversation() async throws -> StartConversationResult {
    var body: [String: Any] = ["widget_id": cfg.widgetId, "visitor_uid": visitorUID()]
    if let tok = contactToken() { body["contact_token"] = tok }
    let res: StartResponse = try await call("widget-start", body: body)
    if let tok = res.contact_token { defaults.set(tok, forKey: TOKEN_KEY) }
    return .init(visitorToken: res.visitor_token, conversationId: res.conversation_id,
                 visitorLanguage: res.visitor_language)
  }

  public func openConversation(_ conversationId: String) async throws -> StartConversationResult {
    guard let tok = contactToken() else { throw SupportsError.missingIdentity }
    let res: StartResponse = try await call("widget-open-conversation", body: [
      "widget_id": cfg.widgetId, "contact_token": tok, "conversation_id": conversationId,
    ])
    return .init(visitorToken: res.visitor_token, conversationId: res.conversation_id,
                 visitorLanguage: res.visitor_language)
  }

  public func loadHistory(visitorToken: String) async throws -> [Message] {
    struct R: Decodable { let messages: [Message] }
    let r: R = try await call("widget-history", body: [:], extraHeaders: ["x-visitor-token": visitorToken])
    return r.messages
  }

  /// Uploads any local-file attachments to GCS, then sends the message.
  public func sendMessage(visitorToken: String, text: String,
                          attachments: [LocalAttachment] = []) async throws -> Message {
    var uploaded: [Attachment] = []
    for a in attachments {
      uploaded.append(try await uploadAttachment(visitorToken: visitorToken, local: a))
    }
    struct R: Decodable { let message: Message }
    let r: R = try await call(
      "widget-send-message",
      body: ["message": text, "attachments": uploaded.map { $0.dict() }],
      extraHeaders: ["x-visitor-token": visitorToken]
    )
    return r.message
  }

  public func setLanguage(visitorToken: String, language: String) async throws {
    let _: EmptyResponse = try await call(
      "widget-set-language", body: ["language": language],
      extraHeaders: ["x-visitor-token": visitorToken]
    )
  }

  public func reset() {
    defaults.removeObject(forKey: TOKEN_KEY)
    defaults.removeObject(forKey: VUID_KEY)
  }

  // MARK: - Local types

  /// Attachment as held by the host app before upload. Convert HEIC → JPEG yourself.
  public struct LocalAttachment {
    public let data: Data
    public let mime: String
    public let kind: String   // "image" | "video"
    public var width: Int?
    public var height: Int?
    public var duration_ms: Int?
    public init(data: Data, mime: String, kind: String,
                width: Int? = nil, height: Int? = nil, duration_ms: Int? = nil) {
      self.data = data; self.mime = mime; self.kind = kind
      self.width = width; self.height = height; self.duration_ms = duration_ms
    }
  }

  // MARK: - Internals

  private struct IdentifyResponse: Decodable { let contact_token: String? }
  private struct StartResponse: Decodable {
    let visitor_token: String
    let conversation_id: String
    let visitor_language: String?
    let contact_token: String?
  }
  private struct EmptyResponse: Decodable {}

  private func contactToken() -> String? { defaults.string(forKey: TOKEN_KEY) }

  private func visitorUID() -> String {
    if let v = defaults.string(forKey: VUID_KEY) { return v }
    let v = "vuid_\(Int(Date().timeIntervalSince1970))_\(UUID().uuidString.prefix(8))"
    defaults.set(v, forKey: VUID_KEY)
    return v
  }

  private func uploadAttachment(visitorToken: String, local: LocalAttachment) async throws -> Attachment {
    struct SignR: Decodable { let upload_url: String; let public_url: String }
    let signed: SignR = try await call(
      "chat-upload-sign",
      body: ["kind": local.kind, "mime_type": local.mime, "size_bytes": local.data.count],
      extraHeaders: ["x-visitor-token": visitorToken]
    )
    var req = URLRequest(url: URL(string: signed.upload_url)!)
    req.httpMethod = "PUT"
    req.setValue(local.mime, forHTTPHeaderField: "Content-Type")
    req.httpBody = local.data
    let (_, resp) = try await session.data(for: req)
    if let h = resp as? HTTPURLResponse, !(200..<300).contains(h.statusCode) {
      throw SupportsError.http(h.statusCode, "GCS upload failed")
    }
    return Attachment(url: signed.public_url, mime: local.mime, kind: local.kind,
                      width: local.width, height: local.height, duration_ms: local.duration_ms)
  }

  private func call<T: Decodable>(_ path: String, body: [String: Any],
                                  extraHeaders: [String: String] = [:]) async throws -> T {
    var req = URLRequest(url: cfg.supabaseURL.appendingPathComponent("functions/v1/\(path)"))
    req.httpMethod = "POST"
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue(cfg.supabaseAnonKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(cfg.supabaseAnonKey)", forHTTPHeaderField: "Authorization")
    for (k, v) in extraHeaders { req.setValue(v, forHTTPHeaderField: k) }
    req.httpBody = try JSONSerialization.data(withJSONObject: body)
    let (data, resp) = try await session.data(for: req)
    guard let h = resp as? HTTPURLResponse else { throw SupportsError.http(0, "no response") }
    guard (200..<300).contains(h.statusCode) else {
      let text = String(data: data, encoding: .utf8) ?? ""
      throw SupportsError.http(h.statusCode, text)
    }
    if T.self == EmptyResponse.self, let v = EmptyResponse() as? T { return v }
    do { return try JSONDecoder().decode(T.self, from: data) }
    catch { throw SupportsError.decoding(String(describing: error)) }
  }
}

private extension Attachment {
  func dict() -> [String: Any] {
    var d: [String: Any] = ["url": url, "mime": mime, "kind": kind]
    if let v = width { d["width"] = v }
    if let v = height { d["height"] = v }
    if let v = duration_ms { d["duration_ms"] = v }
    return d
  }
}
