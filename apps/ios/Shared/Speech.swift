import AVFoundation
import SqueekCore
import Combine

/// Speaks warnings on the device. Once per result unless the person taps Replay.
/// Voice lookup and audio-session activation can block while assets load, so all speech work
/// runs on a private serial queue, never on the main thread. `isSpeaking` drives the waveform.
final class Speech: NSObject, ObservableObject, AVSpeechSynthesizerDelegate, @unchecked Sendable {
  static let shared = Speech()

  @Published private(set) var isSpeaking = false

  private let synthesizer = AVSpeechSynthesizer()
  private let queue = DispatchQueue(label: "squeek.speech", qos: .userInitiated)
  private var voice: AVSpeechSynthesisVoice?

  override init() {
    super.init()
    synthesizer.delegate = self
  }

  var settings: SharedSettings {
    SharedStore(appGroup: SqueekConfig.appGroup)?.settings() ?? SharedSettings()
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

  private func setSpeaking(_ value: Bool) {
    DispatchQueue.main.async { self.isSpeaking = value }
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didStart utterance: AVSpeechUtterance) {
    setSpeaking(true)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) {
    setSpeaking(false)
  }

  func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) {
    setSpeaking(false)
  }
}
