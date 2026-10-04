import SwiftUI

/// Squeek, alive: the body bobs and breathes, the eyes blink and glance around, and the spark lines
/// pulse. Tapping him (or showing him for the first time) makes him hop. Concerned, he leans in and
/// looks down at what he's telling you. With Reduce Motion on he holds still.
///
/// The body is SqueekBody (the brand mark with its eyes painted over, see scripts/extract-body.swift);
/// the eyes and sparks are drawn here, at the positions measured from the mark.
struct MascotView: View {
  enum Mood { case calm, concerned }

  var mood: Mood = .calm
  /// Height of the whole mark, sparks included.
  var height: CGFloat = 170

  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @State private var start = Date()
  @State private var hopStart: Date?
  @State private var hops = 0

  // The mark is 368 × 286 px; everything below is a fraction of that.
  private static let aspect: CGFloat = 368 / 286
  private static let eyes: [(x: CGFloat, y: CGFloat)] = [(0.3781, 0.5079), (0.6296, 0.5165)]
  private static let eyeSize = CGSize(width: 0.1152, height: 0.1880)
  private static let sparks: [(x: CGFloat, y: CGFloat, length: CGFloat, thickness: CGFloat, angle: Double)] = [
    (0.2084, 0.0865, 0.146, 0.077, 67.5),
    (0.0982, 0.2073, 0.155, 0.081, 29.6),
    (0.0678, 0.3781, 0.139, 0.075, -3.1),
  ]
  private static let hopLength = 0.65

  var body: some View {
    TimelineView(.animation(paused: reduceMotion)) { context in
      frame(at: reduceMotion ? 0 : context.date.timeIntervalSince(start), now: context.date)
    }
    .frame(width: height * Self.aspect, height: height * 1.12, alignment: .top)
    .contentShape(Rectangle())
    .onTapGesture { hop() }
    .sensoryFeedback(.impact(flexibility: .soft), trigger: hops)
    .onAppear { if hopStart == nil { hop() } }
    .accessibilityHidden(true)
  }

  private func hop() {
    guard !reduceMotion else { return }
    hopStart = Date()
    hops += 1
  }

  private func frame(at t: Double, now: Date) -> some View {
    let w = height * Self.aspect
    let h = height
    let concerned = mood == .concerned

    // Idle bob and breath: a slow sine, quicker and shallower when concerned.
    let bobPeriod = concerned ? 1.6 : 2.8
    let bob = sin(t * 2 * .pi / bobPeriod)
    let breathe = sin(t * 4 * .pi / bobPeriod)

    // Hop: up and back down, with a wiggle that settles, and a squash when he lands.
    var hopLift = 0.0
    var wiggle = 0.0
    var landingSquash = 0.0
    if let hopStart, !reduceMotion {
      let e = now.timeIntervalSince(hopStart)
      if e < Self.hopLength {
        let p = e / Self.hopLength
        hopLift = sin(.pi * min(p / 0.8, 1))
        wiggle = sin(e * 28) * 7 * (1 - p)
        if p > 0.8 { landingSquash = sin(.pi * (p - 0.8) / 0.2) }
      }
    }

    let lift = CGFloat(bob) * h * 0.025 + CGFloat(hopLift) * h * 0.14
    let squashY = 1 + 0.02 * breathe - 0.08 * landingSquash
    let squashX = 1 - 0.015 * breathe + 0.06 * landingSquash
    let lean: Double = concerned ? -5 + sin(t * 2.2) * 1.5 : 0

    // Blink every few seconds, with an occasional double blink.
    let cycle = 4.3
    let inCycle = t.truncatingRemainder(dividingBy: cycle)
    let blinkTime = 0.16
    var lid = 1.0
    if t > 0 {
      if inCycle < blinkTime {
        lid = 1 - 0.92 * sin(.pi * inCycle / blinkTime)
      } else if Int(t / cycle) % 3 == 2, inCycle > 0.3, inCycle < 0.3 + blinkTime {
        lid = 1 - 0.92 * sin(.pi * (inCycle - 0.3) / blinkTime)
      }
    }

    // Glances: look right, back, left, back. Concerned, he looks down at the speech bubble.
    let glance = concerned ? 0 : glanceOffset(t)
    let lookX = CGFloat(glance) * w * 0.025
    let lookY: CGFloat = concerned ? h * 0.035 : 0

    return ZStack(alignment: .top) {
      // Shadow on the ground: smaller and fainter while he's in the air.
      Ellipse()
        .fill(Color.black.opacity(0.10 - 0.05 * hopLift))
        .frame(width: w * 0.55 * (1 - 0.25 * CGFloat(hopLift)), height: h * 0.07)
        .offset(x: w * 0.06, y: h * 1.02)
        .blur(radius: 4)

      ZStack {
        ForEach(Array(Self.sparks.enumerated()), id: \.offset) { index, spark in
          let pulse = sin(t * (concerned ? 9 : 2.4) - Double(index) * 0.9)
          Capsule()
            .fill(Theme.accent)
            .frame(width: w * spark.length * (0.88 + 0.12 * CGFloat(pulse)), height: h * spark.thickness)
            .rotationEffect(.degrees(spark.angle))
            .opacity(concerned ? 0.75 + 0.25 * pulse : 0.85 + 0.15 * pulse)
            .position(x: w * spark.x, y: h * spark.y)
        }

        ZStack {
          Image("SqueekBody")
            .resizable()
            .interpolation(.high)
            .frame(width: w, height: h)
          ForEach(Array(Self.eyes.enumerated()), id: \.offset) { _, eye in
            Ellipse()
              .fill(Theme.onAccent)
              .frame(width: w * Self.eyeSize.width, height: h * Self.eyeSize.height)
              .scaleEffect(x: 1, y: lid)
              .position(x: w * eye.x + lookX, y: h * eye.y + lookY)
          }
        }
        .scaleEffect(x: squashX, y: squashY, anchor: .bottom)
        .rotationEffect(.degrees(lean + wiggle), anchor: .bottom)
      }
      .frame(width: w, height: h)
      .offset(y: -lift)
    }
  }

  /// -1…1: where the eyes are looking along an 8-second loop, easing between positions.
  private func glanceOffset(_ t: Double) -> Double {
    let p = t.truncatingRemainder(dividingBy: 8)
    func ease(_ x: Double) -> Double { let c = min(max(x, 0), 1); return c * c * (3 - 2 * c) }
    switch p {
    case 2.0..<2.4: return ease((p - 2.0) / 0.4)
    case 2.4..<3.4: return 1
    case 3.4..<3.8: return 1 - ease((p - 3.4) / 0.4)
    case 5.5..<5.9: return -ease((p - 5.5) / 0.4)
    case 5.9..<6.7: return -1
    case 6.7..<7.1: return -1 + ease((p - 6.7) / 0.4)
    default: return 0
    }
  }
}
