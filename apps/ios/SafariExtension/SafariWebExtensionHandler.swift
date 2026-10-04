import ClickeyCore
import Foundation
import SafariServices

/// Native side of the Safari extension. The JavaScript sends messages through
/// browser.runtime.sendNativeMessage; this answers from the shared rules and block list,
/// and asks the server about the current page when the person is signed in.
final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
  func beginRequest(with context: NSExtensionContext) {
    let item = context.inputItems.first as? NSExtensionItem
    let message = item?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
    Task {
      let reply = await Self.handle(message)
      let response = NSExtensionItem()
      response.userInfo = [SFExtensionMessageKey: reply]
      context.completeRequest(returningItems: [response], completionHandler: nil)
    }
  }

  static func handle(_ message: [String: Any]) async -> [String: Any] {
    let service = CheckService.shared
    switch message["type"] as? String {
    case "checkLinks":
      // Fast, offline: used to mark risky links on every page.
      let urls = (message["urls"] as? [String] ?? []).prefix(300)
      guard let checker = service.checker else { return ["results": [:]] }
      let blocked = service.blockedDomains
      var results: [String: Any] = [:]
      for url in urls {
        let a = checker.links.analyze(url, blockedDomains: blocked)
        guard a.verdict == .malicious || a.verdict == .suspicious else { continue }
        results[url] = ["verdict": a.verdict.rawValue, "reasons": a.findings.map(\.label), "domain": a.domain ?? ""]
      }
      return ["results": results]

    case "checkPage", "checkLink":
      guard let url = message["url"] as? String else { return ["error": "missing url"] }
      let result = await service.checkLink(url, surface: .browser)
      return encode(result)

    case "status":
      return [
        "signedIn": Backend.shared.isSignedIn,
        "rulesVersion": service.checker?.engine.rules.version ?? "missing",
        "blockedDomains": service.blockedDomains.count,
      ]

    default:
      return ["error": "unknown message"]
    }
  }

  private static func encode(_ result: CheckResult) -> [String: Any] {
    [
      "level": result.level.rawValue,
      "headline": result.headline,
      "speech": result.speech,
      "reasons": result.reasons.map(\.label),
      "domain": result.domain ?? "",
      "isLocal": result.isLocal,
    ]
  }
}
