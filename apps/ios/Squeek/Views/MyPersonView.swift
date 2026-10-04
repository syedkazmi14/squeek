import SqueekCore
import SwiftUI

/// The person you trust, or the people you look out for. Under the hood this is a family group:
/// members share blocked numbers and websites, and helpers see the protected person's warnings
/// only if that person turns sharing on.
struct MyPersonView: View {
  @EnvironmentObject private var model: AppModel
  @State private var showSignIn = false
  @State private var joinCode = ""
  @State private var safeWord = ""
  @State private var safeWordSaved = false
  @State private var invite: (code: String, role: String)?
  @State private var inviteRole = "helper"
  @State private var confirmLeave = false
  @State private var showShareExplainer = false

  var body: some View {
    Group {
      if !model.showsAccountData {
        ContentUnavailableView {
          Label("Bring in someone you trust", systemImage: "person.2.fill")
        } description: {
          Text("Sign in so a family member or friend can help you check things and see when Squeek warns you.")
        } actions: {
          Button("Sign in with email") { showSignIn = true }
            .buttonStyle(.glassProminent)
            .tint(Theme.accent)
            .foregroundStyle(Theme.onAccent)
        }
      } else {
        ScrollView {
          VStack(alignment: .leading, spacing: 20) {
            if let household = model.household {
              membersCard(household.name)
              if !model.peopleIHelp.isEmpty { peopleIHelpCard }
              phoneCard
              inviteCard
              sharingCard
              safeWordCard
              if !model.helperDevices.isEmpty { theirDevicesCard }
              devicesCard
              Button("Leave this group", role: .destructive) { confirmLeave = true }
                .font(.nunito(.subheadline, .semibold))
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
            } else {
              hero
              inviteFirstCard
              joinCard
              devicesCard
            }
          }
          .padding(.horizontal, Theme.pagePadding)
          .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
      }
    }
    .screenBackground()
    .navigationTitle("My Person")
    .refreshable { await model.refreshAll() }
    .sheet(isPresented: $showSignIn) { EmailSignInView() }
    .sheet(isPresented: $showShareExplainer) {
      ShareExplainerView {
        Task { await model.updateProfile { $0.shareIncidentsWithHelpers = true } }
      }
    }
    .confirmationDialog("Leave this group?", isPresented: $confirmLeave, titleVisibility: .visible) {
      Button("Leave", role: .destructive) { Task { await model.leaveHousehold() } }
    } message: {
      Text("You'll stop sharing blocked numbers and warnings with this group.")
    }
  }

  // MARK: In a group

  private func membersCard(_ name: String) -> some View {
    VStack(alignment: .leading, spacing: 16) {
      Text(name).font(.display(.title2)).foregroundStyle(Theme.ink)
      ForEach(model.members) { member in
        HStack(spacing: 14) {
          Avatar(name: member.displayName ?? "?", helper: member.role == "helper")
          VStack(alignment: .leading, spacing: 2) {
            Text((member.displayName ?? "Family member") + (member.isMe ? " (you)" : ""))
              .font(.nunito(.headline))
              .foregroundStyle(Theme.ink)
            Text(member.role == "helper" ? "Your trusted person" : "Protected by Squeek")
              .font(.nunito(.subheadline))
              .foregroundStyle(Theme.secondaryInk)
          }
        }
        .accessibilityElement(children: .combine)
      }
      if model.profile?.displayName == nil { NameField() }
    }
    .card(padding: 20)
  }

  private var inviteCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader("Invite someone")
      if let invite {
        Text(invite.code)
          .font(.nunito(size: 40, weight: .black))
          .kerning(8)
          .foregroundStyle(Theme.accentInk)
          .frame(maxWidth: .infinity)
          .padding(.vertical, 14)
          .background(Theme.accentSoft, in: RoundedRectangle(cornerRadius: Theme.smallCorner, style: .continuous))
          .accessibilityLabel(invite.code.map(String.init).joined(separator: " "))
        Text("They enter this in Squeek › My Person. It works once, for 24 hours.")
          .font(.nunito(.subheadline))
          .foregroundStyle(Theme.secondaryInk)
        ShareLink(item: "Will you be my trusted person on Squeek? Open Squeek, go to My Person, and enter \(invite.code)") {
          Label("Send the code", systemImage: "square.and.arrow.up")
        }
        .secondaryAction()
      } else {
        Picker("Invite as", selection: $inviteRole) {
          Text("A helper").tag("helper")
          Text("Someone to protect").tag("protected")
        }
        .pickerStyle(.segmented)
        Button("Create an invite code") {
          Task {
            if let code = await model.createInvite(role: inviteRole) {
              withAnimation(.spring) { invite = (code, inviteRole) }
            }
          }
        }
        .primaryAction()
      }
    }
    .card(padding: 20)
  }

  @ViewBuilder
  private var sharingCard: some View {
    if let profile = model.profile, model.myRole == "protected" {
      VStack(alignment: .leading, spacing: 8) {
        Toggle(
          isOn: Binding(
            get: { profile.shareIncidentsWithHelpers },
            // Turning it on shows exactly what helpers will see first; turning it off is immediate.
            set: { on in
              if on { showShareExplainer = true } else { Task { await model.updateProfile { $0.shareIncidentsWithHelpers = false } } }
            })
        ) {
          Text("Share my warnings with helpers").font(.nunito(.headline))
        }
        .tint(Theme.accent)
        Text("Helpers see the kind of warning and a short excerpt with private details removed. They can't read your messages.")
          .font(.nunito(.subheadline))
          .foregroundStyle(Theme.secondaryInk)
        Button("See exactly what they'll see") { showShareExplainer = true }
          .font(.nunito(.subheadline, .semibold))
      }
      .card(padding: 20)
    }
  }

  /// The word Squeek's phone agent asks callers who say they're family (grandparent scams).
  private var safeWordCard: some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(title: "Family safe word") {
        Text(model.hasSafeWord ? "Set" : "Not set")
          .font(.nunito(.caption, .bold))
          .foregroundStyle(model.hasSafeWord ? Theme.safe : Theme.ochre)
          .padding(.horizontal, 10)
          .padding(.vertical, 4)
          .background(model.hasSafeWord ? Theme.safeSoft : Theme.ochreSoft, in: Capsule())
      }
      Text("When someone calls saying they're family, Squeek asks them for this word. Pick something only your family would know, and share it in person, not by text.")
        .font(.nunito(.subheadline))
        .foregroundStyle(Theme.secondaryInk)
        .fixedSize(horizontal: false, vertical: true)
      HStack {
        SecureField(model.hasSafeWord ? "Change the word" : "Choose a word", text: $safeWord)
          .padding(12)
          .background(Theme.ground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        Button("Save") {
          Task {
            if await model.setSafeWord(safeWord) {
              safeWord = ""
              withAnimation { safeWordSaved = true }
            }
          }
        }
        .buttonStyle(.glass)
        .disabled(safeWord.trimmingCharacters(in: .whitespaces).isEmpty)
      }
      if safeWordSaved {
        Label("Saved. Squeek keeps only a scrambled copy, so nobody can read it back.", systemImage: "checkmark.circle.fill")
          .font(.nunito(.footnote))
          .foregroundStyle(Theme.accentInk)
      }
      if model.hasSafeWord {
        Button("Remove the safe word", role: .destructive) { Task { _ = await model.setSafeWord("") } }
          .font(.nunito(.subheadline, .semibold))
      }
    }
    .card(padding: 20)
  }

  private var theirDevicesCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader("Their devices")
      ForEach(model.helperDevices) { device in
        HStack(spacing: 14) {
          IconBadge(symbol: Labels.platformSymbol(device.platform))
          VStack(alignment: .leading, spacing: 2) {
            Text("\(device.displayName ?? "Family member")'s \(Labels.platform(device.platform))").font(.nunito(.headline))
            Text(
              [device.monitoringStatus, device.lastSeenAt.flatMap(Timestamps.parse).map { "seen \($0.formatted(.relative(presentation: .named)))" }]
                .compactMap { $0 }.joined(separator: " · ")
            )
            .font(.nunito(.subheadline))
            .foregroundStyle(Theme.secondaryInk)
          }
        }
      }
    }
    .card(padding: 20)
  }

  // MARK: Not in a group

  private var hero: some View {
    VStack(alignment: .leading, spacing: 10) {
      Image(systemName: "figure.2.and.child.holdinghands")
        .font(.system(size: 44, weight: .medium))
        .foregroundStyle(Theme.accentInk)
      Text("Who do you trust?").font(.display(.title)).foregroundStyle(Theme.ink)
      Text("Scammers count on you deciding alone. Pick a family member or friend who can help you check, and who hears from Squeek when something looks wrong.")
        .font(.nunito(.title3))
        .foregroundStyle(Theme.secondaryInk)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.top, 8)
  }

  /// Starts a group with this person as the one protected, then shows a helper invite code.
  private var inviteFirstCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader("Invite your person")
      Text("You'll get a code to send them. You choose whether they see your warnings.")
        .font(.nunito(.subheadline))
        .foregroundStyle(Theme.secondaryInk)
      Button("Get an invite code") {
        Task {
          await model.createHousehold(name: "My people", role: "protected")
          if let code = await model.createInvite(role: "helper") {
            withAnimation(.spring) { invite = (code, "helper") }
          }
        }
      }
      .primaryAction()
    }
    .card(padding: 20)
  }

  private var joinCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader("Someone asked you to be their person?")
      TextField("6-letter code", text: $joinCode)
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
        .font(.nunito(.title2).monospaced())
        .padding(14)
        .background(Theme.ground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      Button("Join") {
        Task { if await model.joinHousehold(code: joinCode) { joinCode = "" } }
      }
      .secondaryAction()
      .disabled(joinCode.trimmingCharacters(in: .whitespaces).count < 6)
    }
    .card(padding: 20)
  }
}

