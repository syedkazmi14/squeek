import ActivityKit
import SwiftUI
import WidgetKit

private let yellow = Color(red: 1, green: 0.784, blue: 0.227)
private let charcoal = Color(red: 0.106, green: 0.102, blue: 0.09)

/// Squeek's mascot in the Dynamic Island, like a music app's icon while it plays in the background.
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
          Text("\(context.state.protectionsOn)/\(context.state.protectionsTotal)")
            .font(.custom("Nunito-Black", size: 22))
            .foregroundStyle(yellow)
            .padding(.trailing, 4)
        }
        DynamicIslandExpandedRegion(.center) {
          Text("Squeek")
            .font(.custom("Nunito-Black", size: 20))
        }
        DynamicIslandExpandedRegion(.bottom) {
          Text(status(context.state))
            .font(.custom("Nunito-Bold", size: 15))
            .foregroundStyle(.secondary)
        }
      } compactLeading: {
        Mascot(height: 20)
      } compactTrailing: {
        Image(systemName: "checkmark.shield.fill")
          .font(.system(size: 14, weight: .bold))
          .foregroundStyle(yellow)
      } minimal: {
        Mascot(height: 18)
      }
      .widgetURL(URL(string: "squeek://live"))
      .keylineTint(yellow)
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
        Text("Squeek")
          .font(.custom("Nunito-Black", size: 20))
          .foregroundStyle(.white)
        Text(status(state))
          .font(.custom("Nunito-Bold", size: 15))
          .foregroundStyle(.white.opacity(0.7))
      }
      Spacer()
      Text("\(state.protectionsOn)/\(state.protectionsTotal)")
        .font(.custom("Nunito-Black", size: 26))
        .foregroundStyle(yellow)
    }
    .padding(16)
  }
}
