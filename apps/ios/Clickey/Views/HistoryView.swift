import ClickeyCore
import SwiftUI

struct HistoryView: View {
  @EnvironmentObject private var model: AppModel

  var body: some View {
    List {
      if !model.isSignedIn {
        Text("Sign in to see warnings from Clickey on your computer and from family you help.")
          .foregroundStyle(Theme.secondaryInk)
      } else if model.incidents.isEmpty {
        Text("No warnings yet. When Clickey warns you on this iPhone or your computer, it shows up here.")
          .foregroundStyle(Theme.secondaryInk)
      }
      ForEach(model.incidents) { incident in
        NavigationLink { IncidentDetailView(incident: incident) } label: {
          IncidentRow(incident: incident)
        }
      }
    }
    .screenBackground()
    .navigationTitle("Warnings")
    .refreshable { await model.refreshAll() }
    .overlay { if model.isRefreshing && model.incidents.isEmpty { ProgressView() } }
  }
}

struct IncidentRow: View {
  @EnvironmentObject private var model: AppModel
  let incident: Incident

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: Theme.symbol(for: incident.level))
        .font(.title2)
        .foregroundStyle(Theme.color(for: incident.level))
      VStack(alignment: .leading, spacing: 4) {
        Text(Labels.level(incident.level)).font(.title3.weight(.medium)).foregroundStyle(Theme.ink)
        Text(subtitle).font(.callout).foregroundStyle(Theme.secondaryInk)
        if let evidence = incident.evidenceRedacted ?? incident.indicatorValue {
          Text(evidence).font(.callout).lineLimit(2).foregroundStyle(Theme.secondaryInk)
        }
      }
    }
    .padding(.vertical, 4)
    .accessibilityElement(children: .combine)
  }

  private var subtitle: String {
    var parts = [Labels.surface(incident.surface), "on \(Labels.platform(incident.platform))"]
    if incident.userId != model.userId { parts.insert(model.memberName(incident.userId) ?? "Family member", at: 0) }
    if let date = incident.date { parts.append(date.formatted(.relative(presentation: .named))) }
    return parts.joined(separator: " · ")
  }
}

struct IncidentDetailView: View {
  @EnvironmentObject private var model: AppModel
  let incident: Incident

  var body: some View {
    let current = model.incidents.first { $0.id == incident.id } ?? incident
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        IncidentRow(incident: current)
        if !current.categories.isEmpty {
          VStack(alignment: .leading, spacing: 8) {
            Text("Warning signs").font(.headline).foregroundStyle(Theme.secondaryInk)
            ForEach(current.categories, id: \.self) { Text("• \(Labels.category($0))").font(.title3) }
          }
        }
        if let evidence = current.evidenceRedacted {
          VStack(alignment: .leading, spacing: 8) {
            Text("Evidence").font(.headline).foregroundStyle(Theme.secondaryInk)
            Text("“\(evidence)”").font(.title3)
              .padding(.leading, 12)
              .overlay(alignment: .leading) { Rectangle().fill(Theme.ochre).frame(width: 2) }
            Text("Private details like phone numbers and codes are removed before anything is saved.")
              .font(.callout).foregroundStyle(Theme.secondaryInk)
          }
        }
        if let action = current.userAction {
          Text("Marked: \(action.replacingOccurrences(of: "_", with: " "))").foregroundStyle(Theme.secondaryInk)
        }
        if current.userId == model.userId {
          actions(current)
        }
      }
      .padding(20)
    }
    .screenBackground()
    .navigationTitle(Labels.surface(current.surface))
  }

  @ViewBuilder
  private func actions(_ incident: Incident) -> some View {
    if incident.userAction == nil {
      Button("I've dealt with this") { Task { await model.setAction("reviewed", forIncident: incident.id) } }
        .buttonStyle(PrimaryButtonStyle())
    }
    if let kind = incident.indicatorKind, let value = incident.indicatorValue, !model.isBlocked(kind: kind, value: value) {
      Button(kind == "phone" ? "Block this number" : "Block this website") {
        Task {
          if await model.addBlock(kind: kind, rawValue: value, label: nil, shareWithFamily: model.household != nil, report: false) {
            await model.setAction("blocked", forIncident: incident.id)
          }
        }
      }
      .buttonStyle(SecondaryButtonStyle())
    }
  }
}
