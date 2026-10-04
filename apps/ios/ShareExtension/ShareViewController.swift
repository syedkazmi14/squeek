import SqueekCore
import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// "Check with Squeek" in the Share sheet: text, a link, or a screenshot from any app.
final class ShareViewController: UIViewController {
  override func viewDidLoad() {
    super.viewDidLoad()
    Theme.registerFonts()
    let model = ShareModel()
    let root = ShareRootView(model: model) { [weak self] in
      Speech.shared.stop()
      self?.extensionContext?.completeRequest(returningItems: nil)
    }
    let host = UIHostingController(rootView: root)
    addChild(host)
    host.view.frame = view.bounds
    host.view.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    view.addSubview(host.view)
    host.didMove(toParent: self)

    let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
    Task { await model.run(items: items) }
  }
}

@MainActor
final class ShareModel: ObservableObject {
  enum State {
    case working(String)
    case done(CheckResult)
    case failed(String)
  }

  @Published var state: State = .working("Checking…")
  /// The text that was checked, so the result can highlight the risky phrases in it.
  @Published var checkedText: String?

  func run(items: [NSExtensionItem]) async {
    let providers = items.flatMap { $0.attachments ?? [] }
    var sharedText: String?
    var sharedURL: URL?

    for provider in providers {
      if provider.hasItemConformingToTypeIdentifier(UTType.image.identifier) {
        state = .working("Reading the picture…")
        guard let image = await Self.loadImage(provider) else { continue }
        let text = (try? await TextRecognizer.recognize(image)) ?? ""
        guard !text.isEmpty else {
          state = .failed("Squeek couldn't find any words in that picture.")
          return
        }
        state = .working("Checking…")
        checkedText = text
        state = .done(await CheckService.shared.checkText(text, surface: .screenshot))
        return
      }
      if sharedURL == nil, provider.hasItemConformingToTypeIdentifier(UTType.url.identifier),
        let url = try? await provider.loadItem(forTypeIdentifier: UTType.url.identifier) as? URL, !url.isFileURL
      {
        sharedURL = url
      }
      if sharedText == nil, provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier),
        let text = try? await provider.loadItem(forTypeIdentifier: UTType.plainText.identifier) as? String
      {
        sharedText = text
      }
    }

    let trimmed = sharedText?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
    // Shared text that is just a link is checked as a link.
    if sharedURL == nil, !trimmed.contains(" "), let first = LinkAnalyzer.extractURLs(from: trimmed, limit: 1).first,
      first.count >= trimmed.count - 1
    {
      sharedURL = URL(string: first.hasPrefix("http") ? first : "https://\(first)")
    }

    if let text = sharedText, !trimmed.isEmpty, trimmed != sharedURL?.absoluteString {
      // A message, with any shared URL included so its link is checked too.
      let combined = sharedURL.map { "\(text)\n\($0.absoluteString)" } ?? text
      checkedText = combined
      state = .done(await CheckService.shared.checkText(combined, surface: .share))
    } else if let url = sharedURL {
      state = .done(await CheckService.shared.checkLink(url.absoluteString, surface: .share))
    } else {
      state = .failed("Squeek can check text, links and screenshots. Try sharing one of those.")
    }
  }

  private static func loadImage(_ provider: NSItemProvider) async -> CGImage? {
    let item = try? await provider.loadItem(forTypeIdentifier: UTType.image.identifier)
    if let url = item as? URL, let image = UIImage(contentsOfFile: url.path) { return image.cgImage }
    if let data = item as? Data, let image = UIImage(data: data) { return image.cgImage }
    if let image = item as? UIImage { return image.cgImage }
    return nil
  }
}

struct ShareRootView: View {
  @ObservedObject var model: ShareModel
  var done: () -> Void

  var body: some View {
    Group {
      switch model.state {
      case .working(let message):
        VStack(spacing: 16) {
          SqueekEmblem(size: 44)
          ProgressView(message).font(.nunito(.title3))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.ground.ignoresSafeArea())
      case .failed(let message):
        VStack(spacing: 18) {
          Image(systemName: "questionmark.circle.fill").font(.system(size: 44)).foregroundStyle(Theme.secondaryInk)
          Text(message).font(.nunito(.title3)).multilineTextAlignment(.center)
          Button("Close", action: done).primaryAction()
        }
        .padding(Theme.pagePadding)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.ground.ignoresSafeArea())
      case .done(let result):
        ResultView(result: result, original: result.kind == "link" ? nil : model.checkedText, onClose: done) {
          Button("Done", action: done).primaryAction()
          if !Backend.shared.isSignedIn {
            Text("Open Squeek and sign in for the full check, including AI and Google Safe Browsing.")
              .font(.nunito(.footnote))
              .foregroundStyle(Theme.secondaryInk)
          }
        }
      }
    }
    .tint(Theme.accentInk)
    .font(.nunito(.body))
  }
}
