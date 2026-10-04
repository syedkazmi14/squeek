import ClickeyCore
import SwiftUI

struct BlockedView: View {
  @EnvironmentObject private var model: AppModel
  @State private var kind = "phone"
  @State private var adding = false

  var body: some View {
    let entries = model.blockEntries.filter { $0.kind == kind }
    List {
      Section {
        Picker("Show", selection: $kind) {
          Text("Phone numbers").tag("phone")
          Text("Websites").tag("domain")
        }
        .pickerStyle(.segmented)
      }
      if kind == "phone" { callSettings }
      Section {
        if entries.isEmpty {
          Text(kind == "phone" ? "No blocked numbers yet." : "No blocked websites yet.")
            .foregroundStyle(Theme.secondaryInk)
        }
        ForEach(entries) { entry in
          VStack(alignment: .leading, spacing: 4) {
            Text(kind == "phone" ? PhoneNumbers.display(entry.value) : entry.value)
              .font(.title3.weight(.medium))
            HStack {
              Text(Labels.source(entry.source))
              if let label = entry.label { Text("· \(label)") }
            }
            .font(.callout)
            .foregroundStyle(Theme.secondaryInk)
          }
          .padding(.vertical, 4)
          .deleteDisabled(!model.canRemove(entry))
        }
        .onDelete { offsets in
          let targets = offsets.map { entries[$0] }
          Task { for entry in targets { await model.removeBlock(entry) } }
        }
      } footer: {
        Text(
          kind == "phone"
            ? "Calls from your and your family's numbers are blocked. Numbers reported by others show as \"Clickey: reported scam\" when they call."
            : "Clickey warns before these websites open in Safari, and flags them in messages you check.")
      }
    }
    .screenBackground()
    .navigationTitle("Blocked")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button {
          adding = true
        } label: {
          Label("Add", systemImage: "plus")
        }
      }
    }
    .refreshable { await model.refreshAll() }
    .sheet(isPresented: $adding) { AddBlockView(kind: kind) }
  }

  @ViewBuilder
  private var callSettings: some View {
    Section {
      HStack {
        Text("Call blocking")
        Spacer()
        Text(model.callBlockingStatus == .enabled ? "On" : "Off")
          .foregroundStyle(model.callBlockingStatus == .enabled ? Theme.forest : Theme.danger)
      }
      if model.callBlockingStatus != .enabled {
        Button("Turn on in Settings") { CallDirectorySync.openSettings() }
      }
      if let profile = model.profile {
        Toggle(
          "Also block numbers reported by others",
          isOn: Binding(
            get: { profile.blockReportedNumbers },
            set: { on in Task { await model.setBlockReportedNumbers(on) } }))
      }
    }
  }
}

/// Add a number or website to the block list, optionally sharing it with family and reporting it.
struct AddBlockView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State var kind: String
  @State private var value = ""
  @State private var label = ""
  @State private var shareWithFamily = true
  @State private var reportToOthers = true
  @State private var working = false

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Type", selection: $kind) {
            Text("Phone number").tag("phone")
            Text("Website").tag("domain")
          }
          .pickerStyle(.segmented)
          TextField(kind == "phone" ? "Phone number" : "Website, like example.com", text: $value)
            .font(.title3)
            .keyboardType(kind == "phone" ? .phonePad : .URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          TextField("Note (optional), like \"Fake bank call\"", text: $label)
        } footer: {
          if kind == "phone" {
            Text("Tip: in the Phone app's Recents, tap ⓘ next to the call, then press and hold the number to copy it.")
          }
        }
        Section {
          if model.isSignedIn {
            if model.household != nil {
              Toggle("Share with my family group", isOn: $shareWithFamily)
            }
            Toggle("Report it to help protect others", isOn: $reportToOthers)
          } else {
            Text("Saved on this iPhone only. Sign in to share it with your computer and family.")
              .foregroundStyle(Theme.secondaryInk)
          }
        } footer: {
          if model.isSignedIn && reportToOthers {
            Text("Reports are anonymous. A number or website is labeled for everyone once several people report it.")
          }
        }
        Section {
          Button(kind == "phone" ? "Block this number" : "Block this website") {
            Task {
              working = true
              let ok = await model.addBlock(
                kind: kind, rawValue: value, label: label, shareWithFamily: shareWithFamily, report: reportToOthers)
              working = false
              if ok { dismiss() }
            }
          }
          .buttonStyle(PrimaryButtonStyle())
          .disabled(value.trimmingCharacters(in: .whitespaces).isEmpty || working)
          .listRowInsets(EdgeInsets())
        }
      }
      .navigationTitle(kind == "phone" ? "Block a number" : "Block a website")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      }
    }
  }
}
