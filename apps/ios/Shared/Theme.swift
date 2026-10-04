import ClickeyCore
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

// Clickey's design system: "Calm Glass". Warm ivory ground, forest green, restrained ochre,
// Apple's own components (Liquid Glass controls, SF Symbols, SF Pro with New York for display).
// Warning text always sits on solid colour, never on glass, so it stays readable.

enum Theme {
  // MARK: Colour

  static let ground = dynamic(light: 0xF3F0E8, dark: 0x121411)
  static let card = dynamic(light: 0xFFFFFF, dark: 0x1D201C)
  static let cardStroke = dynamic(light: 0xFFFFFF, dark: 0x2B2F2A)
  static let hairline = dynamic(light: 0xE8E3D8, dark: 0x2B2F2A)
  static let ink = dynamic(light: 0x1C1B19, dark: 0xF2EEE6)
  static let secondaryInk = dynamic(light: 0x55524C, dark: 0xB9B4AA)

  static let forest = dynamic(light: 0x1F4D3A, dark: 0x7BC09F)
  static let forestSoft = dynamic(light: 0xE3EDE7, dark: 0x22352B)
  static let onForest = dynamic(light: 0xFFFFFF, dark: 0x0E1F17)
  static let ochre = dynamic(light: 0x8A5D14, dark: 0xE0B25E)
  static let ochreSoft = dynamic(light: 0xF6ECD7, dark: 0x3A2F1C)
  static let danger = dynamic(light: 0xB3261E, dark: 0xFF8A80)
  static let dangerInk = dynamic(light: 0x7A1A14, dark: 0xFFC9C3)
  static let dangerSoft = dynamic(light: 0xF8E3E1, dark: 0x3A1C1A)
  static let neutralSoft = dynamic(light: 0xECE8DF, dark: 0x2A2D29)

  /// Kept for older call sites.
  static var ivory: Color { ground }
  static var border: Color { hairline }

  // MARK: Shape and spacing

  static let corner: CGFloat = 26
  static let smallCorner: CGFloat = 18
  static let pagePadding: CGFloat = 20

  // MARK: Status

  struct Status {
    let tint: Color
    let soft: Color
    let ink: Color
    let symbol: String
    let label: String
  }

  static func status(_ level: Level) -> Status {
    switch level {
    case .danger:
      return Status(tint: danger, soft: dangerSoft, ink: dangerInk, symbol: "exclamationmark.triangle.fill", label: "Likely scam")
    case .caution:
      return Status(tint: ochre, soft: ochreSoft, ink: ochre, symbol: "exclamationmark.circle.fill", label: "Be careful")
    case .clear:
      return Status(tint: forest, soft: forestSoft, ink: forest, symbol: "checkmark.shield.fill", label: "No warning signs")
    case .unknown:
      return Status(tint: secondaryInk, soft: neutralSoft, ink: ink, symbol: "questionmark.circle.fill", label: "Not fully checked")
    }
  }

  static func color(for level: Level) -> Color { status(level).tint }
  static func symbol(for level: Level) -> String { status(level).symbol }

  private static func dynamic(light: UInt32, dark: UInt32) -> Color {
    #if canImport(UIKit)
      return Color(UIColor { $0.userInterfaceStyle == .dark ? UIColor(rgb: dark) : UIColor(rgb: light) })
    #else
      return Color(rgb: light)
    #endif
  }
}

