import SqueekCore
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
        .controlSize(.large)
        .listRowBackground(Color.clear)
        .listRowInsets(EdgeInsets())
      }

      if kind == "phone" { callBlockingSection }

      Section {
        if entries.isEmpty {
          ContentUnavailableView(
            kind == "phone" ? "No blocked numbers" : "No blocked websites",
            systemImage: kind == "phone" ? "phone.badge.checkmark" : "globe",
            description: Text("Tap + to add one."))
            .listRowBackground(Color.clear)
        }
        ForEach(entries) { entry in
          HStack(spacing: 14) {
            IconBadge(
              symbol: kind == "phone" ? "phone.down.fill" : "globe",
              tint: Theme.danger, soft: Theme.dangerSoft, size: 38)
            VStack(alignment: .leading, spacing: 2) {
              Text(kind == "phone" ? PhoneNumbers.display(entry.value) : entry.value)
                .font(.nunito(.headline))
                .foregroundStyle(Theme.ink)
              if let label = entry.label {
                Text(label).font(.nunito(.subheadline)).foregroundStyle(Theme.secondaryInk)
              }
            }
            Spacer()
            Text(Labels.source(entry.source))
              .font(.nunito(.caption, .semibold))
              .foregroundStyle(entry.source == "user" || entry.source == "household" ? Theme.accentInk : Theme.ochre)
              .padding(.horizontal, 10)
              .padding(.vertical, 5)
              .background(
                entry.source == "user" || entry.source == "household" ? Theme.accentSoft : Theme.ochreSoft,
                in: Capsule())
          }
          .padding(.vertical, 4)
          .listRowBackground(Theme.card)
          .deleteDisabled(!model.canRemove(entry))
          .accessibilityElement(children: .combine)
        }
        .onDelete { offsets in
          let targets = offsets.map { entries[$0] }
          Task { for entry in targets { await model.removeBlock(entry) } }
        }
      } header: {
        Text(kind == "phone" ? "Numbers" : "Websites")
      } footer: {
        Text(
          kind == "phone"
            ? "Calls from numbers you or your family add are blocked. Numbers reported by others show “Squeek: reported scam” when they call."
            : "Squeek warns before these websites open in Safari, and flags them in messages you check.")
      }
    }
    .screenBackground()
    .navigationTitle("Blocked")
    .toolbar {
      ToolbarItem(placement: .primaryAction) {
        Button("Add", systemImage: "plus") { adding = true }
      }
    }
    .refreshable { await model.refreshAll() }
    .sheet(isPresented: $adding) { AddBlockView(kind: kind) }
  }

  @ViewBuilder
  private var callBlockingSection: some View {
    Section {
      HStack(spacing: 14) {
        IconBadge(
          symbol: model.callBlockingStatus == .enabled ? "checkmark.shield.fill" : "shield.slash.fill",
          tint: model.callBlockingStatus == .enabled ? Theme.accentInk : Theme.ochre,
          soft: model.callBlockingStatus == .enabled ? Theme.accentSoft : Theme.ochreSoft)
        VStack(alignment: .leading, spacing: 2) {
          Text(model.callBlockingStatus == .enabled ? "Call blocking is on" : "Call blocking is off")
            .font(.nunito(.headline))
          Text(model.callBlockingStatus == .enabled ? "Scam callers can't reach you." : "Turn it on in Settings to block calls.")
            .font(.nunito(.subheadline))
            .foregroundStyle(Theme.secondaryInk)
        }
      }
      .listRowBackground(Theme.card)
      if model.callBlockingStatus != .enabled {
        Button("Turn on in Settings") { CallDirectorySync.openSettings() }
          .font(.nunito(.headline))
          .listRowBackground(Theme.card)
      }
      if let profile = model.profile {
        Toggle(
          "Also block numbers reported by others",
          isOn: Binding(
            get: { profile.blockReportedNumbers },
            set: { on in Task { await model.setBlockReportedNumbers(on) } }))
          .tint(Theme.accent)
          .listRowBackground(Theme.card)
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
          .listRowBackground(Color.clear)
          .listRowInsets(EdgeInsets())
        }
        Section {
          TextField(kind == "phone" ? "Phone number" : "example.com", text: $value)
            .font(.nunito(.title3))
            .keyboardType(kind == "phone" ? .phonePad : .URL)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
          TextField("Note (optional), like “Fake bank call”", text: $label)
        } footer: {
          if kind == "phone" {
            Text("Tip: in the Phone app's Recents, tap ⓘ next to the call, then press and hold the number to copy it.")
          }
        }
        .listRowBackground(Theme.card)
        Section {
          if model.isSignedIn {
            if model.household != nil {
              Toggle("Share with my family group", isOn: $shareWithFamily).tint(Theme.accent)
            }
            Toggle("Report it to help protect others", isOn: $reportToOthers).tint(Theme.accent)
          } else {
            Label("Saved on this iPhone only. Sign in to share it with your computer and family.", systemImage: "iphone")
              .foregroundStyle(Theme.secondaryInk)
          }
        } footer: {
          if model.isSignedIn && reportToOthers {
            Text("Reports are anonymous. A number or website is labeled for everyone once several people report it.")
          }
        }
        .listRowBackground(Theme.card)
      }
      .screenBackground()
      .navigationTitle(kind == "phone" ? "Block a number" : "Block a website")
      .navigationBarTitleDisplayMode(.inline)
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel", systemImage: "xmark") { dismiss() } }
      }
      .safeAreaInset(edge: .bottom) {
        Button {
          Task {
            working = true
            let ok = await model.addBlock(
              kind: kind, rawValue: value, label: label, shareWithFamily: shareWithFamily, report: reportToOthers)
            working = false
            if ok { dismiss() }
          }
        } label: {
          if working { ProgressView() } else { Text(kind == "phone" ? "Block this number" : "Block this website") }
        }
        .primaryAction()
        .disabled(value.trimmingCharacters(in: .whitespaces).isEmpty || working)
        .padding(.horizontal, Theme.pagePadding)
        .padding(.bottom, 8)
      }
    }
  }
}
