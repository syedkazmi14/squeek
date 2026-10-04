import ClickeyCore
import Foundation
import IdentityLookup

/// Sorts SMS/MMS from unknown senders. Runs entirely on the device with the shared rules and the
/// block list from the App Group; iOS doesn't let this extension make its own network requests.
/// Only clear scams go to Junk, so ordinary texts from new numbers still arrive normally.
final class MessageFilterExtension: ILMessageFilterExtension {}

extension MessageFilterExtension: ILMessageFilterQueryHandling {
  func handle(
    _ queryRequest: ILMessageFilterQueryRequest, context: ILMessageFilterExtensionContext,
    completion: @escaping (ILMessageFilterQueryResponse) -> Void
  ) {
    let response = ILMessageFilterQueryResponse()
    response.action = Self.decide(sender: queryRequest.sender, body: queryRequest.messageBody)
    completion(response)
  }

  private static let checker: LocalChecker? = RuleSet.bundled().map(LocalChecker.init(rules:))

  static func decide(sender: String?, body: String?) -> ILMessageFilterAction {
    let appGroup = (Bundle.main.object(forInfoDictionaryKey: "ClickeyAppGroup") as? String) ?? ""
    let snapshot = SharedStore(appGroup: appGroup)?.blockList() ?? .empty

    if let sender, let e164 = PhoneNumbers.normalizeE164(sender),
      snapshot.numbers.contains(where: { $0.e164 == e164 })
    {
      return .junk
    }
    guard let body, !body.isEmpty, let checker else { return ILMessageFilterAction.none }
    let result = checker.checkText(body, blockedDomains: snapshot.domains.map(\.domain))
    return result.level == .danger ? .junk : ILMessageFilterAction.none
  }
}
