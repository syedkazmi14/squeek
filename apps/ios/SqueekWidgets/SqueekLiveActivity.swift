import ActivityKit
import SwiftUI
import WidgetKit

private let yellow = Color(red: 1, green: 0.784, blue: 0.227)
private let charcoal = Color(red: 0.106, green: 0.102, blue: 0.09)
private let red = Color(red: 1, green: 0.54, blue: 0.5)

/// Squeek's mascot in the Dynamic Island, like a music app's icon while it plays in the background.
/// For half an hour after a likely scam it turns into a warning: pause before paying anyone.
struct SqueekLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: SqueekActivityAttributes.self) { context in
      LockScreenView(state: context.state)
        .activityBackgroundTint(charcoal)
        .activitySystemActionForegroundColor(yellow)
    } dynamicIsland: { context in
      DynamicIsland {
        DynamicIslandExpandedRegion(.leading) {
          Mascot(height: 34).padding(.leading, 4)
        }
        DynamicIslandExpandedRegion(.trailing) {
          if context.state.warning != nil {
            Image(systemName: "exclamationmark.triangle.fill")
              .font(.system(size: 22, weight: .bold))
              .foregroundStyle(red)
              .padding(.trailing, 4)
          } else {
            Text("\(context.state.protectionsOn)/\(context.state.protectionsTotal)")
              .font(.custom("Nunito-Black", size: 22))
              .foregroundStyle(yellow)
              .padding(.trailing, 4)
          }
        }
        DynamicIslandExpandedRegion(.center) {
          Text(context.state.warning == nil ? "Squeek" : "Be careful")
            .font(.custom("Nunito-Black", size: 20))
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(context.state.warning ?? status(context.state))
            .font(.custom("Nunito-Bold", size: 15))
            .foregroundStyle(context.state.warning == nil ? .secondary : .primary)
            .multilineTextAlignment(.center)
        }
      } compactLeading: {
        Mascot(height: 20)
      } compactTrailing: {
        Image(systemName: context.state.warning == nil ? "checkmark.shield.fill" : "exclamationmark.triangle.fill")
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(context.state.warning == nil ? yellow : red)
      } minimal: {
        Mascot(height: 18)
      }
      .widgetURL(URL(string: context.state.warning == nil ? "squeek://live" : "squeek://pause"))
      .keylineTint(context.state.warning == nil ? yellow : red)
    }
  }
}

private func status(_ state: SqueekActivityAttributes.ContentState) -> String {
  state.protectionsOn >= state.protectionsTotal
    ? "All protections are on."
    : "\(state.protectionsOn) of \(state.protectionsTotal) protections are on."
}

private struct Mascot: View {
  var height: CGFloat

  var body: some View {
    Image("SqueekMark")
      .resizable()
      .scaledToFit()
      .frame(height: height)
      .accessibilityHidden(true)
  }
}

private struct LockScreenView: View {
  let state: SqueekActivityAttributes.ContentState

  var body: some View {
    HStack(spacing: 14) {
      Mascot(height: 40)
      VStack(alignment: .leading, spacing: 2) {
        if let warning = state.warning {
          HStack(spacing: 6) {
            Text("Be careful")
              .font(.custom("Nunito-Black", size: 20))
              .foregroundStyle(red)
            if let date = state.warningDate {
              Text(date, style: .relative)
                .font(.custom("Nunito-Bold", size: 13))
                .foregroundStyle(.white.opacity(0.6))
            }
          }
          Text(warning)
            .font(.custom("Nunito-Bold", size: 15))
            .foregroundStyle(.white.opacity(0.9))
        } else {
          Text("Squeek")
            .font(.custom("Nunito-Black", size: 20))
            .foregroundStyle(.white)
          Text(status(state))
            .font(.custom("Nunito-Bold", size: 15))
            .foregroundStyle(.white.opacity(0.7))
        }
      }
      Spacer()
      if state.warning == nil {
        Text("\(state.protectionsOn)/\(state.protectionsTotal)")
          .font(.custom("Nunito-Black", size: 26))
          .foregroundStyle(yellow)
      }
    }
    .padding(16)
  }
}
