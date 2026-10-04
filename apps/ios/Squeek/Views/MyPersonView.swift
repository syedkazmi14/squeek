import SqueekCore
import SwiftUI

/// The person you trust, or the people you look out for. Under the hood this is a family group:
/// members share blocked numbers and websites, and helpers see the protected person's warnings
/// only if that person turns sharing on.
struct MyPersonView: View {
  @EnvironmentObject private var model: AppModel
  @State private var showSignIn = false
  @State private var joinCode = ""
  @State private var invite: (code: String, role: String)?
  @State private var inviteRole = "helper"
  @State private var confirmLeave = false

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
              inviteCard
              sharingCard
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
            set: { on in Task { await model.updateProfile { $0.shareIncidentsWithHelpers = on } } })
        ) {
          Text("Share my warnings with helpers").font(.nunito(.headline))
        }
        .tint(Theme.accent)
        Text("Helpers see the kind of warning and a short excerpt with private details removed. They can't read your messages.")
          .font(.nunito(.subheadline))
          .foregroundStyle(Theme.secondaryInk)
      }
      .card(padding: 20)
    }
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

/// A coloured initial in a circle.
struct Avatar: View {
  let name: String
  var helper = false

  var body: some View {
    Text(String(name.prefix(1)).uppercased())
      .font(.nunito(.title3, .bold))
      .foregroundStyle(helper ? Theme.ochre : Theme.accentInk)
      .frame(width: 46, height: 46)
      .background(helper ? Theme.ochreSoft : Theme.accentSoft, in: Circle())
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