#if canImport(UIKit)
  extension UIColor {
    convenience init(rgb: UInt32) {
      self.init(
        red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255,
        blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
    }
  }
#endif

extension Color {
  init(rgb: UInt32) {
    self.init(
      red: Double((rgb >> 16) & 0xFF) / 255, green: Double((rgb >> 8) & 0xFF) / 255, blue: Double(rgb & 0xFF) / 255)
  }
}

// MARK: - Type

extension Font {
  /// New York, for the wordmark and the big result headline.
  static func display(_ style: Font.TextStyle = .largeTitle) -> Font {
    .system(style, design: .serif).weight(.semibold)
  }
}

// MARK: - Surfaces

/// The app's card: solid, softly lifted, continuous corners.
struct CardModifier: ViewModifier {
  var padding: CGFloat = 18
  var tint: Color? = nil

  func body(content: Content) -> some View {
    content
      .padding(padding)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(tint ?? Theme.card, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
      .overlay(
        RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
          .strokeBorder(tint == nil ? Theme.cardStroke : .clear, lineWidth: 1)
      )
      .shadow(color: Color.black.opacity(0.05), radius: 16, y: 6)
  }
}

extension View {
  func card(padding: CGFloat = 18, tint: Color? = nil) -> some View {
    modifier(CardModifier(padding: padding, tint: tint))
  }
}

/// Ivory page background; lists and forms show it through.
struct ScreenBackground: ViewModifier {
  func body(content: Content) -> some View {
    content
      .scrollContentBackground(.hidden)
      .background(Theme.ground.ignoresSafeArea())
  }
}

extension View {
  func screenBackground() -> some View { modifier(ScreenBackground()) }

  /// Full-width Liquid Glass button tinted forest: the one main action on a screen.
  func primaryAction() -> some View {
    self
      .font(.title3.weight(.semibold))
      .buttonSizing(.flexible)
      .buttonStyle(.glassProminent)
      .buttonBorderShape(.roundedRectangle(radius: 22))
      .controlSize(.extraLarge)
      .tint(Theme.forest)
  }

  /// Full-width clear glass button for secondary actions.
  func secondaryAction() -> some View {
    self
      .font(.headline)
      .buttonSizing(.flexible)
      .buttonStyle(.glass)
      .buttonBorderShape(.roundedRectangle(radius: 20))
      .controlSize(.extraLarge)
      .tint(Theme.ink)
  }
}

// Old style names, used by the extensions; they now map to Liquid Glass.
struct PrimaryButtonStyle: ButtonStyle {
  var tint: Color = Theme.forest

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.title3.weight(.semibold))
      .frame(maxWidth: .infinity, minHeight: 60)
      .padding(.horizontal, 16)
      .foregroundStyle(Theme.onForest)
      .background(tint.opacity(configuration.isPressed ? 0.82 : 1), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
      .contentShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
  }
}

struct SecondaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.headline)
      .frame(maxWidth: .infinity, minHeight: 56)
      .padding(.horizontal, 16)
      .foregroundStyle(Theme.ink)
      .background(Theme.card.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
      .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).strokeBorder(Theme.hairline, lineWidth: 1))
      .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
  }
}

// MARK: - Small components

/// An SF Symbol on a soft rounded square, used in rows and tiles.
struct IconBadge: View {
  let symbol: String
  var tint: Color = Theme.forest
  var soft: Color = Theme.forestSoft
  var size: CGFloat = 42

  var body: some View {
    Image(systemName: symbol)
      .font(.system(size: size * 0.44, weight: .semibold))
      .foregroundStyle(tint)
      .frame(width: size, height: size)
      .background(soft, in: RoundedRectangle(cornerRadius: size * 0.34, style: .continuous))
      .accessibilityHidden(true)
  }
}

/// A rounded capsule label, for warning signs and sources.
struct Tag: View {
  let text: String
  var tint: Color = Theme.ink
  var background: Color = Theme.card

  var body: some View {
    Text(text)
      .font(.subheadline.weight(.semibold))
      .foregroundStyle(tint)
      .padding(.horizontal, 12)
      .padding(.vertical, 8)
      .background(background, in: Capsule())
      .overlay(Capsule().strokeBorder(Theme.hairline, lineWidth: 1))
  }
}

/// Section title with an optional trailing action.
struct SectionHeader<Trailing: View>: View {
  let title: String
  @ViewBuilder var trailing: () -> Trailing

  var body: some View {
    HStack(alignment: .firstTextBaseline) {
      Text(title).font(.title3.weight(.bold)).foregroundStyle(Theme.ink)
      Spacer()
      trailing()
    }
    .accessibilityAddTraits(.isHeader)
  }
}