extension MyPersonView {
  /// The people this helper looks out for: check in, call, and see the warnings they share.
  fileprivate var peopleIHelpCard: some View {
    VStack(alignment: .leading, spacing: 20) {
      SectionHeader("People you look out for")
      ForEach(model.peopleIHelp) { person in
        PersonIHelp(person: person)
        if person.id != model.peopleIHelp.last?.id { Divider() }
      }
    }
    .card(padding: 20)
  }

  /// Where Squeek phones this person: when a call looks like a scam, or a person they help is in trouble.
  fileprivate var phoneCard: some View {
    PhoneCard()
  }

  /// This person's own devices, and pairing the Squeek computer app.
  fileprivate var devicesCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader("Your devices")
      ForEach(model.myDevices) { device in
        HStack(spacing: 14) {
          IconBadge(symbol: Labels.platformSymbol(device.platform))
          VStack(alignment: .leading, spacing: 2) {
            Text(device.name ?? Labels.platform(device.platform)).font(.nunito(.headline))
            if let status = device.monitoringStatus {
              Text(status).font(.nunito(.subheadline)).foregroundStyle(Theme.secondaryInk)
            }
          }
        }
        .accessibilityElement(children: .combine)
      }
      NavigationLink { PairComputerView() } label: {
        Label("Connect a computer", systemImage: "desktopcomputer")
      }
      .secondaryAction()
    }
    .card(padding: 20)
  }
}

