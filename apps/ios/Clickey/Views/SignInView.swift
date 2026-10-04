import AuthenticationServices
import CryptoKit
import SwiftUI

struct WelcomeView: View {
  var continueWithoutAccount: () -> Void
  @State private var showSignIn = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 28) {
          HStack(spacing: 12) {
            ClickeyEmblem(size: 40)
            Text("Clickey").font(.system(.largeTitle, design: .serif).weight(.semibold))
          }
          .padding(.top, 32)
          Text("Clickey helps you spot scams in messages, links and phone calls, and reads its warnings out loud.")
            .font(.title2)
            .foregroundStyle(Theme.ink)
          Text("Sign in to keep your warnings and blocked numbers in step with Clickey on your computer and with family who help you.")
            .font(.title3)
            .foregroundStyle(Theme.secondaryInk)

          VStack(spacing: 16) {
            Button("Sign in with email") { showSignIn = true }
              .buttonStyle(PrimaryButtonStyle())
            AppleSignInButton()
            Button("Use without an account", action: continueWithoutAccount)
              .buttonStyle(SecondaryButtonStyle())
          }
          if !ClickeyConfig.isBackendConfigured {
            Text("This build isn't connected to a Clickey server, so only on-phone checks are available. See apps/ios/README.md.")
              .font(.callout)
              .foregroundStyle(Theme.ochre)
          }
        }
        .padding(24)
      }
      .screenBackground()
      .sheet(isPresented: $showSignIn) { EmailSignInView() }
    }
  }
}

/// Email sign-in with a 6-digit code (no password to remember).
struct EmailSignInView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var email = ""
  @State private var code = ""
  @State private var codeSent = false
  @State private var working = false
  @State private var message: String?

  var body: some View {
    NavigationStack {
      Form {
        Section {
          TextField("Email address", text: $email)
            .textContentType(.emailAddress)
            .keyboardType(.emailAddress)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .font(.title3)
            .disabled(codeSent)
        } footer: {
          Text(codeSent ? "" : "We'll email you a sign-in link. No password needed.")
        }
        if codeSent {
          Section {
            Label("Open the email from Clickey on this iPhone and tap the sign-in link. Clickey will open and sign you in.", systemImage: "envelope.open")
              .font(.title3)
          }
          Section {
            TextField("Code from the email", text: $code)
              .textContentType(.oneTimeCode)
              .keyboardType(.numberPad)
              .font(.title2.monospacedDigit())
          } header: {
            Text("If your email shows a code instead")
          } footer: {
            Button("Use a different email") {
              codeSent = false
              code = ""
            }
          }
        }
        if let message {
          Section { Text(message).foregroundStyle(Theme.danger) }
        }
        Section {
          Button(codeSent ? "Sign in with code" : "Email me a sign-in link") { Task { await submit() } }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(working || (codeSent ? code.count < 6 : !email.contains("@")))
            .listRowInsets(EdgeInsets())
        }
      }
      .navigationTitle("Sign in")
      .onChange(of: model.isSignedIn) { _, signedIn in if signedIn { dismiss() } }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
      }
    }
  }

  private func submit() async {
    working = true
    message = nil
    defer { working = false }
    let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    do {
      if codeSent {
        try await model.verify(email: address, code: code.trimmingCharacters(in: .whitespaces))
        dismiss()
      } else {
        try await model.sendCode(to: address)
        codeSent = true
      }
    } catch {
      message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
  }
}

/// Sign in with Apple, exchanged for a Supabase session.
struct AppleSignInButton: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.colorScheme) private var colorScheme
  @State private var nonce = ""

  var body: some View {
    SignInWithAppleButton(.signIn) { request in
      nonce = Self.randomNonce()
      request.requestedScopes = [.email, .fullName]
      request.nonce = Self.sha256(nonce)
    } onCompletion: { result in
      guard case .success(let auth) = result,
        let credential = auth.credential as? ASAuthorizationAppleIDCredential,
        let tokenData = credential.identityToken,
        let token = String(data: tokenData, encoding: .utf8)
      else {
        if case .failure(let error) = result, (error as? ASAuthorizationError)?.code != .canceled {
          model.report(error)
        }
        return
      }
      let rawNonce = nonce
      Task {
        do {
          try await model.signInWithApple(idToken: token, nonce: rawNonce)
          if let name = credential.fullName?.givenName { await model.setDisplayName(name) }
        } catch {
          model.report(error)
        }
      }
    }
    .signInWithAppleButtonStyle(colorScheme == .dark ? .white : .black)
    .frame(height: 60)
    .clipShape(RoundedRectangle(cornerRadius: Theme.corner))
  }

  private static func randomNonce() -> String {
    let charset = Array("0123456789ABCDEFGHIJKLMNOPQRSTUVXYZabcdefghijklmnopqrstuvwxyz-._")
    var generator = SystemRandomNumberGenerator()
    return String((0..<32).map { _ in charset.randomElement(using: &generator)! })
  }

  private static func sha256(_ input: String) -> String {
    SHA256.hash(data: Data(input.utf8)).map { String(format: "%02x", $0) }.joined()
  }
}
