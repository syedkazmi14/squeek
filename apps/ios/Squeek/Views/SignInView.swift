import Pow
import SwiftUI

struct WelcomeView: View {
  var continueWithoutAccount: () -> Void
  @State private var showSignIn = false
  @State private var showEmblem = false

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 32) {
          VStack(alignment: .leading, spacing: 18) {
            ZStack {
              if showEmblem {
                SqueekEmblem(size: 96)
                  .transition(.movingParts.pop(Theme.accent))
              }
            }
            .frame(height: 96)
            Text("Squeek")
              .font(.nunito(size: 46, weight: .black))
              .foregroundStyle(Theme.ink)
            Text("Looks out for scams in the background, and brings in someone you trust.")
              .font(.nunito(.title2, .medium))
              .foregroundStyle(Theme.secondaryInk)
              .fixedSize(horizontal: false, vertical: true)
          }
          .padding(.top, 40)

          VStack(alignment: .leading, spacing: 16) {
            feature("phone.down.fill", "Blocks and labels scam callers, and tells you what it caught")
            feature("message.fill", "Moves scam texts to Junk and warns before dangerous websites open")
            feature("person.2.fill", "Lets a family member or friend help you check")
          }
          .card(padding: 20)

          if !SqueekConfig.isBackendConfigured {
            Label("This build isn't connected to a Squeek server, so only on-phone checks work.", systemImage: "wifi.slash")
              .font(.nunito(.callout))
              .foregroundStyle(Theme.ochre)
          }
        }
        .padding(.horizontal, Theme.pagePadding)
        .padding(.bottom, 24)
      }
      .scrollIndicators(.hidden)
      .screenBackground()
      .safeAreaInset(edge: .bottom) {
        VStack(spacing: 10) {
          Button("Sign in with email") { showSignIn = true }
            .primaryAction()
          Button("Use without an account", action: continueWithoutAccount)
            .secondaryAction()
        }
        .padding(.horizontal, Theme.pagePadding)
        .padding(.bottom, 8)
      }
      .sheet(isPresented: $showSignIn) { EmailSignInView() }
      .onAppear {
        withAnimation(.spring(duration: 0.6).delay(0.15)) { showEmblem = true }
      }
    }
  }

  private func feature(_ symbol: String, _ text: String) -> some View {
    HStack(spacing: 14) {
      IconBadge(symbol: symbol)
      Text(text).font(.nunito(.headline)).foregroundStyle(Theme.ink).fixedSize(horizontal: false, vertical: true)
    }
  }
}

/// Sign-in. By default the demo form: an email and any password (it isn't checked), for accounts
/// on the demo domains the server allows (supabase/functions/demo-sign-in). The emailed link or
/// code is still there for real accounts.
struct EmailSignInView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var usingLink = false
  @State private var email = ""
  @State private var password = ""
  @State private var code = ""
  @State private var codeSent = false
  @State private var working = false
  @State private var message: String?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 8) {
            Image(systemName: codeSent ? "envelope.open.fill" : usingLink ? "envelope.fill" : "person.crop.circle.fill")
              .font(.system(size: 34, weight: .semibold))
              .foregroundStyle(Theme.accentInk)
              .contentTransition(.symbolEffect(.replace))
            Text(codeSent ? "Check your email" : "Sign in")
              .font(.display(.largeTitle))
              .foregroundStyle(Theme.ink)
            Text(subtitle)
              .font(.nunito(.title3))
              .foregroundStyle(Theme.secondaryInk)
              .fixedSize(horizontal: false, vertical: true)
          }

          field("Email address") {
            TextField("you@squeek.example", text: $email)
              .textContentType(.emailAddress)
              .keyboardType(.emailAddress)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .disabled(codeSent)
          }

          if !usingLink {
            field("Password") {
              SecureField("Anything works", text: $password)
            }
          } else if codeSent {
            VStack(alignment: .leading, spacing: 8) {
              field("Or enter a code from the email") {
                TextField("Code", text: $code)
                  .textContentType(.oneTimeCode)
                  .keyboardType(.numberPad)
                  .monospacedDigit()
              }
              Button("Use a different email") {
                withAnimation {
                  codeSent = false
                  code = ""
                }
              }
              .font(.nunito(.callout, .semibold))
            }
            .transition(.opacity.combined(with: .move(edge: .bottom)))
          }

          if let message {
            Label(message, systemImage: "exclamationmark.circle.fill")
              .font(.nunito(.callout))
              .foregroundStyle(Theme.danger)
          }

          Button(usingLink ? "Sign in with a password instead" : "Email me a sign-in link instead") {
            withAnimation {
              usingLink.toggle()
              codeSent = false
              message = nil
            }
          }
          .font(.nunito(.callout, .semibold))
        }
        .padding(Theme.pagePadding)
      }
      .screenBackground()
      .safeAreaInset(edge: .bottom) {
        Button {
          Task { await submit() }
        } label: {
          if working { ProgressView() } else { Text(buttonTitle) }
        }
        .primaryAction()
        .disabled(working || (codeSent ? code.count < 6 : !email.contains("@")))
        .padding(.horizontal, Theme.pagePadding)
        .padding(.bottom, 8)
      }
      .onChange(of: model.isSignedIn) { _, signedIn in if signedIn { dismiss() } }
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel", systemImage: "xmark") { dismiss() }
        }
      }
    }
  }

  private var subtitle: String {
    if codeSent { return "Open the email from Squeek on this iPhone and tap the sign-in link. Squeek will open and sign you in." }
    if usingLink { return "We'll email you a sign-in link. No password needed." }
    return "Demo accounts: type any email on the demo domain and any password. A new email makes a new account."
  }

  private var buttonTitle: String {
    if !usingLink { return "Sign in" }
    return codeSent ? "Sign in with code" : "Email me a sign-in link"
  }

  private func field<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
    VStack(alignment: .leading, spacing: 8) {
      Text(title).font(.nunito(.headline))
      content()
        .font(.nunito(.title3))
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.smallCorner, style: .continuous))
    }
  }

  private func submit() async {
    working = true
    message = nil
    defer { working = false }
    let address = email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    do {
      if !usingLink {
        try await model.demoSignIn(email: address)
        dismiss()
      } else if codeSent {
        try await model.verify(email: address, code: code.trimmingCharacters(in: .whitespaces))
        dismiss()
      } else {
        try await model.sendCode(to: address)
        withAnimation(.spring) { codeSent = true }
      }
    } catch {
      message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
  }
}
