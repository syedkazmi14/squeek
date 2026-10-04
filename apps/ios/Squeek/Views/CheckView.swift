import SqueekCore
import ImageIO
import Pow
import PhotosUI
import SwiftUI

/// One sheet for checking a message, a link or a screenshot, then the result.
struct CheckView: View {
  enum Mode: String, CaseIterable, Identifiable {
    case text = "Message"
    case link = "Link"
    case screenshot = "Screenshot"
    var id: String { rawValue }
  }

  @State var mode: Mode
  var initialText = ""
  var autoRun = false

  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @Environment(\.openURL) private var openURL
  @State private var input = ""
  @State private var photo: PhotosPickerItem?
  @State private var checkedText: String?
  @State private var result: CheckResult?
  @State private var working = false
  @State private var screenshotFailed = false
  @State private var confirmOpen = false
  @State private var didAutoRun = false
  @FocusState private var inputFocused: Bool

  var body: some View {
    ZStack {
      if let result {
        ResultView(result: result, original: result.kind == "link" ? nil : checkedText, onClose: { dismiss() }) {
          actions(for: result)
        }
        .transition(.movingParts.blur)
      } else {
        inputScreen
          .transition(.opacity)
      }
    }
    .animation(.spring(duration: 0.45), value: result?.id)
    .onAppear {
      if input.isEmpty { input = initialText }
      guard autoRun, !didAutoRun, !initialText.isEmpty else { return }
      didAutoRun = true
      Task { await runCheck() }
    }
  }

  // MARK: Input

  private var inputScreen: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Picker("What to check", selection: $mode) {
            ForEach(Mode.allCases) { Text($0.rawValue).tag($0) }
          }
          .pickerStyle(.segmented)
          .controlSize(.large)

