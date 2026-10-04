import Foundation

/// The four things Squeek looks after once they're switched on. Home lists them, and the setup
/// screen has one card for each.
enum SqueekGuard: String, CaseIterable, Identifiable {
  case calls, texts, web, payments, person, screen

  var id: String { rawValue }

  /// Screen Guard is extra: it doesn't count toward "5 of 5 on" or the setup nudges.
  var isOptional: Bool { self == .screen }

  /// The guards that count toward being fully set up.
  static var core: [SqueekGuard] { allCases.filter { !$0.isOptional } }

  var title: String {
    switch self {
    case .calls: return "Calls"
    case .texts: return "Texts"
    case .web: return "Websites"
    case .payments: return "Payments"
    case .person: return "Your person"
    case .screen: return "Screen Guard"
    }
  }

  var symbol: String {
    switch self {
    case .calls: return "phone.fill"
    case .texts: return "message.fill"
    case .web: return "safari.fill"
    case .payments: return "creditcard.fill"
    case .person: return "person.2.fill"
    case .screen: return "eye.fill"
    }
  }

  /// What the guard does while it's on.
  var onSummary: String {
    switch self {
    case .calls: return "Squeek answers unknown callers for you"
    case .texts: return "Scam texts go to Junk"
    case .web: return "Dangerous sites are blocked or flagged"
    case .payments: return "Squeek pauses you before paying after a scam"
    case .person: return "Someone you trust can help you check"
    case .screen: return "Squeek is reading your screen for scams"
    }
  }

  /// The next step while it's off.
  var offSummary: String {
    switch self {
    case .calls: return "Let Squeek answer calls you miss"
    case .texts: return "Turn on text filtering"
    case .web: return "Turn on Safari warnings"
    case .payments: return "Set up the pause before paying"
    case .person: return "Choose someone you trust"
    case .screen: return "Optional: let Squeek read your screen"
    }
  }
}
