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

/// Test sign-in: type an email and you're in. There's no password or emailed code; the email
/// alone picks the account, and a new email makes a new one.
struct EmailSignInView: View {
  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var email = ""
  @State private var working = false
  @State private var message: String?

  var body: some View {
    NavigationStack {
      ScrollView {
        VStack(alignment: .leading, spacing: 22) {
          VStack(alignment: .leading, spacing: 8) {
            Image(systemName: "person.crop.circle.fill")
              .font(.system(size: 34, weight: .semibold))
              .foregroundStyle(Theme.accentInk)
            Text("Sign in")
              .font(.display(.largeTitle))
              .foregroundStyle(Theme.ink)
          }

          VStack(alignment: .leading, spacing: 8) {
            Text("Email address").font(.nunito(.headline))
            TextField("you@example.com", text: $email)
              .textContentType(.emailAddress)
              .keyboardType(.emailAddress)
              .textInputAutocapitalization(.never)
              .autocorrectionDisabled()
              .submitLabel(.go)
              .onSubmit { Task { await submit() } }
              .font(.nunito(.title3))
              .padding(16)
              .background(Theme.card, in: RoundedRectangle(cornerRadius: Theme.smallCorner, style: .continuous))
          }

          if let message {
            Label(message, systemImage: "exclamationmark.circle.fill")
              .font(.nunito(.callout))
              .foregroundStyle(Theme.danger)
          }
        }
        .padding(Theme.pagePadding)
      }
      .screenBackground()
      .safeAreaInset(edge: .bottom) {
        Button {
          Task { await submit() }
        } label: {
          if working { ProgressView() } else { Text("Sign in") }
        }
        .primaryAction()
        .disabled(working || !email.contains("@"))
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

  private func submit() async {
    guard !working, email.contains("@") else { return }
    working = true
    message = nil
    defer { working = false }
    do {
      try await model.signIn(email: email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased())
      dismiss()
    } catch {
      message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
    }
  }
}
