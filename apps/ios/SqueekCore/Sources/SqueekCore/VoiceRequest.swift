import CryptoKit
import Foundation

/// What the app asks the speak function for, and how it remembers the answer. The phone's own
/// "speaking speed" setting runs 0.1 to 1.0 with 0.45 as normal; ElevenLabs takes 0.7 to 1.2 with
/// 1.0 as normal, so the two scales are lined up at "normal".
public enum VoiceRequest {
  public static let normalRate = 0.45

  public static func speed(forRate rate: Double) -> Double {
    let rate = min(max(rate, 0.1), 1.0)
    let speed = rate <= normalRate
      ? 0.7 + (rate - 0.1) / (normalRate - 0.1) * 0.3
      : 1.0 + (rate - normalRate) / (1.0 - normalRate) * 0.2
    // Two decimals: nearby slider positions share a cached recording.
    return (speed * 100).rounded() / 100
  }

  /// A file-name-safe key for a sentence at a speed.
  public static func cacheKey(text: String, speed: Double) -> String {
    let digest = SHA256.hash(data: Data("\(speed)|\(text)".utf8))
    return digest.map { String(format: "%02x", $0) }.joined()
  }
}