          switch mode {
          case .text: messageInput
          case .link: linkInput
          case .screenshot: screenshotInput
          }
        }
        .padding(Theme.pagePadding)
      }
      .scrollDismissesKeyboard(.interactively)
      .screenBackground()
      .navigationTitle("Check something")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Close", systemImage: "xmark") { dismiss() }
        }
      }
      .safeAreaInset(edge: .bottom) {
        if mode != .screenshot {
          Button {
            Task { await runCheck() }
          } label: {
            if working {
              ProgressView().tint(Theme.onAccent)
            } else {
              Label("Check", systemImage: "checkmark.shield.fill")
            }
          }
          .primaryAction()
          .disabled(input.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || working)
          .padding(.horizontal, Theme.pagePadding)
          .padding(.bottom, 8)
        }
      }
      .onChange(of: photo) { _, item in
        guard let item else { return }
        Task { await checkScreenshot(item) }
      }
    }
  }

  private var messageInput: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Paste or type the message you're unsure about.")
        .font(.nunito(.title3))
        .foregroundStyle(Theme.secondaryInk)
      ZStack(alignment: .topLeading) {
        if input.isEmpty {
          Text("The message")
            .font(.nunito(.title3))
            .foregroundStyle(Theme.secondaryInk.opacity(0.7))
            .padding(.top, 8)
            .padding(.leading, 5)
            .accessibilityHidden(true)
        }
        TextEditor(text: $input)
          .focused($inputFocused)
          .font(.nunito(.title3))
          .scrollContentBackground(.hidden)
          .frame(minHeight: 220)
          .accessibilityLabel("Message to check")
      }
      .card(padding: 14)
      PasteButton(payloadType: String.self) { strings in
        input = strings.joined(separator: "\n")
      }
      .buttonBorderShape(.capsule)
      .tint(Theme.accentInk)
    }
  }

  private var linkInput: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Paste or type the link you're unsure about.")
        .font(.nunito(.title3))
        .foregroundStyle(Theme.secondaryInk)
      HStack(spacing: 12) {
        Image(systemName: "link").font(.title3.weight(.semibold)).foregroundStyle(Theme.accentInk)
        TextField("www.example.com", text: $input)
          .focused($inputFocused)
          .font(.nunito(.title3))
          .keyboardType(.URL)
          .textInputAutocapitalization(.never)
          .autocorrectionDisabled()
      }
      .card(padding: 18)
      PasteButton(payloadType: String.self) { strings in
        input = strings.first ?? ""
      }
      .buttonBorderShape(.capsule)
      .tint(Theme.accentInk)
    }
  }

  private var screenshotInput: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Choose a screenshot of the message or web page.")
        .font(.nunito(.title3))
        .foregroundStyle(Theme.secondaryInk)
      PhotosPicker(selection: $photo, matching: .images) {
        VStack(spacing: 14) {
          Image(systemName: working ? "text.viewfinder" : "photo.badge.magnifyingglass")
            .font(.system(size: 44, weight: .medium))
            .foregroundStyle(Theme.accentInk)
            .symbolEffect(.pulse, isActive: working)
          Text(working ? "Reading the screenshot…" : "Choose a screenshot")
            .font(.nunito(.title3, .semibold))
            .foregroundStyle(Theme.ink)
          Text("Squeek reads the words on your iPhone. The picture isn't uploaded.")
            .font(.nunito(.callout))
            .foregroundStyle(Theme.secondaryInk)
            .multilineTextAlignment(.center)
        }
        .padding(.vertical, 36)
        .padding(.horizontal, 20)
        .frame(maxWidth: .infinity)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.corner, style: .continuous))
        .overlay(
          RoundedRectangle(cornerRadius: Theme.corner, style: .continuous)
            .strokeBorder(Theme.accentInk.opacity(0.35), style: StrokeStyle(lineWidth: 2, dash: [8, 6]))
        )
      }
      .buttonStyle(PressableStyle())
      .disabled(working)
      if screenshotFailed {
        Label("Squeek couldn't find any words in that picture.", systemImage: "exclamationmark.circle.fill")
          .foregroundStyle(Theme.danger)
      }
    }
  }

  // MARK: Checking

  private func runCheck() async {
    let text = input.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !text.isEmpty else { return }
    inputFocused = false
    working = true
    defer { working = false }
    if mode == .link {
      checkedText = nil
      result = await CheckService.shared.checkLink(text, surface: .link)
    } else {
      checkedText = text
      result = await CheckService.shared.checkText(text, surface: .text)
    }
  }

  private func checkScreenshot(_ item: PhotosPickerItem) async {
    working = true
    screenshotFailed = false
    defer { working = false }
    guard let data = try? await item.loadTransferable(type: Data.self),
      let source = CGImageSourceCreateWithData(data as CFData, nil),
      let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
    else {
      screenshotFailed = true
      return
    }
    let text = (try? await TextRecognizer.recognize(image)) ?? ""
    guard !text.isEmpty else {
      screenshotFailed = true
      return
    }
    checkedText = text
    result = await CheckService.shared.checkText(text, surface: .screenshot)
  }

  private func reset() {
    withAnimation {
      result = nil
      checkedText = nil
      input = ""
      photo = nil
    }
  }

  // MARK: Result actions

  @ViewBuilder
  private func actions(for result: CheckResult) -> some View {
    if result.kind == "link" {
      Button("Don't open it") {
        Task { await model.setAction("dismissed", forIncident: result.incidentId) }
        dismiss()
      }
      .primaryAction()
      HStack(spacing: 10) {
        if let domain = result.domain, !model.isBlocked(kind: "domain", value: domain) {
          Button("Block site", systemImage: "hand.raised.fill") {
            Task {
              if await model.addBlock(kind: "domain", rawValue: domain, label: nil, shareWithFamily: model.household != nil, report: true) {
                await model.setAction("blocked", forIncident: result.incidentId)
              }
            }
          }
          .secondaryAction()
        }
        if let urlString = result.url, let url = URL(string: urlString) {
          Button("Open anyway") {
            if result.level == .clear { open(url, result) } else { confirmOpen = true }
          }
          .secondaryAction()
          .confirmationDialog("Open a link Squeek warned you about?", isPresented: $confirmOpen, titleVisibility: .visible) {
            Button("Open anyway", role: .destructive) { open(url, result) }
            Button("Don't open", role: .cancel) {}
          }
        }
      }
    } else {
      if result.level == .danger || result.level == .caution {
        Button("Got it, I won't reply") {
          Task { await model.setAction("reviewed", forIncident: result.incidentId) }
          dismiss()
        }
        .primaryAction()
      } else {
        Button("Done") { dismiss() }.primaryAction()
      }
      HStack(spacing: 10) {
        ShareLink(item: Self.summary(result)) {
          Label("Ask family", systemImage: "person.2.fill")
        }
        .secondaryAction()
        Button("New check", action: reset)
          .secondaryAction()
      }
    }
  }

  private func open(_ url: URL, _ result: CheckResult) {
    Task { await model.setAction("opened_anyway", forIncident: result.incidentId) }
    openURL(url)
  }

  static func summary(_ result: CheckResult) -> String {
    var lines = ["Squeek says: \(result.headline)"]
    lines += result.reasons.map { "• \($0.label)" }
    lines.append("Can you help me check this?")
    return lines.joined(separator: "\n")
  }
}
