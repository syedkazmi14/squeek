import Charts
import SqueekCore
import SwiftUI

/// Everything Squeek caught on this iPhone, the computer, and for people you help. The block list
/// sits behind the toolbar button, since it's what Squeek acts on rather than something to watch.
struct ActivityView: View {
  @EnvironmentObject private var model: AppModel
  @State private var showSignIn = false

  private var groups: [(title: String, items: [Incident])] {
    let calendar = Calendar.current
    var order: [String] = []
    var buckets: [String: [Incident]] = [:]
    for incident in model.incidents {
      let date = incident.date ?? .distantPast
      let title: String
      if calendar.isDateInToday(date) {
        title = "Today"
      } else if calendar.isDateInYesterday(date) {
        title = "Yesterday"
      } else {
        title = date.formatted(.dateTime.weekday(.wide).month().day())
      }
      if buckets[title] == nil { order.append(title) }
      buckets[title, default: []].append(incident)
    }
    return order.map { ($0, buckets[$0] ?? []) }
  }

  var body: some View {
    Group {
      if !model.showsAccountData {
        ContentUnavailableView {
          Label("What Squeek catches shows up here", systemImage: "list.bullet.rectangle")
        } description: {
          Text("Sign in to see warnings from this iPhone, your computer and the people you help.")
        } actions: {
          Button("Sign in with email") { showSignIn = true }
            .buttonStyle(.glassProminent)
            .tint(Theme.accent)
            .foregroundStyle(Theme.onAccent)
        }
      } else if model.incidents.isEmpty {
        ContentUnavailableView(
          "Nothing caught yet", systemImage: "checkmark.shield",
          description: Text("When Squeek blocks a call, filters a text or warns you on your computer, it shows up here."))
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 22) {
            WeekSummary(incidents: model.incidents)
            ForEach(groups, id: \.title) { group in
              VStack(alignment: .leading, spacing: 10) {
                Text(group.title).font(.nunito(.headline)).foregroundStyle(Theme.secondaryInk)
                VStack(spacing: 0) {
                  ForEach(Array(group.items.enumerated()), id: \.element.id) { index, incident in
                    NavigationLink { IncidentDetailView(incident: incident) } label: {
                      IncidentRow(incident: incident)
                        .padding(.vertical, 12)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    if index < group.items.count - 1 { Divider().padding(.leading, 56) }
                  }
                }
                .card(padding: 14)
              }
            }
          }
          .padding(.horizontal, Theme.pagePadding)
          .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
      }
    }
    .screenBackground()
    .navigationTitle("Activity")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        NavigationLink { BlockedView() } label: {
          Label("Blocked", systemImage: "hand.raised.fill")
        }
      }
    }
    .refreshable { await model.refreshAll() }
    .sheet(isPresented: $showSignIn) { EmailSignInView() }
  }
}

/// Count of warnings in the last 7 days, with a small bar chart.
struct WeekSummary: View {
  let incidents: [Incident]

  private struct Day: Identifiable {
    let date: Date
    let count: Int
    var id: Date { date }
  }

  private var days: [Day] {
    let calendar = Calendar.current
    let today = calendar.startOfDay(for: Date())
    return (0..<7).reversed().map { offset in
      let day = calendar.date(byAdding: .day, value: -offset, to: today)!
      let count = incidents.filter { $0.date.map { calendar.isDate($0, inSameDayAs: day) } ?? false }.count
      return Day(date: day, count: count)
    }
  }

  var body: some View {
    let total = days.reduce(0) { $0 + $1.count }
    HStack(alignment: .bottom, spacing: 18) {
      VStack(alignment: .leading, spacing: 4) {
        Text("This week").font(.nunito(.subheadline, .semibold)).foregroundStyle(Theme.secondaryInk)
        Text("\(total)")
          .font(.nunito(size: 44, weight: .black))
          .foregroundStyle(Theme.ink)
          .contentTransition(.numericText(value: Double(total)))
        Text(total == 1 ? "warning" : "warnings").font(.nunito(.subheadline)).foregroundStyle(Theme.secondaryInk)
      }
      Chart(days) { day in
        BarMark(x: .value("Day", day.date, unit: .day), y: .value("Warnings", day.count))
          .foregroundStyle(day.count > 0 ? Theme.danger : Theme.neutralSoft)
          .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
      }
      .chartXAxis {
        AxisMarks(values: .stride(by: .day)) { _ in
          AxisValueLabel(format: .dateTime.weekday(.narrow))
        }
      }
      .chartYAxis(.hidden)
      .frame(height: 90)
    }
    .card(padding: 20)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("\(total) warnings this week")
  }
}

struct IncidentRow: View {
  @EnvironmentObject private var model: AppModel
  let incident: Incident

