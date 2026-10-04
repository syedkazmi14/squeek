import Contacts
import ContactsUI
import SqueekCore
import SwiftUI
import UIKit

/// Squeek answering the calls the person misses: the number Squeek calls them on with what it
/// found, their Squeek line, the carrier codes that forward unanswered calls to it, and a contact
/// card so Squeek's calls ring through. Part of the Calls card in setup.
struct CallScreeningSetup: View {
  @EnvironmentObject private var model: AppModel
  @State private var phone = ""
  @State private var carrier = Carrier.gsm
  @State private var copied: String?
  @State private var addingContact = false
  @State private var showSignIn = false
  @State private var working = false

  enum Carrier: String, CaseIterable, Identifiable {
    case gsm = "AT&T or T-Mobile"
    case verizon = "Verizon"
    var id: String { rawValue }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Divider()
      Text("Squeek answers the calls you miss")
        .font(.nunito(.headline))
        .foregroundStyle(Theme.ink)
      if model.isSignedIn || model.isDemo {
        yourNumber
        if let line = model.screeningLine {
          forwarding(line)
        } else {
          Button("Get my Squeek line") {
            Task {
              working = true
              await model.claimScreeningLine()
              working = false
            }
          }
          .secondaryAction()
          .disabled(working)
        }
      } else {
        Text("When a number you don't know calls and you don't pick up, Squeek answers, asks who it is, and calls you to say whether it looked like a scam. Sign in to turn it on.")
          .font(.nunito(.body))
          .foregroundStyle(Theme.ink)
          .fixedSize(horizontal: false, vertical: true)
        Button("Sign in") { showSignIn = true }.secondaryAction()
      }
    }
    .onAppear { if phone.isEmpty, let saved = model.profile?.alertPhone { phone = PhoneNumbers.display(saved) } }
    .sheet(isPresented: $showSignIn) { EmailSignInView() }
    .sheet(isPresented: $addingContact) {
      if let line = model.screeningLine { NewContactView(phone: line).ignoresSafeArea() }
    }
  }

  private var yourNumber: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Your phone number").font(.nunito(.subheadline, .semibold)).foregroundStyle(Theme.ink)
      HStack {
        TextField("(555) 555-0100", text: $phone)
          .keyboardType(.phonePad)
          .textContentType(.telephoneNumber)
          .font(.nunito(.title3))
          .padding(12)
          .background(Theme.ground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        Button("Save") { Task { _ = await model.setAlertPhone(phone) } }
          .buttonStyle(.glass)
          .disabled(phone.trimmingCharacters(in: .whitespaces).isEmpty)
      }
      Text(
        model.profile?.alertPhone == nil
          ? "Squeek calls this number to tell you who called and whether it looked like a scam."
          : "Saved. Squeek calls \(PhoneNumbers.display(model.profile?.alertPhone ?? "")) to tell you what it found."
      )
      .font(.nunito(.footnote))
      .foregroundStyle(Theme.secondaryInk)
    }
  }

  @ViewBuilder
  private func forwarding(_ line: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Your Squeek line").font(.nunito(.subheadline, .semibold)).foregroundStyle(Theme.ink)
      Text(PhoneNumbers.display(line))
        .font(.nunito(size: 28, weight: .black).monospacedDigit())
        .foregroundStyle(Theme.accentInk)
      Button("Add Squeek to Contacts", systemImage: "person.crop.circle.badge.plus") { addingContact = true }
        .font(.nunito(.subheadline, .semibold))
      Text("So Squeek's calls ring through and show its name.")
        .font(.nunito(.footnote))
        .foregroundStyle(Theme.secondaryInk)
    }

    VStack(alignment: .leading, spacing: 10) {
      Text("Send missed calls to Squeek").font(.nunito(.subheadline, .semibold)).foregroundStyle(Theme.ink)
      Picker("Carrier", selection: $carrier) {
        ForEach(Carrier.allCases) { Text($0.rawValue).tag($0) }
      }
      .pickerStyle(.segmented)
      ForEach(codes(for: line), id: \.code) { item in
        HStack {
          VStack(alignment: .leading, spacing: 2) {
            Text(item.code).font(.system(.body, design: .monospaced).weight(.semibold)).foregroundStyle(Theme.ink)
            Text(item.when).font(.nunito(.footnote)).foregroundStyle(Theme.secondaryInk)
          }
          Spacer()
          Button(copied == item.code ? "Copied" : "Copy") {
            UIPasteboard.general.string = item.code
            withAnimation { copied = item.code }
          }
          .buttonStyle(.glass)
        }
        .padding(12)
        .background(Theme.ground, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        .accessibilityElement(children: .combine)
      }
      Text(
        "Open the Phone app, paste each code into the keypad and press call. iPhones can't dial these codes for you. "
          + "To undo it later, dial \(carrier == .gsm ? "##004#" : "*73")."
      )
      .font(.nunito(.footnote))
      .foregroundStyle(Theme.secondaryInk)
      .fixedSize(horizontal: false, vertical: true)
      Toggle("I've set up forwarding", isOn: $model.forwardingOn)
        .font(.nunito(.subheadline, .semibold))
        .tint(Theme.accent)
    }
  }

  private func codes(for line: String) -> [(code: String, when: String)] {
    switch carrier {
    case .gsm:
      return [
        ("**61*\(line)#", "When you don't answer"),
        ("**67*\(line)#", "When you're busy or decline"),
        ("**62*\(line)#", "When your phone is off"),
      ]
    case .verizon:
      let digits = line.hasPrefix("+1") ? String(line.dropFirst(2)) : line
      return [("*71\(digits)", "When you don't answer or you're busy")]
    }
  }
}

/// The system's new-contact screen, filled in with Squeek's line. Needs no Contacts permission.
private struct NewContactView: UIViewControllerRepresentable {
  let phone: String
  @Environment(\.dismiss) private var dismiss

  func makeUIViewController(context: Context) -> UINavigationController {
    let contact = CNMutableContact()
    contact.givenName = "Squeek"
    contact.organizationName = "Squeek call screener"
    contact.phoneNumbers = [CNLabeledValue(label: CNLabelPhoneNumberMain, value: CNPhoneNumber(stringValue: phone))]
    let controller = CNContactViewController(forNewContact: contact)
    controller.delegate = context.coordinator
    return UINavigationController(rootViewController: controller)
  }

  func updateUIViewController(_ controller: UINavigationController, context: Context) {}

  func makeCoordinator() -> Coordinator { Coordinator(dismiss: dismiss) }

  final class Coordinator: NSObject, CNContactViewControllerDelegate {
    let dismiss: DismissAction
    init(dismiss: DismissAction) { self.dismiss = dismiss }
    func contactViewController(_ viewController: CNContactViewController, didCompleteWith contact: CNContact?) {
      dismiss()
    }
  }
}
