import Contacts
import ContactsUI
import SqueekCore
import SwiftUI
import UIKit

/// The call gate. Squeek has its own number; a caller who says the family's secret word is put
/// through to the person's phone, and anyone else leaves a message with Squeek, which then calls
/// the person to say what it found. Part of the Calls card in setup.
struct CallScreeningSetup: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var phone = ""
  @State private var addingContact = false
  @State private var showSignIn = false
  @State private var working = false

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      Divider()
      Text("Callers need your secret word")
        .font(.nunito(.headline))
        .foregroundStyle(Theme.ink)
      if model.isSignedIn || model.isDemo {
        yourNumber
        if let line = model.screeningLine {
          secretWord
          squeekNumber(line)
        } else {
          Text("Squeek gets its own phone number for you. People you trust call it and say your secret word to be put through.")
            .font(.nunito(.footnote))
            .foregroundStyle(Theme.secondaryInk)
            .fixedSize(horizontal: false, vertical: true)
          Button("Get my Squeek number") {
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
        Text("Give people you trust a Squeek number and a secret word. They say the word and are put through to you; anyone else leaves a message, and Squeek calls you to say whether it looked like a scam. Sign in to turn it on.")
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
          ? "Squeek calls this number to tell you who left a message and whether it looked like a scam."
          : "Saved. Squeek calls \(PhoneNumbers.display(model.profile?.alertPhone ?? "")) to tell you what it found."
      )
      .font(.nunito(.footnote))
      .foregroundStyle(Theme.secondaryInk)
    }
  }

  /// The word is kept in My Person; the gate can't open without one.
  @ViewBuilder
  private var secretWord: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Your secret word").font(.nunito(.subheadline, .semibold)).foregroundStyle(Theme.ink)
      if model.hasSafeWord {
        Label("Set. Squeek keeps only a scrambled copy.", systemImage: "checkmark.circle.fill")
          .font(.nunito(.footnote))
          .foregroundStyle(Theme.safe)
      } else {
        Text("Choose a word only your family would know. Without one, nobody can be put through.")
          .font(.nunito(.footnote))
          .foregroundStyle(Theme.secondaryInk)
          .fixedSize(horizontal: false, vertical: true)
        Button("Choose a secret word") {
          model.selectedTab = .person
          dismiss()
        }
        .secondaryAction()
      }
    }
  }

  @ViewBuilder
  private func squeekNumber(_ line: String) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Your Squeek number").font(.nunito(.subheadline, .semibold)).foregroundStyle(Theme.ink)
      Text(PhoneNumbers.display(line))
        .font(.nunito(size: 28, weight: .black).monospacedDigit())
        .foregroundStyle(Theme.accentInk)
      Text("Give this number to people you trust, and tell them the secret word in person. When they call it and say the word, Squeek puts them through to you. Anyone else leaves a message.")
        .font(.nunito(.footnote))
        .foregroundStyle(Theme.secondaryInk)
        .fixedSize(horizontal: false, vertical: true)
      ShareLink(item: "You can reach me through Squeek on \(PhoneNumbers.display(line)). Call it and say our secret word, and it puts you through.") {
        Label("Send the number", systemImage: "square.and.arrow.up")
      }
      .secondaryAction()
      Button("Add Squeek to Contacts", systemImage: "person.crop.circle.badge.plus") { addingContact = true }
        .font(.nunito(.subheadline, .semibold))
      Text("So Squeek's calls to you ring through and show its name.")
        .font(.nunito(.footnote))
        .foregroundStyle(Theme.secondaryInk)
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