extension SectionHeader where Trailing == EmptyView {
  init(_ title: String) {
    self.init(title: title) { EmptyView() }
  }
}

/// Wraps children onto new lines, for tag clouds.
struct FlowLayout: Layout {
  var spacing: CGFloat = 8

  func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
    let rows = arrange(proposal: proposal, subviews: subviews)
    let height = rows.reduce(0) { $0 + $1.height } + CGFloat(max(rows.count - 1, 0)) * spacing
    return CGSize(width: proposal.width ?? rows.map(\.width).max() ?? 0, height: height)
  }

  func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
    var y = bounds.minY
    for row in arrange(proposal: proposal, subviews: subviews) {
      var x = bounds.minX
      for index in row.indices {
        let size = subviews[index].sizeThatFits(.unspecified)
        subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(size))
        x += size.width + spacing
      }
      y += row.height + spacing
    }
  }

  private struct Row {
    var indices: [Int] = []
    var width: CGFloat = 0
    var height: CGFloat = 0
  }

  private func arrange(proposal: ProposedViewSize, subviews: Subviews) -> [Row] {
    let maxWidth = proposal.width ?? .infinity
    var rows: [Row] = [Row()]
    for (index, subview) in subviews.enumerated() {
      let size = subview.sizeThatFits(.unspecified)
      if !rows[rows.count - 1].indices.isEmpty, rows[rows.count - 1].width + spacing + size.width > maxWidth {
        rows.append(Row())
      }
      var row = rows[rows.count - 1]
      row.width += (row.indices.isEmpty ? 0 : spacing) + size.width
      row.height = max(row.height, size.height)
      row.indices.append(index)
      rows[rows.count - 1] = row
    }
    return rows
  }
}

/// Clickey's mark: an incomplete forest ring with an ochre dot.
struct ClickeyEmblem: View {
  var size: CGFloat = 30

  var body: some View {
    ZStack {
      Circle()
        .trim(from: 0.08, to: 0.92)
        .stroke(Theme.forest, style: StrokeStyle(lineWidth: size * 0.13, lineCap: .round))
        .rotationEffect(.degrees(-30))
      Circle().fill(Theme.ochre).frame(width: size * 0.22, height: size * 0.22)
        .offset(x: size * 0.36, y: -size * 0.2)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

// MARK: - Labels

enum Labels {
  static func surface(_ surface: String) -> String {
    switch surface {
    case "email": return "Email"
    case "sms": return "Text message"
    case "call": return "Phone call"
    case "link": return "Link"
    case "share": return "Shared to Clickey"
    case "screenshot": return "Screenshot"
    case "browser": return "Web page"
    default: return "Message"
    }
  }

  static func surfaceSymbol(_ surface: String) -> String {
    switch surface {
    case "email": return "envelope.fill"
    case "sms": return "message.fill"
    case "call": return "phone.down.fill"
    case "link", "browser": return "link"
    case "screenshot": return "photo.fill"
    default: return "text.bubble.fill"
    }
  }

  static func platform(_ platform: String) -> String {
    platform == "windows" ? "PC" : "iPhone"
  }

  static func platformSymbol(_ platform: String) -> String {
    platform == "windows" ? "desktopcomputer" : "iphone"
  }

  static func category(_ category: String) -> String {
    switch category {
    case "impersonation": return "Pretending to be someone"
    case "pressure": return "Pressure"
    case "secrecy": return "Secrecy"
    case "payment": return "Unusual payment"
    case "credentials": return "Asks for codes or passwords"
    case "remote_access": return "Remote access"
    case "prize": return "Prize"
    case "romance": return "Romance"
    case "delivery": return "Delivery"
    case "link": return "Risky link"
    case "reported": return "Reported by you"
    default: return category.replacingOccurrences(of: "_", with: " ").capitalized
    }
  }

  static func source(_ source: String) -> String {
    switch source {
    case "user": return "You"
    case "household": return "Family"
    case "community": return "Community"
    case "seed": return "Clickey list"
    default: return source
    }
  }

  static func level(_ level: Level) -> String { Theme.status(level).label }
}
