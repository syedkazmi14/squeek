import SqueekCore
import Foundation
import Supabase

/// Stores the Supabase session in a Keychain access group shared by the app and the
/// Share and Safari extensions, so they act as the same signed-in person. Falls back to the
/// app's own keychain if the group isn't available (for example an unsigned simulator build).
struct SharedAuthStorage: AuthLocalStorage {
  private let shared: KeychainLocalStorage?
  private let local = KeychainLocalStorage(service: "squeek.auth")

  init(accessGroup: String) {
    shared = accessGroup.isEmpty ? nil : KeychainLocalStorage(service: "squeek.auth", accessGroup: accessGroup)
  }

  func store(key: String, value: Data) throws {
    if let shared, (try? shared.store(key: key, value: value)) != nil { return }
    try local.store(key: key, value: value)
  }

  func retrieve(key: String) throws -> Data? {
    if let shared, let data = try? shared.retrieve(key: key) { return data }
    return try local.retrieve(key: key)
  }

  func remove(key: String) throws {
    try? shared?.remove(key: key)
    try? local.remove(key: key)
  }
}

enum BackendError: LocalizedError {
  case notConfigured
  case signedOut
  case server(String)

  var errorDescription: String? {
    switch self {
    case .notConfigured: return "Squeek isn't connected to its server yet."
    case .signedOut: return "Please sign in to Squeek first."
    case .server(let message): return message
    }
  }
}

/// Thin wrapper over the Supabase client used by the app and extensions.
final class Backend: @unchecked Sendable {
  static let shared = Backend()

  let client: SupabaseClient?

  private init() {
    guard let url = SqueekConfig.supabaseURL, SqueekConfig.isBackendConfigured else {
      client = nil
      return
    }
    client = SupabaseClient(
      supabaseURL: url,
      supabaseKey: SqueekConfig.supabaseAnonKey,
      options: SupabaseClientOptions(
        auth: .init(
          storage: SharedAuthStorage(accessGroup: SqueekConfig.keychainGroup),
          emitLocalSessionAsInitialSession: true)))
  }

  var isSignedIn: Bool { client?.auth.currentSession != nil }
  var userId: String? { client?.auth.currentUser?.id.uuidString.lowercased() }

  func requireClient() throws -> SupabaseClient {
    guard let client else { throw BackendError.notConfigured }
    guard client.auth.currentSession != nil else { throw BackendError.signedOut }
    return client
  }

  private func invoke<Body: Encodable, Response: Decodable>(_ name: String, _ body: Body) async throws -> Response {
    let client = try requireClient()
    do {
      return try await client.functions.invoke(name, options: FunctionInvokeOptions(body: body))
    } catch let FunctionsError.httpError(code, data) {
      let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
      throw BackendError.server(message ?? "The server couldn't finish (\(code)).")
    }
  }

  func assess(text: String, surface: Surface, deviceId: String?) async throws -> CheckResult {
    try await invoke("assess-text", AssessRequest(text: text, surface: surface, deviceId: deviceId))
  }

  func checkLink(_ url: String, surface: Surface, deviceId: String?) async throws -> CheckResult {
    try await invoke("check-link", LinkCheckRequest(url: url, surface: surface, deviceId: deviceId))
  }

  func report(kind: String, value: String, label: String?, householdId: String?, deviceId: String?) async throws
    -> ReportResponse
  {
    try await invoke(
      "report", ReportRequest(kind: kind, value: value, label: label, householdId: householdId, deviceId: deviceId))
  }

  /// Test sign-in (supabase/functions/demo-sign-in): an email is enough.
  /// Returns a one-time token for `auth.verifyOTP`. Works signed out, so it skips `requireClient`.
  func demoSignIn(email: String) async throws -> String {
    guard let client else { throw BackendError.notConfigured }
    struct Request: Encodable { let email: String }
    struct Response: Decodable { let tokenHash: String }
    do {
      let response: Response = try await client.functions.invoke(
        "demo-sign-in", options: FunctionInvokeOptions(body: Request(email: email)))
      return response.tokenHash
    } catch let FunctionsError.httpError(code, data) {
      let message = (try? JSONDecoder().decode([String: String].self, from: data))?["error"]
      throw BackendError.server(message ?? "The server couldn't finish (\(code)).")
    }
  }

  /// Phones the person's helpers once after "Continue anyway" on a likely scam (supabase/functions/notify-helpers).
  func notifyHelpers(incidentId: String) async throws {
    struct Request: Encodable { let incidentId: String }
    struct Response: Decodable { let sent: Int }
    let _: Response = try await invoke("notify-helpers", Request(incidentId: incidentId))
  }

  /// A helper asks someone they look out for if they're OK (supabase/functions/check-in).
  func startCheckIn(personId: String) async throws {
    struct Request: Encodable { let personId: String }
    struct Response: Decodable { let id: String }
    let _: Response = try await invoke("check-in", Request(personId: personId))
  }

  func claimPairing(code: String) async throws {
    let _: PairClaimResponse = try await invoke("pair-device", PairClaimRequest(code: code))
  }
}