/// A person's picture if there is one (the demo family has them), otherwise a coloured initial.
struct Avatar: View {
  let name: String
  var helper = false
  var size: CGFloat = 46

  var body: some View {
    Group {
      if let picture = UIImage(named: "Avatar\(name.split(separator: " ").first.map(String.init) ?? name)") {
        Image(uiImage: picture)
          .resizable()
          .scaledToFill()
      } else {
        Text(String(name.prefix(1)).uppercased())
          .font(.nunito(.title3, .bold))
          .foregroundStyle(helper ? Theme.ochre : Theme.accentInk)
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(helper ? Theme.ochreSoft : Theme.accentSoft)
      }
    }
    .frame(width: size, height: size)
    .clipShape(Circle())
    .accessibilityHidden(true)
  }
}

private struct NameField: View {
  @EnvironmentObject private var model: AppModel
  @State private var name = ""

  var body: some View {
    HStack {
      TextField("Your first name (shown to family)", text: $name)
        .padding(12)
        .background(Theme.ground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
      Button("Save") { Task { await model.setDisplayName(name) } }
        .buttonStyle(.glass)
        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
    }
  }
}

/// One person a helper looks out for.
private struct PersonIHelp: View {
  @EnvironmentObject private var model: AppModel
  let person: HouseholdMember

