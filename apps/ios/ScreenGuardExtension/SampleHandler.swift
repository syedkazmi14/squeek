import CoreImage
import Foundation
import ReplayKit
import SqueekCore
import UserNotifications
import Vision

/// Screen Guard. While the person has started this broadcast, it reads the text on the screen about
/// every 30 seconds, on the phone, and checks it with the shared rules. Frames and the text read from
/// them are never saved or sent anywhere. On a likely scam it posts a notification and leaves a short
/// alert (headline and a redacted excerpt) in the App Group for the app to record.
///
/// A broadcast extension gets about 50 MB, so each sampled frame is shrunk before text recognition,
/// recognition runs in its fast mode, and frames that arrive while one is being read are dropped.
final class SampleHandler: RPBroadcastSampleHandler {
  private let policy = ScreenGuardPolicy()
  private let queue = DispatchQueue(label: "squeek.screenguard", qos: .utility)
  private let busyLock = NSLock()
  private var busy = false
  private var startedAt = Date()

  private let appGroup = (Bundle.main.object(forInfoDictionaryKey: "SqueekAppGroup") as? String) ?? ""
  private lazy var store = SharedStore(appGroup: appGroup)
  private lazy var checker = RuleSet.bundled().map(LocalChecker.init(rules:))
  private let imageContext = CIContext(options: [.cacheIntermediates: false])

  /// The longer side of the picture handed to text recognition. Plenty to read body text on a phone.
  private static let longestSide: CGFloat = 1400

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    startedAt = Date()
    store?.saveScreenGuardStatus(ScreenGuardStatus(startedAt: startedAt, lastFrameAt: startedAt))
  }

  override func broadcastFinished() {
    store?.clearScreenGuardStatus()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video, policy.shouldSample() else { return }
    guard tryBeginWork() else { return }
    guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer), let image = shrunk(pixels) else {
      endWork()
      return
    }
    store?.saveScreenGuardStatus(ScreenGuardStatus(startedAt: startedAt, lastFrameAt: Date()))
    queue.async { [self] in
      defer { endWork() }
      autoreleasepool { inspect(image) }
    }
  }

  // MARK: - Reading the screen

  private func shrunk(_ pixels: CVPixelBuffer) -> CGImage? {
    let source = CIImage(cvPixelBuffer: pixels)
    let scale = min(1, Self.longestSide / max(source.extent.width, source.extent.height))
    let scaled = source.transformed(by: CGAffineTransform(scaleX: scale, y: scale))
    return imageContext.createCGImage(scaled, from: scaled.extent)
  }

  private func inspect(_ image: CGImage) {
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .fast
    request.usesLanguageCorrection = false
    guard (try? VNImageRequestHandler(cgImage: image).perform([request])) != nil else { return }
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")

    guard ScreenGuardPolicy.hasEnoughText(text), !ScreenGuardPolicy.isOwnScreen(text), let checker else { return }
    let blocked = store?.blockList().domains.map(\.domain) ?? []
    let result = checker.checkText(text, blockedDomains: blocked)
    // Only a likely scam interrupts. A cautious reading of whatever happens to be on screen would
    // nag far too often.
    guard result.level == .danger, policy.shouldAlert(fingerprint: text.hashValue) else { return }

    let excerpt = result.reasons.compactMap(\.excerpt).first
    var alert = ScreenGuardAlert(
      headline: result.headline, excerpt: excerpt, reasons: result.reasons.map(\.label), notified: false)
    alert.notified = notify(headline: result.headline)
    store?.addScreenGuardAlert(alert)
  }

  /// Posts a notification and waits briefly for iOS to accept it. If a broadcast extension isn't
  /// allowed to, the alert still goes to the app, which shows the notification itself.
  private func notify(headline: String) -> Bool {
    let content = UNMutableNotificationContent()
    content.title = "This screen looks like a scam"
    content.body = "Squeek: \(headline). Don't pay, send codes or click anything yet."
    content.sound = .default
    let done = DispatchSemaphore(value: 0)
    var accepted = false
    UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: content, trigger: nil)) { error in
      accepted = error == nil
      done.signal()
    }
    _ = done.wait(timeout: .now() + 2)
    return accepted
  }

  // MARK: - One frame at a time

  private func tryBeginWork() -> Bool {
    busyLock.lock()
    defer { busyLock.unlock() }
    if busy { return false }
    busy = true
    return true
  }

  private func endWork() {
    busyLock.lock()
    busy = false
    busyLock.unlock()
  }
}
