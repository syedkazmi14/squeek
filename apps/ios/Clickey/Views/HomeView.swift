import ClickeyCore
import SwiftUI

struct HomeView: View {
  @EnvironmentObject private var model: AppModel
  @State private var sheet: HomeSheet?

  enum HomeSheet: String, Identifiable {
    case text, link, screenshot, reportNumber, setup
    var id: String { rawValue }
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 24) {
        HStack(spacing: 10) {
          ClickeyEmblem(size: 32)
          Text("Clickey").font(.system(.largeTitle, design: .serif).weight(.semibold))
        }
        ProtectionSummary(onSetUp: { sheet = .setup })

        VStack(alignment: .leading, spacing: 14) {
          Text("Check something").font(.title2.weight(.semibold))
          Button { sheet = .text } label: { Label("Check a message", systemImage: "text.bubble") }
            .buttonStyle(PrimaryButtonStyle())
          Button { sheet = .link } label: { Label("Check a link", systemImage: "link") }
            .buttonStyle(SecondaryButtonStyle())
          Button { sheet = .screenshot } label: { Label("Check a screenshot", systemImage: "text.viewfinder") }
            .buttonStyle(SecondaryButtonStyle())
          Button { sheet = .reportNumber } label: { Label("Block a scam caller", systemImage: "phone.down") }
            .buttonStyle(SecondaryButtonStyle())
          Text("Tip: in Messages, Mail or Safari, tap Share and choose Clickey to check what you're looking at.")
            .font(.callout)
            .foregroundStyle(Theme.secondaryInk)
        }

        RecentWarnings()
      }
      .padding(20)
    }
    .screenBackground()
    .hiddenNavigationBar()
    .refreshable { await model.refreshAll() }
    .sheet(item: $sheet) { sheet in
      switch sheet {
      case .text: CheckView(mode: .text)
      case .link: CheckView(mode: .link)
      case .screenshot: CheckView(mode: .screenshot)
      case .reportNumber: AddBlockView(kind: "phone")
      case .setup: NavigationStack { SetupGuideView() }
      }
    }
  }
}

/// Which protections are on, with one button to fix whatever isn't.
struct ProtectionSummary: View {
  @EnvironmentObject private var model: AppModel
  var onSetUp: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      Text("Your protection").font(.title2.weight(.semibold))
      row("Scam calls", on: model.callBlockingStatus == .enabled, detail: "Blocks and labels reported numbers")
      if ClickeyConfig.hasPaidAccount {
        row("Dangerous websites", on: model.protectiveDNSEnabled, detail: "Blocks known bad sites in every app")
      }
      row(
        "Sync with your computer", on: model.isSignedIn,
        detail: model.isSignedIn ? (model.email ?? "Signed in") : "Not signed in")
      Text("Text message filtering and Safari warnings are turned on in Settings; the setup guide shows how.")
        .font(.callout)
        .foregroundStyle(Theme.secondaryInk)
      Button("Set up protections", action: onSetUp)
        .buttonStyle(SecondaryButtonStyle())
    }
    .card()
  }

  private func row(_ title: String, on: Bool, detail: String) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: on ? "checkmark.circle.fill" : "circle.dashed")
        .font(.title2)
        .foregroundStyle(on ? Theme.forest : Theme.secondaryInk)
      VStack(alignment: .leading, spacing: 2) {
        Text(title).font(.title3.weight(.medium))
        Text(on ? detail : "Off: \(detail.lowercased())").font(.callout).foregroundStyle(Theme.secondaryInk)
      }
    }
    .accessibilityElement(children: .combine)
    .accessibilityValue(on ? "On" : "Off")
  }
}

struct RecentWarnings: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    let recent = Array(model.incidents.prefix(3))
    if !recent.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        Text("Recent warnings").font(.title2.weight(.semibold))
        ForEach(recent) { incident in
          NavigationLink { IncidentDetailView(incident: incident) } label: {
            IncidentRow(incident: incident)
          }
          .buttonStyle(.plain)
          .card()
        }
      }
    }
  }
}