  var body: some View {
    let name = person.displayName ?? "Your person"
    let checkIn = model.latestCheckIn(of: person.userId)
    let sharing = model.contacts[person.userId]?.shareIncidentsWithHelpers == true
    let warnings = model.incidents.filter { $0.userId == person.userId }.prefix(3)

    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 14) {
        Avatar(name: name)
        VStack(alignment: .leading, spacing: 2) {
          Text(name).font(.nunito(.headline)).foregroundStyle(Theme.ink)
          Text(statusLine(checkIn, name: name))
            .font(.nunito(.subheadline))
            .foregroundStyle(checkIn?.status == "call_me" ? Theme.ochre : Theme.secondaryInk)
        }
      }
      .accessibilityElement(children: .combine)

      VStack(spacing: 10) {
        if checkIn?.isOpen() == true {
          Label("Waiting for \(name) to answer", systemImage: "hourglass")
            .font(.nunito(.subheadline, .semibold))
            .foregroundStyle(Theme.secondaryInk)
            .frame(maxWidth: .infinity, alignment: .leading)
        } else {
          Button("Check in on \(name)") { Task { await model.askCheckIn(of: person.userId) } }
            .primaryAction()
        }
        if let phone = model.phone(of: person.userId), let url = URL(string: "tel:\(phone)") {
          Link(destination: url) { Label("Call \(name)", systemImage: "phone.fill") }
            .secondaryAction()
        } else {
          Text("\(name) hasn't added a phone number yet.")
            .font(.nunito(.footnote))
            .foregroundStyle(Theme.secondaryInk)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
      }

      if sharing {
        if warnings.isEmpty {
          Text("No warnings lately.").font(.nunito(.subheadline)).foregroundStyle(Theme.secondaryInk)
        } else {
          Text("Recent warnings").font(.nunito(.subheadline, .bold)).foregroundStyle(Theme.ink)
          ForEach(Array(warnings)) { incident in
            NavigationLink { IncidentDetailView(incident: incident) } label: {
              IncidentRow(incident: incident).contentShape(Rectangle())
            }
            .buttonStyle(.plain)
          }
        }
      } else {
        Text("\(name) hasn't chosen to share warnings with you, so you won't see them here.")
          .font(.nunito(.footnote))
          .foregroundStyle(Theme.secondaryInk)
      }
    }
  }

  private func statusLine(_ checkIn: CheckIn?, name: String) -> String {
    guard let checkIn else { return "Protected by Squeek" }
    let when = (checkIn.answerDate ?? checkIn.date)?.formatted(.relative(presentation: .named)) ?? "recently"
    switch checkIn.status {
    case "ok": return "Said they're OK \(when)"
    case "call_me": return "Asked you to call \(when)"
    default: return checkIn.isOpen() ? "Asked if they're OK \(when)" : "Protected by Squeek"
    }
  }
}

