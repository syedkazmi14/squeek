import ClickeyCore
import SwiftUI

#if canImport(UIKit)
  import UIKit
#endif

/// The v5 "mature" direction from docs/design: ivory, forest green, near-black ink, restrained ochre.
enum Theme {
  static let ivory = dynamic(light: 0xFAF6EE, dark: 0x1B1C1A)
  static let card = dynamic(light: 0xFFFFFF, dark: 0x262724)
  static let ink = dynamic(light: 0x1C1B19, dark: 0xF2EEE6)
  static let secondaryInk = dynamic(light: 0x55524C, dark: 0xB9B4AA)
  static let forest = dynamic(light: 0x1F4D3A, dark: 0x7BC09F)
  static let onForest = dynamic(light: 0xFFFFFF, dark: 0x0E1F17)
  static let ochre = dynamic(light: 0x9A6A1E, dark: 0xE0B25E)
  static let danger = dynamic(light: 0x9B2C2C, dark: 0xF08A80)
  static let border = dynamic(light: 0xDCD5C8, dark: 0x3C3D39)

  static let corner: CGFloat = 12

  static func color(for level: Level) -> Color {
    switch level {
    case .danger: return danger
    case .caution: return ochre
    case .clear: return forest
    case .unknown: return secondaryInk
    }
  }

  static func symbol(for level: Level) -> String {
    switch level {
    case .danger: return "exclamationmark.octagon"
    case .caution: return "exclamationmark.triangle"
    case .clear: return "checkmark.circle"
    case .unknown: return "questionmark.circle"
    }
  }

  private static func dynamic(light: UInt32, dark: UInt32) -> Color {
    #if canImport(UIKit)
      return Color(
        UIColor { traits in
          UIColor(rgb: traits.userInterfaceStyle == .dark ? dark : light)
        })
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

/// Full-width primary action: forest green, flat, at least 60pt tall.
struct PrimaryButtonStyle: ButtonStyle {
  var tint: Color = Theme.forest

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.title3.weight(.semibold))
      .frame(maxWidth: .infinity, minHeight: 60)
      .padding(.horizontal, 16)
      .foregroundStyle(Theme.onForest)
      .background(tint.opacity(configuration.isPressed ? 0.8 : 1), in: RoundedRectangle(cornerRadius: Theme.corner))
      .contentShape(RoundedRectangle(cornerRadius: Theme.corner))
  }
}

/// Outlined secondary action with the same generous size.
struct SecondaryButtonStyle: ButtonStyle {
  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .font(.title3)
      .frame(maxWidth: .infinity, minHeight: 56)
      .padding(.horizontal, 16)
      .foregroundStyle(Theme.ink)
      .background(
        Theme.card.opacity(configuration.isPressed ? 0.7 : 1), in: RoundedRectangle(cornerRadius: Theme.corner)
      )
      .overlay(RoundedRectangle(cornerRadius: Theme.corner).stroke(Theme.border, lineWidth: 1.5))
      .contentShape(RoundedRectangle(cornerRadius: Theme.corner))
  }
}

struct CardModifier: ViewModifier {
  func body(content: Content) -> some View {
    content
      .padding(20)
      .frame(maxWidth: .infinity, alignment: .leading)
      .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.corner))
      .overlay(RoundedRectangle(cornerRadius: Theme.corner).stroke(Theme.border, lineWidth: 1))
  }
}

extension View {
  func card() -> some View { modifier(CardModifier()) }
}

/// Small incomplete-ring emblem from the v5 concept.
struct ClickeyEmblem: View {
  var size: CGFloat = 28

  var body: some View {
    ZStack {
      Circle()
        .trim(from: 0.08, to: 0.92)
        .stroke(Theme.forest, style: StrokeStyle(lineWidth: size * 0.12, lineCap: .round))
        .rotationEffect(.degrees(-30))
      Circle().fill(Theme.ochre).frame(width: size * 0.22, height: size * 0.22)
        .offset(x: size * 0.36, y: -size * 0.2)
    }
    .frame(width: size, height: size)
    .accessibilityHidden(true)
  }
}

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

  static func platform(_ platform: String) -> String {
    platform == "windows" ? "PC" : "iPhone"
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
    case "community": return "Reported by others"
    case "seed": return "Clickey list"
    default: return source
    }
  }

  static func level(_ level: Level) -> String {
    switch level {
    case .danger: return "Likely scam"
    case .caution: return "Be careful"
    case .clear: return "No warning signs"
    case .unknown: return "Not fully checked"
    }
  }
}
