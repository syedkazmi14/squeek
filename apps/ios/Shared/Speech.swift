import AVFoundation
import ClickeyCore

/// Speaks warnings on the device. Once per result unless the person taps Replay.
/// Voice lookup and audio-session activation can block while assets load, so all speech work
/// runs on a private serial queue, never on the main thread.
final class Speech: NSObject, @unchecked Sendable {
  static let shared = Speech()
  private let synthesizer = AVSpeechSynthesizer()
  private let queue = DispatchQueue(label: "clickey.speech", qos: .userInitiated)
  private var voice: AVSpeechSynthesisVoice?

  var settings: SharedSettings {
    SharedStore(appGroup: ClickeyConfig.appGroup)?.settings() ?? SharedSettings()
  }

  func speak(_ text: String, force: Bool = false) {
    queue.async { [self] in
      let s = settings
      guard force || !s.muted else { return }
      if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
      #if os(iOS)
        // .playback so warnings are heard even with the ring/silent switch on silent.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
      #endif
      if voice == nil {
        voice = AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first ?? "en-US")
      }
      let utterance = AVSpeechUtterance(string: text)
      utterance.rate = Float(min(max(s.voiceRate, 0.1), 1.0)) * AVSpeechUtteranceMaximumSpeechRate
      utterance.voice = voice
      synthesizer.speak(utterance)
    }
  }

  func stop() {
    queue.async { [self] in
      if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    }
  }
}
