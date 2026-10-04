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
  private let statusLock = NSLock()
  private var status = ScreenGuardStatus(startedAt: Date(), lastFrameAt: Date())

  private let appGroup = (Bundle.main.object(forInfoDictionaryKey: "SqueekAppGroup") as? String) ?? ""
  private lazy var store = SharedStore(appGroup: appGroup)
  private lazy var checker = RuleSet.bundled().map(LocalChecker.init(rules:))
  private let imageContext = CIContext(options: [.cacheIntermediates: false])

  /// The longer side of the picture handed to text recognition. Plenty to read body text on a phone.
  private static let longestSide: CGFloat = 1800

  override func broadcastStarted(withSetupInfo setupInfo: [String: NSObject]?) {
    startedAt = Date()
    statusLock.lock()
    status = ScreenGuardStatus(startedAt: startedAt, lastFrameAt: startedAt, looks: 0)
    statusLock.unlock()
    store?.saveScreenGuardStatus(status)
  }

  override func broadcastFinished() {
    store?.clearScreenGuardStatus()
  }

  override func processSampleBuffer(_ sampleBuffer: CMSampleBuffer, with sampleBufferType: RPSampleBufferType) {
    guard sampleBufferType == .video, policy.shouldSample() else { return }
    guard tryBeginWork() else { return }
    guard let pixels = CMSampleBufferGetImageBuffer(sampleBuffer), let image = shrunk(pixels) else {
      record("image_failed", characters: 0)
      endWork()
      return
    }
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
    guard (try? VNImageRequestHandler(cgImage: image).perform([request])) != nil else {
      record("no_text", characters: 0)
      return
    }
    let text = (request.results ?? []).compactMap { $0.topCandidates(1).first?.string }.joined(separator: "\n")

    guard ScreenGuardPolicy.hasEnoughText(text) else { return record("little_text", characters: text.count) }
    guard !ScreenGuardPolicy.isOwnScreen(text) else { return record("own_screen", characters: text.count) }
    guard let checker else { return record("no_rules", characters: text.count) }
    let blocked = store?.blockList().domains.map(\.domain) ?? []
    let result = checker.checkText(text, blockedDomains: blocked)
    record(result.level.rawValue, characters: text.count, signs: result.reasons.map(\.label))
    // A likely scam or something that may be one speaks up; clear screens stay quiet. The same screen
    // and back-to-back alerts are held back by the policy, so it doesn't nag.
    guard result.level == .danger || result.level == .caution, policy.shouldAlert(fingerprint: text.hashValue) else { return }

    let excerpt = result.reasons.compactMap(\.excerpt).first
    var alert = ScreenGuardAlert(
      headline: result.headline, excerpt: excerpt, reasons: result.reasons.map(\.label), notified: false,
      level: result.level.rawValue)
    alert.notified = notify(headline: result.headline, likely: result.level == .danger)
    store?.addScreenGuardAlert(alert)
  }

  /// Leaves a note of what the last look found (counts and a verdict, never the words) for the app.
  private func record(_ result: String, characters: Int, signs: [String]? = nil) {
    statusLock.lock()
    status.lastFrameAt = Date()
    status.looks = (status.looks ?? 0) + 1
    status.lastCharacters = characters
    status.lastResult = result
    status.lastSigns = signs.map { Array($0.prefix(4)) }
    let snapshot = status
    statusLock.unlock()
    store?.saveScreenGuardStatus(snapshot)
  }

  /// Posts a notification and waits briefly for iOS to accept it. If a broadcast extension isn't
  /// allowed to, the alert still goes to the app, which shows the notification itself.
  private func notify(headline: String, likely: Bool) -> Bool {
    let content = UNMutableNotificationContent()
    content.title = likely ? "This screen looks like a scam" : "This screen may be a scam"
    content.body = likely
      ? "Squeek: \(headline). Don't pay, send codes or click anything yet."
      : "Squeek: \(headline). Be careful, and check with someone you trust before you act."
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
