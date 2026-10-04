import AppIntents
import ClickeyCore
import Foundation
import ImageIO
import UniformTypeIdentifiers

// Shortcuts actions. "Check a Screenshot" pairs with the built-in "Take Screenshot" action and
// Back Tap for a one-press check. Results come back as spoken/displayed dialog.

struct CheckScreenshotIntent: AppIntent {
  static var title: LocalizedStringResource = "Check a Screenshot"
  static var description = IntentDescription("Reads the words in a screenshot on your iPhone and checks them for scam warning signs.")

  @Parameter(title: "Screenshot", supportedContentTypes: [.image])
  var screenshot: IntentFile

  func perform() async throws -> some IntentResult & ProvidesDialog {
    guard let source = CGImageSourceCreateWithData(screenshot.data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
      return .result(dialog: "Clickey couldn't open that picture.")
    }
    let text = try await TextRecognizer.recognize(image)
    guard !text.isEmpty else { return .result(dialog: "Clickey couldn't find any words on the screen.") }
    let result = await CheckService.shared.checkText(text, surface: .screenshot)
    return .result(dialog: IntentDialog(stringLiteral: result.speech))
  }
}

struct CheckMessageIntent: AppIntent {
  static var title: LocalizedStringResource = "Check a Message"
  static var description = IntentDescription("Checks a message for scam warning signs.")

  @Parameter(title: "Message")
  var message: String

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let result = await CheckService.shared.checkText(message, surface: .text)
    return .result(dialog: IntentDialog(stringLiteral: result.speech))
  }
}

struct CheckLinkIntent: AppIntent {
  static var title: LocalizedStringResource = "Check a Link"
  static var description = IntentDescription("Checks whether a link looks dangerous.")

  @Parameter(title: "Link")
  var link: URL

  func perform() async throws -> some IntentResult & ProvidesDialog {
    let result = await CheckService.shared.checkLink(link.absoluteString, surface: .link)
    return .result(dialog: IntentDialog(stringLiteral: result.speech))
  }
}

struct ClickeyShortcuts: AppShortcutsProvider {
  static var appShortcuts: [AppShortcut] {
    AppShortcut(
      intent: CheckMessageIntent(),
      phrases: ["Check a message with \(.applicationName)", "Ask \(.applicationName) about a message"],
      shortTitle: "Check a message",
      systemImageName: "text.bubble")
    AppShortcut(
      intent: CheckLinkIntent(),
      phrases: ["Check a link with \(.applicationName)"],
      shortTitle: "Check a link",
      systemImageName: "link")
  }
}
