import SqueekCore
import CoreText
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

// Squeek's design system: two warm neutrals (charcoal and cream) and one bright yellow, taken
// from the mascot. Yellow is the only colour that asks for attention: it fills the main button,
// the toggles and the mark, and stays out of body text. Type is Nunito, to match the wordmark.
// Warning text always sits on solid colour, never on glass, so it stays readable.

enum Theme {
  // MARK: Colour

  /// The two neutrals.
  static let ground = dynamic(light: 0xF7F4EC, dark: 0x151412)
  static let ink = dynamic(light: 0x1B1A17, dark: 0xF7F4EC)
  /// Cards sit a step above the ground in the same neutral family.
  static let card = dynamic(light: 0xFFFDF8, dark: 0x211F1C)
  static let cardStroke = dynamic(light: 0xEFEADD, dark: 0x2E2B27)
  static let hairline = dynamic(light: 0xE9E4D6, dark: 0x2E2B27)
  static let secondaryInk = dynamic(light: 0x5C5850, dark: 0xB8B2A6)
  static let neutralSoft = dynamic(light: 0xEFEBDF, dark: 0x2A2723)

  /// The yellow, for fills: buttons, switches, badges. Always paired with `onAccent`.
  static let accent = Color(rgb: 0xFFC83A)
  static let onAccent = Color(rgb: 0x1B1A17)
  /// The yellow as an icon or text colour: deeper on cream so it stays readable.
  static let accentInk = dynamic(light: 0x9A6500, dark: 0xFFC83A)
  static let accentSoft = dynamic(light: 0xFFF0C2, dark: 0x3A3220)

  /// Status colours stay functional and distinct from the brand yellow.
  static let safe = dynamic(light: 0x1F7A4D, dark: 0x6FCF97)
  static let safeSoft = dynamic(light: 0xE0F1E7, dark: 0x1F3328)
  static let ochre = dynamic(light: 0xB4500B, dark: 0xFFA55C)
  static let ochreSoft = dynamic(light: 0xFCE8D6, dark: 0x3D2A1A)
  static let danger = dynamic(light: 0xB3261E, dark: 0xFF8A80)
  static let dangerInk = dynamic(light: 0x7A1A14, dark: 0xFFC9C3)
  static let dangerSoft = dynamic(light: 0xF8E3E1, dark: 0x3A1C1A)

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
      return Status(tint: safe, soft: safeSoft, ink: safe, symbol: "checkmark.shield.fill", label: "No warning signs")
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

extension Theme {
  /// Registers the bundled Nunito files. Call once at launch, in the app and in extensions.
  static func registerFonts() {
    for url in Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [] {
      CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
    #if canImport(UIKit)
      let title: [NSAttributedString.Key: Any] = [.font: UIFont(name: "Nunito-ExtraBold", size: 17) ?? .boldSystemFont(ofSize: 17)]
      let large: [NSAttributedString.Key: Any] = [.font: UIFont(name: "Nunito-Black", size: 34) ?? .boldSystemFont(ofSize: 34)]
      UINavigationBar.appearance().titleTextAttributes = title
      UINavigationBar.appearance().largeTitleTextAttributes = large
      UITabBarItem.appearance().setTitleTextAttributes([.font: UIFont(name: "Nunito-Bold", size: 11) ?? .systemFont(ofSize: 11)], for: .normal)
      UIBarButtonItem.appearance().setTitleTextAttributes([.font: UIFont(name: "Nunito-Bold", size: 17) ?? .systemFont(ofSize: 17)], for: .normal)
    #endif
  }
}

extension Font {
  private static func face(_ weight: Font.Weight) -> String {
    switch weight {
    case .black, .heavy: return "Nunito-Black"
    case .bold: return "Nunito-ExtraBold"
    case .semibold: return "Nunito-Bold"
    case .medium: return "Nunito-SemiBold"
    default: return "Nunito-Regular"
    }
  }

  /// Nunito at a Dynamic Type text style. Weights run a step heavier than SF so Nunito's soft
  /// strokes stay easy to read.
  static func nunito(_ style: Font.TextStyle, _ weight: Font.Weight? = nil) -> Font {
    let (size, defaultWeight): (CGFloat, Font.Weight) = {
      switch style {
      case .largeTitle: return (34, .bold)
      case .title: return (28, .bold)
      case .title2: return (22, .bold)
      case .title3: return (20, .semibold)
      case .headline: return (17, .semibold)
      case .callout: return (16, .regular)
      case .subheadline: return (15, .regular)
      case .footnote: return (13, .regular)
      case .caption, .caption2: return (12, .regular)
      default: return (17, .regular)
      }
    }()
    return .custom(face(weight ?? defaultWeight), size: size, relativeTo: style)
  }

  /// Nunito at a fixed size, for big numbers and glyphs.
  static func nunito(size: CGFloat, weight: Font.Weight = .regular) -> Font {
    .custom(face(weight), size: size)
  }

  /// Nunito Black, for the wordmark and the big headlines.
  static func display(_ style: Font.TextStyle = .largeTitle) -> Font {
    nunito(style, .black)
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

/// Cream page background; lists and forms show it through.
struct ScreenBackground: ViewModifier {
  func body(content: Content) -> some View {
    content
      .scrollContentBackground(.hidden)
      .background(Theme.ground.ignoresSafeArea())
  }
}

extension View {
  func screenBackground() -> some View { modifier(ScreenBackground()) }

  /// Full-width Liquid Glass button in the brand yellow: the one main action on a screen.
  func primaryAction() -> some View {
    self
      .font(.title3.weight(.semibold))
      .foregroundStyle(Theme.onAccent)
      .buttonSizing(.flexible)
      .buttonStyle(.glassProminent)
      .buttonBorderShape(.roundedRectangle(radius: 22))
      .controlSize(.extraLarge)
      .tint(Theme.accent)
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
  var tint: Color = Theme.accent

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.title3.weight(.semibold))
      .frame(maxWidth: .infinity, minHeight: 60)
      .padding(.horizontal, 16)
      .foregroundStyle(Theme.onAccent)
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
  var tint: Color = Theme.accentInk
  var soft: Color = Theme.accentSoft
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

/// Squeek's mascot. `size` is the height; the artwork keeps its proportions.
struct SqueekEmblem: View {
  var size: CGFloat = 30

  var body: some View {
    Image("SqueekMark")
      .resizable()
      .scaledToFit()
      .frame(height: size)
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
    case "share": return "Shared to Squeek"
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
    case "seed": return "Squeek list"
    default: return source
    }
  }

  static func level(_ level: Level) -> String { Theme.status(level).label }
}
