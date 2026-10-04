import SqueekCore
import SwiftUI

/// Everything Squeek caught on this iPhone, the computer, and for people you help. The block list
/// sits behind the toolbar button, since it's what Squeek acts on rather than something to watch.
struct ActivityView: View {
  @EnvironmentObject private var model: AppModel
  @State private var showSignIn = false

  /// Likely scams nobody has looked at yet, from the last few days. They get their own place at the top.
  private var needsLook: [Incident] {
    let lately = Date().addingTimeInterval(-3 * 24 * 3600)
    // Two at most: a screen full of red boxes is alarming, and the rest are still in the list below.
    return Array(
      model.incidents.filter { $0.level == .danger && $0.userAction == nil && ($0.date ?? .distantPast) > lately }.prefix(2))
  }

  private var groups: [(title: String, items: [Incident])] {
    let calendar = Calendar.current
    let pending = Set(needsLook.map(\.id))
    var order: [String] = []
    var buckets: [String: [Incident]] = [:]
    for incident in model.incidents where !pending.contains(incident.id) {
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
          VStack(alignment: .leading, spacing: 26) {
            ActivityHeader(incidents: model.incidents)

            if !needsLook.isEmpty {
              VStack(alignment: .leading, spacing: 10) {
                Text("Worth a look").font(.nunito(.title3, .black)).foregroundStyle(Theme.ink)
                ForEach(needsLook) { incident in
                  NavigationLink { IncidentDetailView(incident: incident) } label: {
                    AttentionCard(incident: incident)
                  }
                  .buttonStyle(.plain)
                }
              }
            }

            ForEach(groups, id: \.title) { group in
              VStack(alignment: .leading, spacing: 0) {
                Text(group.title).font(.nunito(.title3, .black)).foregroundStyle(Theme.ink).padding(.bottom, 4)
                ForEach(Array(group.items.enumerated()), id: \.element.id) { index, incident in
                  NavigationLink { IncidentDetailView(incident: incident) } label: {
                    ActivityRow(incident: incident)
                  }
                  .buttonStyle(.plain)
                  if index < group.items.count - 1 { Rectangle().fill(Theme.hairline).frame(height: 1) }
                }
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

/// Squeek says how the week went, in his own words, with the mascot beside it.
private struct ActivityHeader: View {
  let incidents: [Incident]

  private var flagged: Int {
    let since = Date().addingTimeInterval(-7 * 24 * 3600)
    return incidents.filter { ($0.level == .danger || $0.level == .caution) && ($0.date ?? .distantPast) > since }.count
  }

  var body: some View {
    HStack(alignment: .center, spacing: 14) {
      VStack(alignment: .leading, spacing: 4) {
        Text(flagged == 0 ? "A quiet week." : flagged == 1 ? "I flagged 1 thing this week." : "I flagged \(flagged) things this week.")
          .font(.nunito(size: 26, weight: .black))
          .foregroundStyle(Theme.ink)
          .fixedSize(horizontal: false, vertical: true)
        Text("Here's everything I've noticed.")
          .font(.nunito(.subheadline))
          .foregroundStyle(Theme.secondaryInk)
      }
      Spacer(minLength: 0)
      MascotView(mood: .calm, height: 64)
    }
    .accessibilityElement(children: .combine)
  }
}

/// How an incident reads in a sentence, shared by the two Activity row styles.
@MainActor
private struct IncidentWords {
  let incident: Incident
  let model: AppModel

  var isMine: Bool { incident.userId == model.userId }

  /// With its article: "a text", "an email".
  private var noun: String {
    switch incident.surface {
    case "sms": return "text"
    case "email": return "email"
    case "call": return "call"
    case "link", "browser": return "website"
    case "screenshot": return "screenshot"
    default: return "message"
    }
  }

  private var article: String { noun == "email" ? "An" : "A" }

  var title: String {
    let who = isMine ? "" : (model.memberName(incident.userId) ?? "Someone you help") + ": "
    if incident.userAction == "reported" { return "You reported a number" }
    if incident.isScreenedCall {
      switch incident.level {
      case .danger: return who + "Squeek answered a scam call"
      case .caution: return who + "Squeek answered a call that seemed off"
      default: return who + "Squeek took a message"
      }
    }
    switch incident.level {
    case .danger: return who + "\(article) \(noun) that looked like a scam"
    case .caution: return who + "\(article) \(noun) that seemed off"
    case .clear: return who + "\(article) \(noun) with no warning signs"
    case .unknown: return who + "\(article) \(noun) Squeek couldn't fully check"
    }
  }

  var detail: String? {
    guard let text = incident.evidenceRedacted ?? incident.indicatorValue.map({ incident.indicatorKind == "phone" ? PhoneNumbers.display($0) : $0 })
    else { return nil }
    return text
  }

  var when: String {
    guard let date = incident.date else { return "" }
    let time = Date().timeIntervalSince(date) < 3600
      ? date.formatted(.relative(presentation: .named))
      : date.formatted(date: .omitted, time: .shortened)
    let place = incident.platform == "windows" ? "on your PC" : nil
    return [time, place].compactMap { $0 }.joined(separator: " · ")
  }
}

/// One line of the feed: a dot for how serious it was, then a sentence. No boxes around each one.
private struct ActivityRow: View {
  @EnvironmentObject private var model: AppModel
  let incident: Incident

  var body: some View {
    let words = IncidentWords(incident: incident, model: model)
    let status = Theme.status(incident.level)
    HStack(alignment: .top, spacing: 14) {
      Circle().fill(status.tint).frame(width: 10, height: 10).padding(.top, 7).accessibilityHidden(true)
      VStack(alignment: .leading, spacing: 3) {
        Text(words.title).font(.nunito(.headline)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
        if let detail = words.detail {
          Text(detail).font(.nunito(.subheadline)).foregroundStyle(Theme.ink.opacity(0.75)).lineLimit(2)
        }
        Text(words.when).font(.nunito(.footnote)).foregroundStyle(Theme.secondaryInk)
      }
      Spacer(minLength: 0)
    }
    .padding(.vertical, 14)
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
  }
}

/// A likely scam nobody has looked at yet: the one place a box earns its keep.
private struct AttentionCard: View {
  @EnvironmentObject private var model: AppModel
  let incident: Incident

  var body: some View {
    let words = IncidentWords(incident: incident, model: model)
    VStack(alignment: .leading, spacing: 8) {
      Text(words.title)
        .font(.nunito(.title3, .black))
        .foregroundStyle(Theme.dangerInk)
        .fixedSize(horizontal: false, vertical: true)
      if let detail = words.detail {
        Text(detail).font(.nunito(.body)).foregroundStyle(Theme.ink).lineLimit(3)
      }
      HStack {
        Text(words.when).font(.nunito(.footnote)).foregroundStyle(Theme.secondaryInk)
        Spacer()
        Text("See what happened").font(.nunito(.subheadline, .bold)).foregroundStyle(Theme.dangerInk)
        Image(systemName: "arrow.right").font(.footnote.weight(.bold)).foregroundStyle(Theme.dangerInk)
      }
    }
    .card(padding: 18, tint: Theme.dangerSoft)
    .accessibilityElement(children: .combine)
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
    if incident.isScreenedCall && incident.level == .clear { return "Squeek took a message" }
    return Labels.level(incident.level)
  }

  private var subtitle: String {
    var parts = [Labels.surface(incident.surface), "on your \(Labels.platform(incident.platform))"]
    if incident.isScreenedCall { parts = ["Call Squeek answered"] }
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
  @State private var call: ScreenedCall?

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
          Text(current.isScreenedCall ? (current.level == .clear ? "Squeek took a message" : "Call Squeek answered") : Labels.surface(current.surface))
            .font(.display(.title))
            .foregroundStyle(Theme.ink)
          HStack(spacing: 8) {
            if current.isScreenedCall, let number = current.indicatorValue {
              Label(PhoneNumbers.display(number), systemImage: "phone.fill")
            } else {
              Label(Labels.platform(current.platform), systemImage: Labels.platformSymbol(current.platform))
            }
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

        if let call {
          CallDetails(call: call)
        } else if let evidence = current.evidenceRedacted {
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
    .navigationTitle(incident.isScreenedCall ? "Call" : "Warning")
    .task { if incident.isScreenedCall { call = await model.screenedCall(forIncident: incident.id) } }
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

/// What a caller told Squeek's phone agent. Only these notes are kept, never the recording.
private struct CallDetails: View {
  let call: ScreenedCall

  var body: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader("What they told Squeek")
      if let claims = call.callerClaims { row("Said they were", claims) }
      if let wants = call.callerWants { row("Wanted", wants) }
      if let callback = call.callbackE164 {
        row("Call back on", PhoneNumbers.display(callback))
        if call.risk == "clear", let url = URL(string: "tel:\(callback)") {
          Link(destination: url) { Label("Call them back", systemImage: "phone.fill") }
            .font(.nunito(.headline))
        }
      }
      if let safeWord = safeWordLine { row("Family safe word", safeWord) }
      if let seconds = call.durationSecs, seconds > 0 {
        Text("Squeek spoke with them for \(Duration.seconds(seconds).formatted(.units(allowed: [.minutes, .seconds], width: .wide))). The call itself isn't kept.")
          .font(.nunito(.footnote))
          .foregroundStyle(Theme.secondaryInk)
      }
    }
    .card()
  }

  private var safeWordLine: String? {
    switch call.safeWord {
    case "matched": return "Knew it"
    case "wrong": return "Gave the wrong word"
    case "not_given": return "Didn't know it"
    case "not_set": return "Not set yet. Add one in My Person so Squeek can check next time."
    default: return nil
    }
  }

  private func row(_ title: String, _ value: String) -> some View {
    VStack(alignment: .leading, spacing: 2) {
      Text(title).font(.nunito(.subheadline, .semibold)).foregroundStyle(Theme.secondaryInk)
      Text(value).font(.nunito(.title3)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
    }
    .accessibilityElement(children: .combine)
  }
}
