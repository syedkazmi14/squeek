import SqueekCore
import SwiftUI

/// A family group shares blocked numbers and websites. Helpers can also see the protected person's
/// warnings, but only if that person turns sharing on.
struct FamilyView: View {
  @EnvironmentObject private var model: AppModel
  @State private var groupName = "My family"
  @State private var role = "protected"
  @State private var joinCode = ""
  @State private var invite: (code: String, role: String)?
  @State private var inviteRole = "helper"
  @State private var confirmLeave = false

  var body: some View {
    Group {
      if !model.showsAccountData {
        ContentUnavailableView {
          Label("Protect each other", systemImage: "person.2.fill")
        } description: {
          Text("Sign in to share blocked numbers with family and let someone you trust see your warnings.")
        } actions: {
          Button("Go to Settings") { model.selectedTab = .settings }
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
              if !model.helperDevices.isEmpty { devicesCard }
              Button("Leave this family group", role: .destructive) { confirmLeave = true }
                .font(.nunito(.subheadline, .semibold))
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
            } else {
              hero
              createCard
              joinCard
            }
          }
          .padding(.horizontal, Theme.pagePadding)
          .padding(.bottom, 24)
        }
        .scrollIndicators(.hidden)
      }
    }
    .screenBackground()
    .navigationTitle("Family")
    .refreshable { await model.refreshAll() }
    .confirmationDialog("Leave the family group?", isPresented: $confirmLeave, titleVisibility: .visible) {
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
            Text(member.role == "helper" ? "Helps look out for scams" : "Protected by Squeek")
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
        Text("They enter this in Squeek › Family. It works once, for 24 hours.")
          .font(.nunito(.subheadline))
          .foregroundStyle(Theme.secondaryInk)
        ShareLink(item: "Join my Squeek family group: open Squeek, go to Family, and enter \(invite.code)") {
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

  private var devicesCard: some View {
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
      Text("Look out for each other").font(.display(.title)).foregroundStyle(Theme.ink)
      Text("Everyone in a family group shares blocked numbers and websites. You decide whether helpers see your warnings.")
        .font(.nunito(.title3))
        .foregroundStyle(Theme.secondaryInk)
        .fixedSize(horizontal: false, vertical: true)
    }
    .padding(.top, 8)
  }

  private var createCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader("Start a group")
      TextField("Group name", text: $groupName)
        .font(.nunito(.title3))
        .padding(14)
        .background(Theme.ground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
      Picker("I am", selection: $role) {
        Text("Being protected").tag("protected")
        Text("Helping someone").tag("helper")
      }
      .pickerStyle(.segmented)
      Button("Create family group") {
        Task { await model.createHousehold(name: groupName, role: role) }
      }
      .primaryAction()
      .disabled(groupName.trimmingCharacters(in: .whitespaces).isEmpty)
    }
    .card(padding: 20)
  }

  private var joinCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader("Have a code?")
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
