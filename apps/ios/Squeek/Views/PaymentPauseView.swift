import SqueekCore
import SwiftUI

/// Shown when the person opens a payment or bank app soon after a likely scam (Check Before Paying).
/// It never blocks the payment: it says what happened, offers their trusted person, and lets them
/// carry on after a 30-second breather.
struct PaymentPauseView: View {
  let pause: PaymentPause
  @EnvironmentObject private var model: AppModel
  @Environment(\.dismiss) private var dismiss
  @State private var secondsLeft = 30

  private static let breather = 30

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        VStack(spacing: 14) {
          MascotView(mood: .concerned, height: 120)
          Text("Hold on a moment")
            .font(.display(.largeTitle))
            .foregroundStyle(Theme.ink)
            .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 12)

        VStack(alignment: .leading, spacing: 10) {
          Text(pause.whatHappened)
            .font(.nunito(.title3, .semibold))
            .foregroundStyle(Theme.dangerInk)
            .fixedSize(horizontal: false, vertical: true)
          Text(pause.why)
            .font(.nunito(.body))
            .foregroundStyle(Theme.ink)
            .fixedSize(horizontal: false, vertical: true)
        }
        .card(padding: 20, tint: Theme.dangerSoft)

        if pause.incident.isScreenedCall && model.hasSafeWord {
          Label("If they say they're family, ask for your family's safe word. Hang up if they can't say it.", systemImage: "key.fill")
            .font(.nunito(.body))
            .foregroundStyle(Theme.ink)
            .card()
        }

        VStack(spacing: 10) {
          if let person = model.trustedPerson, let url = URL(string: "tel:\(person.phone)") {
            Link(destination: url) { Label("Call \(person.name) first", systemImage: "phone.fill") }
              .primaryAction()
          } else {
            Text("Before you pay, talk it over with someone you trust.")
              .font(.nunito(.headline))
              .foregroundStyle(Theme.ink)
              .frame(maxWidth: .infinity, alignment: .leading)
          }
          Button("I won't pay them") { finish("reviewed") }
            .secondaryAction()
        }
      }
      .padding(.horizontal, Theme.pagePadding)
      .padding(.bottom, 24)
    }
    .scrollIndicators(.hidden)
    .screenBackground()
    .safeAreaInset(edge: .bottom) { continueBar }
    .task {
      if !model.muted { Speech.shared.speak(pause.spoken) }
      while secondsLeft > 0 {
        try? await Task.sleep(for: .seconds(1))
        secondsLeft -= 1
      }
    }
  }

  /// "Continue anyway" unlocks after the breather, with a ring counting it down.
  private var continueBar: some View {
    HStack(spacing: 14) {
      ZStack {
        Circle().stroke(Theme.neutralSoft, lineWidth: 5)
        Circle()
          .trim(from: 0, to: CGFloat(secondsLeft) / CGFloat(Self.breather))
          .stroke(Theme.accent, style: StrokeStyle(lineWidth: 5, lineCap: .round))
          .rotationEffect(.degrees(-90))
          .animation(.linear(duration: 1), value: secondsLeft)
        Text("\(secondsLeft)")
          .font(.nunito(.headline).monospacedDigit())
          .foregroundStyle(Theme.ink)
          .contentTransition(.numericText(countsDown: true))
      }
      .frame(width: 44, height: 44)
      .opacity(secondsLeft > 0 ? 1 : 0)
      .accessibilityHidden(true)

      Button(secondsLeft > 0 ? "Take a breath first" : "Continue anyway") { finish("opened_anyway") }
        .font(.nunito(.headline))
        .foregroundStyle(Theme.secondaryInk)
        .disabled(secondsLeft > 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityHint(secondsLeft > 0 ? "Available in \(secondsLeft) seconds" : "Closes Squeek so you can go back to your payment")
    }
    .padding(.horizontal, Theme.pagePadding)
    .padding(.vertical, 12)
    .background(.bar)
  }

  private func finish(_ action: String) {
    Speech.shared.stop()
    if !pause.isPractice {
      Task {
        await model.setAction(action, forIncident: pause.incident.id)
        // Going ahead after a likely scam is the moment a helper's call can matter most.
        if action == "opened_anyway" { await model.notifyHelpers(about: pause.incident) }
      }
    }
    dismiss()
  }
}
