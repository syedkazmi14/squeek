import Foundation

/// The four things Squeek looks after once they're switched on. Home lists them, and the setup
/// screen has one card for each.
enum SqueekGuard: String, CaseIterable, Identifiable {
  case calls, texts, web, person

  var id: String { rawValue }

  var title: String {
    switch self {
    case .calls: return "Calls"
    case .texts: return "Texts"
    case .web: return "Websites"
    case .person: return "Your person"
    }
  }

  var symbol: String {
    switch self {
    case .calls: return "phone.fill"
    case .texts: return "message.fill"
    case .web: return "safari.fill"
    case .person: return "person.2.fill"
    }
  }

  /// What the guard does while it's on.
  var onSummary: String {
    switch self {
    case .calls: return "Scam callers are blocked or labeled"
    case .texts: return "Scam texts go to Junk"
    case .web: return "Dangerous sites are blocked or flagged"
    case .person: return "Someone you trust can help you check"
    }
  }

  /// The next step while it's off.
  var offSummary: String {
    switch self {
    case .calls: return "Turn on call blocking and alerts"
    case .texts: return "Turn on text filtering"
    case .web: return "Turn on Safari warnings"
    case .person: return "Choose someone you trust"
    }
  }
}