/// "Your phone number": where Squeek phones this person with what it found.
private struct PhoneCard: View {
  @EnvironmentObject private var model: AppModel
  @State private var phone = ""
  @State private var saved = false

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(title: "Your phone number") {
        let set = model.profile?.alertPhone != nil
        Text(set ? "Set" : "Not set")
          .font(.nunito(.caption, .bold))
          .foregroundStyle(set ? Theme.safe : Theme.ochre)
          .padding(.horizontal, 10)
          .padding(.vertical, 4)
          .background(set ? Theme.safeSoft : Theme.ochreSoft, in: Capsule())
      }
      Text(model.myRole == "helper"
        ? "Squeek phones this number when someone you look out for gets a scam call, is about to pay after one, or when their check-in needs you."
        : "Squeek phones this number to tell you what it found, so you hear even when your phone is locked.")
        .font(.nunito(.subheadline))
        .foregroundStyle(Theme.secondaryInk)
        .fixedSize(horizontal: false, vertical: true)
      HStack {
        TextField(model.profile?.alertPhone.map { PhoneNumbers.display($0) } ?? "Your mobile number", text: $phone)
          .keyboardType(.phonePad)
          .textContentType(.telephoneNumber)
          .padding(12)
          .background(Theme.ground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        Button("Save") {
          Task {
            if await model.setAlertPhone(phone) {
              phone = ""
              withAnimation { saved = true }
            }
          }
        }
        .buttonStyle(.glass)
        .disabled(phone.trimmingCharacters(in: .whitespaces).isEmpty)
      }
      if saved {
        Label("Saved.", systemImage: "checkmark.circle.fill")
          .font(.nunito(.footnote))
          .foregroundStyle(Theme.accentInk)
      }
    }
    .card(padding: 20)
  }
}

/// Shown before "Share my warnings with helpers" turns on: exactly what helpers will and won't see.
private struct ShareExplainerView: View {
  var onShare: () -> Void
  @Environment(\.dismiss) private var dismiss

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 18) {
          Text("What your helpers will see")
            .font(.display(.title))
            .foregroundStyle(Theme.ink)

          VStack(alignment: .leading, spacing: 14) {
            point("checkmark.circle.fill", Theme.safe, "That Squeek warned you, what kind of warning it was, and when.")
            point("checkmark.circle.fill", Theme.safe, "A short piece of what was said, with phone numbers, names and amounts taken out.")
            point("checkmark.circle.fill", Theme.safe, "Squeek phones them when a call looks like a scam, or if you go ahead and pay after one, so they can call you.")
          }
          .card(padding: 18)

          VStack(alignment: .leading, spacing: 8) {
            Text("Example").font(.nunito(.footnote, .bold)).foregroundStyle(Theme.secondaryInk)
            Text("Likely scam call · 10 minutes ago")
              .font(.nunito(.headline))
              .foregroundStyle(Theme.ink)
            Text("Said they were a grandson · asked for gift cards")
              .font(.nunito(.subheadline))
              .foregroundStyle(Theme.ink.opacity(0.8))
          }
          .card(padding: 18, tint: Theme.accentSoft)

          Text("What they won't see").font(.nunito(.title3, .bold)).foregroundStyle(Theme.ink)
          VStack(alignment: .leading, spacing: 14) {
            point("xmark.circle.fill", Theme.danger, "Your messages, emails, photos or screenshots.")
            point("xmark.circle.fill", Theme.danger, "A recording or a written copy of any call.")
            point("xmark.circle.fill", Theme.danger, "Where you are, or anything else on your phone.")
            point("xmark.circle.fill", Theme.danger, "Your family safe word.")
          }
          .card(padding: 18)

          Text("You can turn this off any time.")
            .font(.nunito(.subheadline))
            .foregroundStyle(Theme.secondaryInk)

          VStack(spacing: 10) {
            Button("Share my warnings") {
              onShare()
              dismiss()
            }
            .primaryAction()
            Button("Not now") { dismiss() }
              .secondaryAction()
          }
        }
        .padding(.horizontal, Theme.pagePadding)
        .padding(.bottom, 24)
      }
      .scrollIndicators(.hidden)
      .screenBackground()
    }
  }

  private func point(_ symbol: String, _ tint: Color, _ text: String) -> some View {
    HStack(alignment: .top, spacing: 12) {
      Image(systemName: symbol).font(.title3).foregroundStyle(tint).accessibilityHidden(true)
      Text(text)
        .font(.nunito(.body))
        .foregroundStyle(Theme.ink)
        .fixedSize(horizontal: false, vertical: true)
    }
  }
}
