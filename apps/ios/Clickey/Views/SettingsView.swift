import ClickeyCore
import SwiftUI

struct SettingsView: View {
  @EnvironmentObject private var model: AppModel
  @AppStorage("clickey.localOnly") private var localOnly = false
  @State private var showSignIn = false
  @State private var confirmDelete = false

  var body: some View {
    Form {
      accountSection
      voiceSection
      if let profile = model.profile {
        Section {
          VStack(alignment: .leading) {
            Text("Text size")
            Slider(
              value: Binding(
                get: { profile.textScale },
                set: { v in Task { await model.updateProfile { $0.textScale = (v * 10).rounded() / 10 } } }),
              in: 1.0...2.0, step: 0.1
            ) {
              Text("Text size")
            } minimumValueLabel: {
              Text("A").font(.callout)
            } maximumValueLabel: {
              Text("A").font(.title)
            }
          }
          Toggle(
            "Keep a history of warnings",
            isOn: Binding(
              get: { profile.historySync },
              set: { on in Task { await model.updateProfile { $0.historySync = on } } }))
        } footer: {
          Text("History keeps the kind of warning and a short excerpt with private details removed. Your messages and screenshots are never saved.")
        }
      }
      Section("Protections") {
        NavigationLink("Set up protections") { SetupGuideView() }
        if ClickeyConfig.hasPaidAccount {
          Toggle(
            "Block dangerous websites in all apps",
            isOn: Binding(
              get: { model.protectiveDNSEnabled },
              set: { on in Task { await model.setProtectiveDNS(on) } }))
        }
      }
      if model.isSignedIn {
        Section {
          NavigationLink("Connect Clickey on a computer") { PairComputerView() }
          ForEach(model.myDevices) { device in
            VStack(alignment: .leading) {
              Text(device.name ?? Labels.platform(device.platform))
              Text(
                [Labels.platform(device.platform), device.monitoringStatus].compactMap { $0 }.joined(separator: " · ")
              )
              .font(.callout).foregroundStyle(Theme.secondaryInk)
            }
          }
        } header: {
          Text("Your devices")
        }
      }
      Section("About") {
        LabeledContent("Version", value: ClickeyConfig.appVersion)
        LabeledContent("Scam rules", value: CheckService.shared.checker?.engine.rules.version ?? "missing")
      }
    }
    .screenBackground()
    .navigationTitle("Settings")
    .sheet(isPresented: $showSignIn) { EmailSignInView() }
    .confirmationDialog("Delete your Clickey account?", isPresented: $confirmDelete, titleVisibility: .visible) {
      Button("Delete account", role: .destructive) { Task { await model.deleteAccount() } }
    } message: {
      Text("This deletes your warnings history, blocked numbers and family membership from Clickey's server.")
    }
  }

  @ViewBuilder
  private var accountSection: some View {
    Section("Account") {
      if model.isSignedIn {
        LabeledContent("Signed in as", value: model.email ?? "Apple ID")
        Button("Sign out") { Task { await model.signOut() } }
        Button("Delete account", role: .destructive) { confirmDelete = true }
      } else {
        Text("Not signed in. Checks run on this iPhone only.").foregroundStyle(Theme.secondaryInk)
        Button("Sign in with email") { showSignIn = true }
        if ClickeyConfig.hasPaidAccount {
          AppleSignInButton()
            .listRowInsets(EdgeInsets())
        }
        if localOnly {
          Button("Show the welcome screen") { localOnly = false }
        }
      }
    }
  }

  private var voiceSection: some View {
    Section("Voice") {
      Toggle(
        "Read warnings out loud",
        isOn: Binding(get: { !model.muted }, set: { on in Task { await model.setVoice(muted: !on) } }))
      VStack(alignment: .leading) {
        Text("Speaking speed")
        Slider(
          value: Binding(get: { model.voiceRate }, set: { v in Task { await model.setVoice(rate: v) } }),
          in: 0.3...0.6
        ) {
          Text("Speaking speed")
        } minimumValueLabel: {
          Image(systemName: "tortoise")
        } maximumValueLabel: {
          Image(systemName: "hare")
        }
      }
      Button {
        Speech.shared.speak("This is how Clickey sounds when it warns you.", force: true)
      } label: {
        Label("Test the voice", systemImage: "speaker.wave.2")
      }
    }
  }
}
