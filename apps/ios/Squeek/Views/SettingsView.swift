import SqueekCore
import SwiftUI

struct SettingsView: View {
  @EnvironmentObject private var model: AppModel
  @AppStorage("squeek.localOnly") private var localOnly = false
  @State private var showSignIn = false
  @State private var confirmDelete = false

  var body: some View {
    Form {
      accountSection
      voiceSection
      if let profile = model.profile { displaySection(profile) }
      Section("Protection") {
        NavigationLink { SetupGuideView() } label: {
          SettingsLabel("Set up protections", symbol: "checkmark.shield.fill", color: Theme.accentInk)
        }
        if model.showsAccountData {
          NavigationLink { PairComputerView() } label: {
            SettingsLabel("Connect a computer", symbol: "desktopcomputer", color: .blue)
          }
        }
      }
      .listRowBackground(Theme.card)
      if !model.myDevices.isEmpty {
        Section("Your devices") {
          ForEach(model.myDevices) { device in
            HStack(spacing: 12) {
              IconBadge(symbol: Labels.platformSymbol(device.platform), size: 34)
              VStack(alignment: .leading) {
                Text(device.name ?? Labels.platform(device.platform)).font(.nunito(.body, .semibold))
                if let status = device.monitoringStatus {
                  Text(status).font(.nunito(.footnote)).foregroundStyle(Theme.secondaryInk)
                }
              }
            }
          }
        }
        .listRowBackground(Theme.card)
      }
      Section("About") {
        LabeledContent("Version", value: SqueekConfig.appVersion)
        LabeledContent("Scam rules", value: CheckService.shared.checker?.engine.rules.version ?? "missing")
      }
      .listRowBackground(Theme.card)
    }
    .screenBackground()
    .navigationTitle("Settings")
    .sheet(isPresented: $showSignIn) { EmailSignInView() }
    .confirmationDialog("Delete your Squeek account?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete account", role: .destructive) { Task { await model.deleteAccount() } }
    } message: {
      Text("This deletes your warnings history, blocked numbers and family membership from Squeek's server.")
    }
  }

  @ViewBuilder
  private var accountSection: some View {
    Section {
      if model.showsAccountData {
        HStack(spacing: 14) {
          Avatar(name: model.profile?.displayName ?? model.email ?? "?")
          VStack(alignment: .leading, spacing: 2) {
            Text(model.profile?.displayName ?? "Signed in").font(.nunito(.headline))
            Text(model.email ?? "").font(.nunito(.subheadline)).foregroundStyle(Theme.secondaryInk)
          }
        }
        Button("Sign out") { Task { await model.signOut() } }
        Button("Delete account", role: .destructive) { confirmDelete = true }
      } else {
        VStack(alignment: .leading, spacing: 6) {
          Text("Not signed in").font(.nunito(.headline))
          Text("Checks run on this iPhone only. Sign in to sync with your computer and family.")
            .font(.nunito(.subheadline))
            .foregroundStyle(Theme.secondaryInk)
        }
        Button("Sign in with email") { showSignIn = true }
          .font(.nunito(.headline))
        if localOnly {
          Button("Show the welcome screen") { localOnly = false }
        }
      }
    }
    .listRowBackground(Theme.card)
  }

  private var voiceSection: some View {
    Section("Voice") {
      Toggle(isOn: Binding(get: { !model.muted }, set: { on in Task { await model.setVoice(muted: !on) } })) {
        SettingsLabel("Read warnings aloud", symbol: "speaker.wave.2.fill", color: .orange)
      }
      .tint(Theme.accent)
      VStack(alignment: .leading, spacing: 8) {
        Text("Speaking speed").font(.nunito(.subheadline, .semibold))
        Slider(
          value: Binding(get: { model.voiceRate }, set: { v in Task { await model.setVoice(rate: v) } }),
          in: 0.3...0.6
        ) {
          Text("Speaking speed")
        } minimumValueLabel: {
          Image(systemName: "tortoise.fill").foregroundStyle(Theme.secondaryInk)
        } maximumValueLabel: {
          Image(systemName: "hare.fill").foregroundStyle(Theme.secondaryInk)
        }
        .tint(Theme.accent)
      }
      Button {
        Speech.shared.speak("This is how Squeek sounds when it warns you.", force: true)
      } label: {
        SettingsLabel("Test the voice", symbol: "play.fill", color: Theme.accentInk)
      }
    }
    .listRowBackground(Theme.card)
  }

  private func displaySection(_ profile: Profile) -> some View {
    Section {
      VStack(alignment: .leading, spacing: 8) {
        Text("Text size").font(.nunito(.subheadline, .semibold))
        Slider(
          value: Binding(
            get: { profile.textScale },
            set: { v in Task { await model.updateProfile { $0.textScale = (v * 10).rounded() / 10 } } }),
          in: 1.0...2.0, step: 0.1
        ) {
          Text("Text size")
        } minimumValueLabel: {
          Text("A").font(.nunito(.callout))
        } maximumValueLabel: {
          Text("A").font(.nunito(.title))
        }
        .tint(Theme.accent)
      }
      Toggle(
        isOn: Binding(
          get: { profile.historySync },
          set: { on in Task { await model.updateProfile { $0.historySync = on } } })
      ) {
        SettingsLabel("Keep a history of warnings", symbol: "clock.arrow.circlepath", color: .purple)
      }
      .tint(Theme.accent)
    } header: {
      Text("Display and privacy")
    } footer: {
      Text("History keeps the kind of warning and a short excerpt with private details removed. Your messages and screenshots are never saved.")
    }
    .listRowBackground(Theme.card)
  }
}

/// A settings row label with a white symbol on a coloured rounded square, like the Settings app.
struct SettingsLabel: View {
  let title: String
  let symbol: String
  let color: Color

  init(_ title: String, symbol: String, color: Color) {
    self.title = title
    self.symbol = symbol
    self.color = color
  }

  var body: some View {
    Label {
      Text(title).foregroundStyle(Theme.ink)
    } icon: {
      Image(systemName: symbol)
        .font(.system(size: 14, weight: .semibold))
        .foregroundStyle(.white)
        .frame(width: 30, height: 30)
        .background(color, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
    }
  }
}
