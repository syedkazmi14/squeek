import SqueekCore
import SwiftUI

/// Squeek himself greets the person and says what happened since their last visit. Below him,
/// the four guards and the latest warnings. Squeek works in the background, so there's nothing to
/// start here.
struct HomeView: View {
  @EnvironmentObject private var model: AppModel
  @State private var setupFocus: SqueekGuard?

  var body: some View {
    let summary = model.homeSummary()
    GeometryReader { geometry in
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          // Squeek fills most of the first screen; the guards peek in below so it's clear there's more.
          VStack(spacing: 18) {
            Spacer(minLength: 0)
            MascotView(mood: summary.mood, height: min(170, geometry.size.width * 0.42))
            SpeechBubble(summary: summary, onFinishSetup: { setupFocus = firstOffGuard })
            Spacer(minLength: 0)
          }
          .frame(maxWidth: .infinity, minHeight: geometry.size.height * 0.68)

          GuardList(onSetUp: { setupFocus = $0 })
          RecentWarnings()
        }
        .padding(.horizontal, Theme.pagePadding)
        .padding(.bottom, 24)
      }
    }
    .scrollIndicators(.hidden)
    .screenBackground()
    .toolbar {
      ToolbarItem(placement: .topBarTrailing) {
        Button("Settings", systemImage: "gearshape.fill") { model.showingSettings = true }
      }
    }
    .refreshable { await model.refreshAll() }
    .sheet(item: $setupFocus) { focus in
      NavigationStack { GuardSetupView(focus: focus) }
    }
    .sheet(isPresented: $model.showingSettings) {
      NavigationStack { SettingsView() }
    }
  }

  private var firstOffGuard: SqueekGuard {
    SqueekGuard.allCases.first { !model.isOn($0) } ?? .calls
  }
}

/// What Squeek says, in a bubble pointing up at him, with a button to hear it.
private struct SpeechBubble: View {
  let summary: HomeSummary
  var onFinishSetup: () -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text(summary.greeting)
          .font(.nunito(.title2, .bold))
          .foregroundStyle(Theme.ink)
        Spacer(minLength: 8)
        Button("Read aloud", systemImage: "speaker.wave.2.fill") {
          Speech.shared.speak(summary.spoken, force: true)
        }
        .labelStyle(.iconOnly)
        .font(.title3)
        .foregroundStyle(Theme.accentInk)
      }
      Text(summary.message)
        .font(.nunito(.title3))
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
        .contentTransition(.opacity)
      switch summary.action {
      case .review(let incident):
        NavigationLink { IncidentDetailView(incident: incident) } label: {
          Text("See what happened")
        }
        .primaryAction()
        .padding(.top, 4)
      case .finishSetup:
        Button("Finish setting me up", action: onFinishSetup)
          .secondaryAction()
          .padding(.top, 4)
      case nil:
        EmptyView()
      }
    }
    .card(padding: 20, tint: summary.mood == .concerned ? Theme.dangerSoft : nil)
    .overlay(alignment: .top) {
      BubbleTail()
        .fill(summary.mood == .concerned ? Theme.dangerSoft : Theme.card)
        .frame(width: 28, height: 14)
        .offset(y: -13)
        .accessibilityHidden(true)
    }
    .animation(.spring(duration: 0.4), value: summary.message)
  }
}

private struct BubbleTail: Shape {
  func path(in rect: CGRect) -> Path {
    var path = Path()
    path.move(to: CGPoint(x: rect.minX, y: rect.maxY))
    path.addQuadCurve(to: CGPoint(x: rect.midX, y: rect.minY), control: CGPoint(x: rect.midX - 2, y: rect.maxY))
    path.addQuadCurve(to: CGPoint(x: rect.maxX, y: rect.maxY), control: CGPoint(x: rect.midX + 2, y: rect.maxY))
    path.closeSubpath()
    return path
  }
}

/// The four guards, each with its state. Tapping one that's off opens its setup steps.
private struct GuardList: View {
  @EnvironmentObject private var model: AppModel
  var onSetUp: (SqueekGuard) -> Void

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(title: "My guards") {
        Text("\(model.protectionsOn) of \(model.protectionsTotal) on")
          .font(.nunito(.subheadline, .semibold))
          .foregroundStyle(Theme.secondaryInk)
      }
      rows
    }
  }

  private var rows: some View {
    VStack(spacing: 0) {
      ForEach(Array(SqueekGuard.allCases.enumerated()), id: \.element) { index, item in
        let on = model.isOn(item)
        Button {
          if item == .person && on { model.selectedTab = .person } else { onSetUp(item) }
        } label: {
          HStack(spacing: 14) {
            IconBadge(
              symbol: item.symbol, tint: on ? Theme.accentInk : Theme.secondaryInk,
              soft: on ? Theme.accentSoft : Theme.neutralSoft)
            VStack(alignment: .leading, spacing: 2) {
              Text(item.title).font(.nunito(.headline)).foregroundStyle(Theme.ink)
              Text(on ? item.onSummary : item.offSummary)
                .font(.nunito(.subheadline))
                .foregroundStyle(Theme.secondaryInk)
            }
            Spacer(minLength: 8)
            if on {
              Image(systemName: "checkmark.circle.fill")
                .font(.title2)
                .foregroundStyle(Theme.safe)
                .accessibilityLabel("On")
            } else {
              Text("Turn on")
                .font(.nunito(.subheadline, .bold))
                .foregroundStyle(Theme.onAccent)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Theme.accent, in: Capsule())
            }
          }
          .padding(.vertical, 12)
          .contentShape(Rectangle())
        }
        .buttonStyle(PressableStyle())
        .accessibilityElement(children: .combine)
        if index < SqueekGuard.allCases.count - 1 { Divider().padding(.leading, 56) }
      }
    }
    .card(padding: 14)
  }
}

struct RecentWarnings: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    let recent = Array(model.incidents.prefix(3))
    if !recent.isEmpty {
      VStack(alignment: .leading, spacing: 12) {
        SectionHeader(title: "Recent") {
          Button("See all") { model.selectedTab = .activity }
            .font(.nunito(.subheadline, .semibold))
            .buttonStyle(.plain)
            .foregroundStyle(Theme.accentInk)
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
