import ClickeyCore
import Pow
import SwiftUI
import UIKit

struct HomeView: View {
  @EnvironmentObject private var model: AppModel
  @State private var sheet: HomeSheet?
  @State private var nothingToPaste = false

  enum HomeSheet: Identifiable {
    case check(CheckView.Mode, prefill: String)
    case reportNumber
    case setup

    var id: String {
      switch self {
      case .check(let mode, let prefill): return "check-\(mode.rawValue)-\(prefill.hashValue)"
      case .reportNumber: return "report"
      case .setup: return "setup"
      }
    }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        header
        ProtectionCard(onSetUp: { sheet = .setup })
        pasteAndCheck
        tiles
        RecentWarnings()
      }
      .padding(.horizontal, Theme.pagePadding)
      .padding(.bottom, 24)
    }
    .scrollIndicators(.hidden)
    .screenBackground()
    .hiddenNavigationBar()
    .refreshable { await model.refreshAll() }
    .alert("Nothing to check yet", isPresented: $nothingToPaste) {
      Button("OK", role: .cancel) {}
    } message: {
      Text("Copy a message or link first, then come back and tap Paste & check.")
    }
    .onAppear {
      #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("-ClickeyDemoCheck"), sheet == nil {
          sheet = .check(.text, prefill: DemoData.scamText)
        }
      #endif
    }
    .sheet(item: $sheet) { sheet in
      switch sheet {
      case .check(let mode, let prefill): CheckView(mode: mode, initialText: prefill, autoRun: !prefill.isEmpty)
      case .reportNumber: AddBlockView(kind: "phone")
      case .setup: NavigationStack { SetupGuideView() }
      }
    }
  }

  private var header: some View {
    HStack(spacing: 10) {
      ClickeyEmblem(size: 30)
      Text("Clickey").font(.display(.title)).foregroundStyle(Theme.ink)
      Spacer()
    }
    .padding(.top, 8)
    .accessibilityElement(children: .combine)
    .accessibilityAddTraits(.isHeader)
  }

  private var pasteAndCheck: some View {
    Button {
      let copied = UIPasteboard.general.string?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
      if copied.isEmpty {
        nothingToPaste = true
      } else {
        sheet = .check(CheckView.Mode.guess(for: copied), prefill: copied)
      }
    } label: {
      HStack(spacing: 14) {
        Image(systemName: "doc.on.clipboard.fill")
          .font(.system(size: 22, weight: .semibold))
          .frame(width: 48, height: 48)
          .background(.white.opacity(0.16), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        VStack(alignment: .leading, spacing: 2) {
          Text("Paste & check").font(.title2.weight(.bold))
          Text("A message or link you copied").font(.subheadline).opacity(0.85)
        }
        Spacer(minLength: 0)
        Image(systemName: "arrow.right").font(.headline)
      }
      .padding(.vertical, 6)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .buttonStyle(.glassProminent)
    .buttonBorderShape(.roundedRectangle(radius: 28))
    .controlSize(.extraLarge)
    .tint(Theme.forest)
    .accessibilityHint("Checks the message or link you copied for scam signs")
  }

  private var tiles: some View {
    LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
      tile("Message", "text.bubble.fill") { sheet = .check(.text, prefill: "") }
      tile("Link", "link") { sheet = .check(.link, prefill: "") }
      tile("Screenshot", "photo.fill") { sheet = .check(.screenshot, prefill: "") }
      tile("Scam caller", "phone.down.fill", tint: Theme.danger, soft: Theme.dangerSoft) { sheet = .reportNumber }
    }
  }

  private func tile(
    _ title: String, _ symbol: String, tint: Color = Theme.forest, soft: Color = Theme.forestSoft,
    action: @escaping () -> Void
  ) -> some View {
    Button(action: action) {
      VStack(alignment: .leading, spacing: 18) {
        IconBadge(symbol: symbol, tint: tint, soft: soft)
        Text(title).font(.headline).foregroundStyle(Theme.ink)
      }
      .card(padding: 16)
    }
    .buttonStyle(PressableStyle())
    .accessibilityLabel(title == "Scam caller" ? "Block a scam caller" : "Check a \(title.lowercased())")
  }
}

/// Protection ring: how many of the protections Clickey can see are on, and what to do next.
struct ProtectionCard: View {
  @EnvironmentObject private var model: AppModel
  var onSetUp: () -> Void

  private var allOn: Bool { model.protectionsOn == model.protectionsTotal }

  private var nextStep: String {
    if model.callBlockingStatus != .enabled { return "Turn on call blocking" }
    if !model.showsAccountData { return "Sign in to sync with your computer" }
    if !model.notificationsOn { return "Allow family alerts" }
    return "Review text and Safari protection"
  }

  var body: some View {
    HStack(spacing: 18) {
      ProtectionRing(value: model.protectionsOn, total: model.protectionsTotal)
        .changeEffect(.shine, value: model.protectionsOn)
      VStack(alignment: .leading, spacing: 6) {
        Text(allOn ? "You're protected" : "Almost there")
          .font(.title3.weight(.bold))
          .foregroundStyle(Theme.ink)
        Text(allOn ? "Calls, sync and alerts are on." : "\(model.protectionsOn) of \(model.protectionsTotal) protections are on.")
          .font(.subheadline)
          .foregroundStyle(Theme.secondaryInk)
        Button(action: onSetUp) {
          HStack(spacing: 4) {
            Text(nextStep)
            Image(systemName: "chevron.right").font(.caption.weight(.bold))
          }
          .font(.subheadline.weight(.semibold))
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.forest)
      }
      Spacer(minLength: 0)
    }
    .card(padding: 20)
  }
}

struct ProtectionRing: View {
  let value: Int
  let total: Int

  var body: some View {
    ZStack {
      Circle().stroke(Theme.neutralSoft, lineWidth: 9)
      Circle()
        .trim(from: 0, to: total == 0 ? 0 : CGFloat(value) / CGFloat(total))
        .stroke(Theme.forest, style: StrokeStyle(lineWidth: 9, lineCap: .round))
        .rotationEffect(.degrees(-90))
        .animation(.spring(duration: 0.8), value: value)
      Text("\(value)/\(total)")
        .font(.title3.weight(.bold))
        .foregroundStyle(Theme.forest)
        .contentTransition(.numericText(value: Double(value)))
    }
    .frame(width: 80, height: 80)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(value) of \(total) protections on")
  }
}

struct RecentWarnings: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    let recent = Array(model.incidents.prefix(3))
    if !recent.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        SectionHeader(title: "Recent") {
          Button("See all") { model.selectedTab = .warnings }
            .font(.subheadline.weight(.semibold))
            .buttonStyle(.plain)
            .foregroundStyle(Theme.forest)
        }
        VStack(spacing: 0) {
          ForEach(Array(recent.enumerated()), id: \.element.id) { index, incident in
            NavigationLink { IncidentDetailView(incident: incident) } label: {
              IncidentRow(incident: incident)
                .padding(.vertical, 12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            if index < recent.count - 1 { Divider().padding(.leading, 56) }
          }
        }
        .card(padding: 14)
      }
    }
  }
}

extension CheckView.Mode {
  /// A single link becomes a link check; anything else is checked as a message.
  static func guess(for text: String) -> CheckView.Mode {
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.contains(" "), !trimmed.contains("\n"),
      let first = LinkAnalyzer.extractURLs(from: trimmed, limit: 1).first,
      first.count >= trimmed.count - 1
    else { return .text }
    return .link
  }
}
