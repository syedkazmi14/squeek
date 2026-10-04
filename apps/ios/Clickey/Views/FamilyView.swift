import ClickeyCore
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
    Form {
      if !model.isSignedIn {
        Section {
          Text("Sign in to create or join a family group.").foregroundStyle(Theme.secondaryInk)
        }
      } else if let household = model.household {
        membersSection(household.name)
        inviteSection
        sharingSection
        if !model.helperDevices.isEmpty { devicesSection }
        Section {
          Button("Leave this family group", role: .destructive) { confirmLeave = true }
        }
      } else {
        createSection
        joinSection
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

  private func membersSection(_ name: String) -> some View {
    Section(name) {
      ForEach(model.members) { member in
        HStack {
          VStack(alignment: .leading) {
            Text((member.displayName ?? "Family member") + (member.isMe ? " (you)" : ""))
              .font(.title3)
            Text(member.role == "helper" ? "Helps others" : "Protected")
              .font(.callout).foregroundStyle(Theme.secondaryInk)
          }
          Spacer()
          Image(systemName: member.role == "helper" ? "person.badge.shield.checkmark" : "person")
            .foregroundStyle(Theme.forest)
        }
      }
      if model.profile?.displayName == nil {
        NameField()
      }
    }
  }

  private var inviteSection: some View {
    Section {
      if let invite {
        VStack(alignment: .leading, spacing: 8) {
          Text("Invite code").font(.headline)
          Text(invite.code)
            .font(.system(size: 44, weight: .semibold, design: .monospaced))
            .kerning(6)
            .accessibilityLabel(invite.code.map(String.init).joined(separator: " "))
          Text("They enter this in Clickey › Family › Join. It works once, for 24 hours.")
            .font(.callout).foregroundStyle(Theme.secondaryInk)
          ShareLink(
            item: "Join my Clickey family group: open Clickey, go to Family, tap Join, and enter \(invite.code)"
          ) {
            Label("Send the code", systemImage: "square.and.arrow.up")
          }
        }
      } else {
        Picker("Invite as", selection: $inviteRole) {
          Text("A helper").tag("helper")
          Text("Someone to protect").tag("protected")
        }
        Button("Create an invite code") {
          Task {
            if let code = await model.createInvite(role: inviteRole) { invite = (code, inviteRole) }
          }
        }
      }
    } header: {
      Text("Invite someone")
    }
  }

  @ViewBuilder
  private var sharingSection: some View {
    if let profile = model.profile, model.myRole == "protected" {
      Section {
        Toggle(
          "Share my warnings with my helpers",
          isOn: Binding(
            get: { profile.shareIncidentsWithHelpers },
            set: { on in Task { await model.updateProfile { $0.shareIncidentsWithHelpers = on } } }))
      } footer: {
        Text("Helpers see the kind of warning and a short excerpt with private details removed. They can't see your messages.")
      }
    }
  }

  private var devicesSection: some View {
    Section("Devices of people you help") {
      ForEach(model.helperDevices) { device in
        VStack(alignment: .leading, spacing: 2) {
          Text("\(device.displayName ?? "Family member")'s \(Labels.platform(device.platform))")
            .font(.title3)
          Text(
            [device.monitoringStatus, device.lastSeenAt.flatMap(Timestamps.parse).map { "seen \($0.formatted(.relative(presentation: .named)))" }]
              .compactMap { $0 }.joined(separator: " · ")
          )
          .font(.callout).foregroundStyle(Theme.secondaryInk)
        }
      }
    }
  }

  private var createSection: some View {
    Section {
      TextField("Group name", text: $groupName)
      Picker("I am", selection: $role) {
        Text("The person being protected").tag("protected")
        Text("Helping someone").tag("helper")
      }
      Button("Create family group") {
        Task { await model.createHousehold(name: groupName, role: role) }
      }
      .disabled(groupName.trimmingCharacters(in: .whitespaces).isEmpty)
    } header: {
      Text("Start a family group")
    } footer: {
      Text("Everyone in the group shares blocked numbers and websites. You choose whether helpers can see your warnings.")
    }
  }

  private var joinSection: some View {
    Section("Join with a code") {
      TextField("6-letter code", text: $joinCode)
        .textInputAutocapitalization(.characters)
        .autocorrectionDisabled()
        .font(.title2.monospaced())
      Button("Join") {
        Task { if await model.joinHousehold(code: joinCode) { joinCode = "" } }
      }
      .disabled(joinCode.trimmingCharacters(in: .whitespaces).count < 6)
    }
  }
}

private struct NameField: View {
  @EnvironmentObject private var model: AppModel
  @State private var name = ""

  var body: some View {
    HStack {
      TextField("Your first name (shown to family)", text: $name)
      Button("Save") { Task { await model.setDisplayName(name) } }
        .disabled(name.trimmingCharacters(in: .whitespaces).isEmpty)
    }
  }
}
