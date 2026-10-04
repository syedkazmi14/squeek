import SqueekCore
import SwiftUI

/// A check result. A solid tinted header says what to do in one line, then the original message
/// with the risky phrases highlighted, the warning signs as tags, and the caller's actions pinned
/// at the bottom. Speaks once when it appears (unless muted); the header button replays it.
struct ResultView<Actions: View>: View {
  let result: CheckResult
  /// The text the person checked, shown with matched phrases highlighted. Nil for link checks.
  var original: String? = nil
  var speakOnAppear = true
  var onClose: (() -> Void)? = nil
  @ViewBuilder var actions: () -> Actions

  @ObservedObject private var speech = Speech.shared
  @State private var spoken = false
  @State private var appeared = false

  private var status: Theme.Status { Theme.status(result.level) }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        header
        VStack(alignment: .leading, spacing: 18) {
          if let original, !original.isEmpty {
            messageCard(original)
          } else if result.kind == "link" {
            linkCard
          }
          if !signLabels.isEmpty {
            FlowLayout(spacing: 8) {
              ForEach(signLabels, id: \.self) { Tag(text: $0) }
            }
          }
          if let links = result.links, !links.isEmpty, original != nil {
            linksCard(links)
          }
          coverage
        }
        .padding(.horizontal, Theme.pagePadding)
      }
      .padding(.bottom, 24)
    }
    .scrollIndicators(.hidden)
    .background(Theme.ground.ignoresSafeArea())
    .safeAreaInset(edge: .bottom, spacing: 0) {
      VStack(spacing: 10) { actions() }
        .padding(.horizontal, Theme.pagePadding)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(Theme.ground.opacity(0.94).ignoresSafeArea())
    }
    .sensoryFeedback(result.level == .danger ? .warning : .success, trigger: appeared)
    .onAppear {
      appeared = true
      guard speakOnAppear, !spoken else { return }
      spoken = true
      Speech.shared.speak(result.speech)
    }
    .onDisappear { Speech.shared.stop() }
  }

  // MARK: Header

  private var header: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack {
        if let onClose {
          Button(action: onClose) {
            Image(systemName: "xmark").font(.headline)
              .frame(width: 30, height: 30)
          }
          .buttonStyle(.glass)
          .buttonBorderShape(.circle)
          .accessibilityLabel("Close")
        }
        Spacer()
        Button {
          if speech.isSpeaking { Speech.shared.stop() } else { Speech.shared.speak(result.speech, force: true) }
        } label: {
          Label {
            Text(speech.isSpeaking ? "Speaking" : "Replay")
          } icon: {
            Image(systemName: "speaker.wave.3.fill")
              .symbolEffect(.variableColor.iterative, isActive: speech.isSpeaking)
          }
          .font(.nunito(.headline))
          .foregroundStyle(status.ink)
        }
        .buttonStyle(.glass)
        .accessibilityHint(speech.isSpeaking ? "Stops reading" : "Reads the warning out loud again")
      }

      Label {
        Text(status.label).font(.nunito(.headline)).foregroundStyle(status.ink)
      } icon: {
        Image(systemName: status.symbol)
          .font(.system(size: 17, weight: .bold))
          .foregroundStyle(.white)
          .frame(width: 36, height: 36)
          .background(status.tint, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
          .symbolEffect(.bounce, value: appeared)
      }
      .padding(.top, 6)

      Text(result.headline)
        .font(.display(.largeTitle))
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityAddTraits(.isHeader)

      if let detail {
        Text(detail)
          .font(.nunito(.title3))
          .foregroundStyle(Theme.ink.opacity(0.85))
          .fixedSize(horizontal: false, vertical: true)
      }
    }
    .padding(.horizontal, Theme.pagePadding)
    .padding(.top, 12)
    .padding(.bottom, 24)
    .frame(maxWidth: .infinity, alignment: .leading)
    .background(
      UnevenRoundedRectangle(bottomLeadingRadius: 34, bottomTrailingRadius: 34, style: .continuous)
        .fill(status.soft)
        .ignoresSafeArea(edges: .top)
    )
  }

  private var detail: String? {
    let key: String
    switch (result.kind, result.level) {
    case ("link", .danger): key = "link_malicious"
    case ("link", .caution): key = "link_suspicious"
    case ("link", .clear): key = "link_no_signal"
    case ("link", _): key = "link_unknown"
    case (_, .danger): key = "high_risk"
    case (_, .caution): key = "caution"
    case (_, .clear): key = "no_detected_signal"
    default: key = "unknown"
    }
    return CheckService.shared.checker?.engine.detail(for: key)
  }

  // MARK: Body

  private var signLabels: [String] {
    var seen = Set<String>()
    return result.reasons
      .filter { $0.id != "server_unavailable" }
      .map(\.label)
      .filter { seen.insert($0).inserted }
  }

  private func messageCard(_ text: String) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("The message")
        .font(.nunito(.caption, .bold))
        .textCase(.uppercase)
        .kerning(0.6)
        .foregroundStyle(Theme.secondaryInk)
      Text(highlighted(text))
        .font(.nunito(.title3))
        .lineSpacing(3)
        .foregroundStyle(Theme.ink)
        .textSelection(.enabled)
    }
    .card()
  }

  /// The original text with every matched phrase marked in the status colour.
  private func highlighted(_ text: String) -> AttributedString {
    let shown = String(text.prefix(1200))
    var attributed = AttributedString(shown)
    guard result.level != .clear else { return attributed }
    let phrases = Set(result.reasons.compactMap(\.match).filter { $0.count >= 3 })
    for phrase in phrases {
      var searchRange = attributed.startIndex..<attributed.endIndex
      while let range = attributed[searchRange].range(of: phrase, options: [.caseInsensitive]) {
        attributed[range].backgroundColor = status.soft
        attributed[range].foregroundColor = status.ink
        attributed[range].font = .nunito(.title3, .semibold)
        searchRange = range.upperBound..<attributed.endIndex
      }
    }
    return attributed
  }

  private var linkCard: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("The link")
        .font(.nunito(.caption, .bold))
        .textCase(.uppercase)
        .kerning(0.6)
        .foregroundStyle(Theme.secondaryInk)
      Text(result.domain ?? result.url ?? "")
        .font(.nunito(.title2, .semibold))
        .foregroundStyle(Theme.ink)
      if let url = result.url {
        Text(url).font(.nunito(.callout)).foregroundStyle(Theme.secondaryInk).lineLimit(2)
      }
      if let final = result.finalUrl {
        Label("Actually goes to \(final)", systemImage: "arrow.turn.down.right")
          .font(.nunito(.callout, .semibold))
          .foregroundStyle(status.ink)
      }
    }
    .card()
  }

  private func linksCard(_ links: [LinkSummary]) -> some View {
    VStack(alignment: .leading, spacing: 12) {
      Text("Links in this message")
        .font(.nunito(.caption, .bold))
        .textCase(.uppercase)
        .kerning(0.6)
        .foregroundStyle(Theme.secondaryInk)
      ForEach(links, id: \.self) { link in
        let linkStatus = Theme.status(Level(verdict: link.verdict))
        HStack(spacing: 12) {
          IconBadge(symbol: linkStatus.symbol, tint: linkStatus.tint, soft: linkStatus.soft, size: 34)
          Text(link.domain ?? link.url).font(.nunito(.body, .semibold)).foregroundStyle(Theme.ink)
          Spacer()
          Text(linkStatus.label).font(.nunito(.footnote)).foregroundStyle(Theme.secondaryInk)
        }
        .accessibilityElement(children: .combine)
      }
    }
    .card()
  }

  private var coverage: some View {
    VStack(alignment: .leading, spacing: 4) {
      if result.isLocal {
        Label("Checked on this phone only", systemImage: "iphone")
      } else if result.checks?.ai == "used" {
        Label("Checked with Squeek's rules and AI", systemImage: "checkmark.seal")
      } else {
        Label("Checked with Squeek's rules", systemImage: "checkmark.seal")
      }
      if result.checks?.ai == "unavailable" {
        Text("The AI check wasn't available this time.")
      }
      if result.checks?.safeBrowsing == "unavailable" {
        Text("Google Safe Browsing couldn't be reached.")
      }
      if result.level == .clear {
        Text("No warning signs doesn't prove something is safe.")
      }
    }
    .font(.nunito(.footnote))
    .foregroundStyle(Theme.secondaryInk)
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

extension ResultView where Actions == EmptyView {
  init(result: CheckResult, original: String? = nil, speakOnAppear: Bool = true, onClose: (() -> Void)? = nil) {
    self.init(result: result, original: original, speakOnAppear: speakOnAppear, onClose: onClose) { EmptyView() }
  }
}
