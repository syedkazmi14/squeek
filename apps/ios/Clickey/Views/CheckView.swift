import ClickeyCore
import ImageIO
import PhotosUI
import SwiftUI

/// Paste a message, type a link, or pick a screenshot, then show the result.
struct CheckView: View {
  enum Mode { case text, link, screenshot }

  let mode: Mode
  var initialText = ""

  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var input = ""
  @State private var photo: PhotosPickerItem?
  @State private var recognizedText: String?
  @State private var result: CheckResult?
  @State private var working = false
  @State private var confirmOpen = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          if let result {
            ResultView(result: result) { actions(for: result) }
          } else {
            inputSection
          }
        }
        .padding(20)
      }
      .screenBackground()
      .navigationTitle(result == nil ? title : "Result")
      .scrollDismissesKeyboard(.interactively)
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } }
        if result != nil {
          ToolbarItem(placement: .primaryAction) {
            Button("Check another") {
              result = nil
              input = ""
              recognizedText = nil
              photo = nil
            }
          }
        }
      }
      .onAppear { if input.isEmpty { input = initialText } }
      .onChange(of: photo) { _, item in
        guard let item else { return }
        Task { await checkScreenshot(item) }
      }
    }
  }

  private var title: String {
    switch mode {
    case .text: return "Check a message"
    case .link: return "Check a link"
    case .screenshot: return "Check a screenshot"
    }
  }

  @ViewBuilder
  private var inputSection: some View {
    switch mode {
    case .text:
      Text("Paste or type the message you're unsure about.").font(.title3)
      TextEditor(text: $input)
        .font(.title3)
        .frame(minHeight: 200)
        .padding(8)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.corner))
        .overlay(RoundedRectangle(cornerRadius: Theme.corner).stroke(Theme.border))
        .accessibilityLabel("Message to check")
      PasteButton(payloadType: String.self) { strings in
        input = strings.joined(separator: "\n")
      }
      checkButton(disabled: input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty) {
        await run { await CheckService.shared.checkText(input, surface: .text) }
      }
    case .link:
      Text("Paste or type the link you're unsure about.").font(.title3)
      TextField("www.example.com", text: $input)
        .font(.title3)
        .keyboardType(.URL)
        .textInputAutocapitalization(.never)
        .autocorrectionDisabled()
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.corner))
        .overlay(RoundedRectangle(cornerRadius: Theme.corner).stroke(Theme.border))
      PasteButton(payloadType: String.self) { strings in
        input = strings.first ?? ""
      }
      checkButton(disabled: input.trimmingCharacters(in: .whitespaces).isEmpty) {
        await run { await CheckService.shared.checkLink(input, surface: .link) }
      }
    case .screenshot:
      Text("Choose a screenshot of the message or web page. Clickey reads the words on your phone; the picture isn't uploaded.")
        .font(.title3)
      PhotosPicker(selection: $photo, matching: .images) {
        Label("Choose a screenshot", systemImage: "photo.on.rectangle")
      }
      .buttonStyle(PrimaryButtonStyle())
      .disabled(working)
      if working { ProgressView("Reading the screenshot…").font(.title3) }
      if let recognizedText, recognizedText.isEmpty {
        Text("Clickey couldn't find any words in that picture.").foregroundStyle(Theme.danger)
      }
    }
  }

  private func checkButton(disabled: Bool, action: @escaping () async -> Void) -> some View {
    Button {
      Task { await action() }
    } label: {
      if working { ProgressView().tint(Theme.onForest) } else { Text("Check") }
    }
    .buttonStyle(PrimaryButtonStyle())
    .disabled(disabled || working)
  }

  private func run(_ check: () async -> CheckResult) async {
    working = true
    defer { working = false }
    result = await check()
  }

  private func checkScreenshot(_ item: PhotosPickerItem) async {
    working = true
    defer { working = false }
    guard let data = try? await item.loadTransferable(type: Data.self),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
      recognizedText = ""
      return
    }
    let text = (try? await TextRecognizer.recognize(image)) ?? ""
    recognizedText = text
    guard !text.isEmpty else { return }
    result = await CheckService.shared.checkText(text, surface: .screenshot)
  }

  @ViewBuilder
  private func actions(for result: CheckResult) -> some View {
    if result.kind == "link" {
      Button("Don't open it") {
        Task { await model.setAction("dismissed", forIncident: result.incidentId) }
        dismiss()
      }
      .buttonStyle(PrimaryButtonStyle())
      if let domain = result.domain, !model.isBlocked(kind: "domain", value: domain) {
        Button {
          Task {
            if await model.addBlock(kind: "domain", rawValue: domain, label: nil, shareWithFamily: model.household != nil, report: true) {
              await model.setAction("blocked", forIncident: result.incidentId)
            }
          }
        } label: {
          Label("Block this website", systemImage: "hand.raised")
        }
        .buttonStyle(SecondaryButtonStyle())
      }
      if let urlString = result.url, let url = URL(string: urlString) {
        Button("Open anyway") {
          if result.level == .clear { open(url, result) } else { confirmOpen = true }
        }
        .buttonStyle(SecondaryButtonStyle())
        .confirmationDialog("Open a link Clickey warned you about?", isPresented: $confirmOpen, titleVisibility: .visible) {
          Button("Open anyway", role: .destructive) { open(url, result) }
          Button("Don't open", role: .cancel) {}
        }
      }
    } else {
      if result.level == .danger || result.level == .caution {
        Button("I won't respond to it") {
          Task { await model.setAction("reviewed", forIncident: result.incidentId) }
          dismiss()
        }
        .buttonStyle(PrimaryButtonStyle())
      } else {
        Button("Done") { dismiss() }.buttonStyle(PrimaryButtonStyle())
      }
      ShareLink(item: Self.summary(result)) {
        Label("Ask someone you trust", systemImage: "square.and.arrow.up")
      }
      .buttonStyle(SecondaryButtonStyle())
    }
  }

  private func open(_ url: URL, _ result: CheckResult) {
    Task { await model.setAction("opened_anyway", forIncident: result.incidentId) }
    openURL(url)
  }

  static func summary(_ result: CheckResult) -> String {
    var lines = ["Clickey says: \(result.headline)"]
    lines += result.reasons.map { "• \($0.label)" }
    lines.append("Can you help me check this?")
    return lines.joined(separator: "\n")
  }
}
