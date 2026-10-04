import ClickeyCore
import SwiftUI

/// Shows a check result: the warning, its evidence, and what was and wasn't checked.
/// Speaks once when it appears (unless muted); Replay speaks again.
struct ResultView<Actions: View>: View {
  let result: CheckResult
  var speakOnAppear = true
  @ViewBuilder var actions: () -> Actions

  @State private var spoken = false

  var body: some View {
    VStack(alignment: .leading, spacing: 24) {
      header
      if !result.reasons.isEmpty { evidence }
      if let links = result.links, !links.isEmpty { linkList(links) }
      coverage
      actions()
      Button {
        Speech.shared.speak(result.speech, force: true)
      } label: {
        Label("Replay", systemImage: "speaker.wave.2")
      }
      .buttonStyle(SecondaryButtonStyle())
      .accessibilityHint("Reads the warning out loud again")
    }
    .onAppear {
      guard speakOnAppear, !spoken else { return }
      spoken = true
      Speech.shared.speak(result.speech)
    }
    .onDisappear { Speech.shared.stop() }
  }

  private var header: some View {
    VStack(alignment: .leading, spacing: 12) {
      Rectangle().fill(Theme.color(for: result.level)).frame(width: 48, height: 3)
      Label {
        Text(Labels.level(result.level))
          .font(.headline)
      } icon: {
        Image(systemName: Theme.symbol(for: result.level))
      }
      .foregroundStyle(Theme.color(for: result.level))
      Text(result.headline)
        .font(.largeTitle.weight(.medium))
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
      Text(result.speech)
        .font(.title3)
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
    }
    .accessibilityElement(children: .combine)
  }

  private var evidence: some View {
    VStack(alignment: .leading, spacing: 16) {
      Divider()
      Text("Evidence").font(.headline).foregroundStyle(Theme.secondaryInk)
      ForEach(result.reasons, id: \.self) { reason in
        VStack(alignment: .leading, spacing: 6) {
          HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(reason.label).font(.title3.weight(.medium)).foregroundStyle(Theme.ink)
            if reason.source == "ai" {
              Text("AI").font(.caption.weight(.semibold)).padding(.horizontal, 6).padding(.vertical, 2)
                .overlay(Capsule().stroke(Theme.border))
                .accessibilityLabel("found by AI assessment")
            }
          }
          if let excerpt = reason.excerpt, !excerpt.isEmpty {
            Text("“\(excerpt)”")
              .font(.body)
              .foregroundStyle(Theme.secondaryInk)
              .padding(.leading, 12)
              .overlay(alignment: .leading) { Rectangle().fill(Theme.ochre).frame(width: 2) }
          }
        }
      }
    }
  }

  private func linkList(_ links: [LinkSummary]) -> some View {
    VStack(alignment: .leading, spacing: 10) {
      Text("Links in this message").font(.headline).foregroundStyle(Theme.secondaryInk)
      ForEach(links, id: \.self) { link in
        let level = Level(verdict: link.verdict)
        Label {
          Text(link.domain ?? link.url).font(.body).foregroundStyle(Theme.ink)
        } icon: {
          Image(systemName: Theme.symbol(for: level)).foregroundStyle(Theme.color(for: level))
        }
        .accessibilityLabel("\(link.domain ?? link.url): \(Labels.level(level))")
      }
    }
  }

  private var coverage: some View {
    VStack(alignment: .leading, spacing: 4) {
      if result.isLocal {
        Text("Checked on this phone only. Clickey's full check wasn't available.")
      }
      if let ai = result.checks?.ai, ai == "unavailable" {
        Text("The AI check wasn't available, so only Clickey's rules were used.")
      }
      if let sb = result.checks?.safeBrowsing, sb == "unavailable" {
        Text("Google Safe Browsing couldn't be reached.")
      }
      if let final = result.finalUrl {
        Text("This link actually goes to \(final)")
      }
      if result.level == .clear {
        Text("No warning signs doesn't prove something is safe.")
      }
    }
    .font(.callout)
    .foregroundStyle(Theme.secondaryInk)
  }
}

extension ResultView where Actions == EmptyView {
  init(result: CheckResult, speakOnAppear: Bool = true) {
    self.init(result: result, speakOnAppear: speakOnAppear) { EmptyView() }
  }
}