  var body: some View {
    let status = Theme.status(incident.level)
    HStack(alignment: .top, spacing: 14) {
      IconBadge(symbol: Labels.surfaceSymbol(incident.surface), tint: status.tint, soft: status.soft)
      VStack(alignment: .leading, spacing: 3) {
        HStack(alignment: .firstTextBaseline) {
          Text(title).font(.nunito(.headline)).foregroundStyle(Theme.ink)
          Spacer()
          if let date = incident.date {
            Text(date.formatted(.relative(presentation: .named)))
              .font(.nunito(.caption))
              .foregroundStyle(Theme.secondaryInk)
          }
        }
        Text(subtitle).font(.nunito(.subheadline)).foregroundStyle(Theme.secondaryInk)
        if let evidence = incident.evidenceRedacted ?? incident.indicatorValue.map(display) {
          Text(evidence).font(.nunito(.subheadline)).lineLimit(2).foregroundStyle(Theme.ink.opacity(0.8))
        }
      }
      Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(Theme.secondaryInk)
        .padding(.top, 4)
    }
    .accessibilityElement(children: .combine)
  }

  private var title: String {
    if incident.userAction == "reported" { return "You reported a scam" }
    return Labels.level(incident.level)
  }

  private var subtitle: String {
    var parts = [Labels.surface(incident.surface), "on your \(Labels.platform(incident.platform))"]
    if incident.userId != model.userId {
      parts = [model.memberName(incident.userId) ?? "Family member", Labels.surface(incident.surface).lowercased()]
    }
    return parts.joined(separator: " · ")
  }

  private func display(_ value: String) -> String {
    incident.indicatorKind == "phone" ? PhoneNumbers.display(value) : value
  }
}

struct IncidentDetailView: View {
  @EnvironmentObject private var model: AppModel
  let incident: Incident

  var body: some View {
    let current = model.incidents.first { $0.id == incident.id } ?? incident
    let status = Theme.status(current.level)
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        VStack(alignment: .leading, spacing: 12) {
          Label {
            Text(status.label).font(.nunito(.headline)).foregroundStyle(status.ink)
          } icon: {
            Image(systemName: status.symbol)
              .font(.system(size: 16, weight: .bold))
              .foregroundStyle(.white)
              .frame(width: 34, height: 34)
              .background(status.tint, in: RoundedRectangle(cornerRadius: 11, style: .continuous))
          }
          Text(Labels.surface(current.surface))
            .font(.display(.title))
            .foregroundStyle(Theme.ink)
          HStack(spacing: 8) {
            Label(Labels.platform(current.platform), systemImage: Labels.platformSymbol(current.platform))
            if let date = current.date {
              Text("·")
              Text(date.formatted(date: .abbreviated, time: .shortened))
            }
          }
          .font(.nunito(.subheadline))
          .foregroundStyle(Theme.secondaryInk)
        }
        .card(padding: 20, tint: status.soft)

        if let tactic = current.categories.lazy.compactMap(Labels.tactic).first {
          VStack(alignment: .leading, spacing: 8) {
            SectionHeader("What's going on")
            Text(tactic).font(.nunito(.title3)).foregroundStyle(Theme.ink)
              .fixedSize(horizontal: false, vertical: true)
          }
          .card()
        }

        if !current.categories.isEmpty {
          VStack(alignment: .leading, spacing: 10) {
            SectionHeader("Warning signs")
            FlowLayout(spacing: 8) {
              ForEach(current.categories, id: \.self) { Tag(text: Labels.category($0)) }
            }
          }
        }

        if let evidence = current.evidenceRedacted {
          VStack(alignment: .leading, spacing: 8) {
            Text("“\(evidence)”").font(.nunito(.title3)).foregroundStyle(Theme.ink)
            Text("Private details like phone numbers and codes are removed before anything is saved.")
              .font(.nunito(.footnote))
              .foregroundStyle(Theme.secondaryInk)
          }
          .card()
        }

        if let action = current.userAction {
          Label("Marked \(action.replacingOccurrences(of: "_", with: " "))", systemImage: "checkmark.circle.fill")
            .font(.nunito(.subheadline, .semibold))
            .foregroundStyle(Theme.accentInk)
        }
      }
      .padding(Theme.pagePadding)
    }
    .screenBackground()
    .navigationTitle("Warning")
    .navigationBarTitleDisplayMode(.inline)
    .safeAreaInset(edge: .bottom) {
      if current.userId == model.userId {
        VStack(spacing: 10) { actions(current) }
          .padding(.horizontal, Theme.pagePadding)
          .padding(.bottom, 8)
      }
    }
  }

  @ViewBuilder
  private func actions(_ incident: Incident) -> some View {
    if incident.userAction == nil {
      Button("I've dealt with this") { Task { await model.setAction("reviewed", forIncident: incident.id) } }
        .primaryAction()
    }
    if let kind = incident.indicatorKind, let value = incident.indicatorValue, !model.isBlocked(kind: kind, value: value) {
      Button(kind == "phone" ? "Block this number" : "Block this website", systemImage: "hand.raised.fill") {
        Task {
          if await model.addBlock(kind: kind, rawValue: value, label: nil, shareWithFamily: model.household != nil, report: false) {
            await model.setAction("blocked", forIncident: incident.id)
          }
        }
      }
      .secondaryAction()
    }
  }
}
