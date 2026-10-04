import AVFoundation
import SqueekCore
import Combine

/// Speaks warnings aloud. When signed in, in Squeek's ElevenLabs voice (fetched from the server, which
/// holds the key, and remembered on the phone so a repeated sentence is instant and free). Anywhere
/// that fails, is offline or takes too long, it speaks with the phone's own voice instead, so a
/// warning is never silent. Once per result unless the person taps Replay.
/// Voice lookup and audio-session activation can block while assets load, so all speech work
/// runs on a private serial queue, never on the main thread. `isSpeaking` drives the waveform.
final class Speech: NSObject, ObservableObject, AVSpeechSynthesizerDelegate, AVAudioPlayerDelegate, @unchecked Sendable {
  static let shared = Speech()

  @Published private(set) var isSpeaking = false

  private let synthesizer = AVSpeechSynthesizer()
  private let queue = DispatchQueue(label: "squeek.speech", qos: .userInitiated)
  private var voice: AVSpeechSynthesisVoice?
  private var player: AVAudioPlayer?
  /// Bumped by every speak and stop, so a recording that arrives late for a sentence nobody is waiting for is dropped.
  private var generation = 0

  /// How long to wait for the server's voice before using the phone's own.
  private static let waitForVoice: Duration = .seconds(4)

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
      generation += 1
      let mine = generation
      stopPlayback()
      #if os(iOS)
        // .playback so warnings are heard even with the ring/silent switch on silent.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
      #endif
      guard Backend.shared.isSignedIn else { return speakLocally(text, rate: s.voiceRate) }
      setSpeaking(true)
      let speed = VoiceRequest.speed(forRate: s.voiceRate)
      Task { [self] in
        let recording = await Self.recording(of: text, speed: speed)
        self.queue.async { [self] in
          guard mine == generation else { return }
          if let recording, play(recording) { return }
          speakLocally(text, rate: s.voiceRate)
        }
      }
    }
  }

  func stop() {
    queue.async { [self] in
      generation += 1
      stopPlayback()
    }
  }

  // MARK: - Squeek's voice

  /// The recording from the phone's memory, or from the server within a few seconds. Nil means use the local voice.
  private static func recording(of text: String, speed: Double) async -> Data? {
    let file = cacheFile(for: VoiceRequest.cacheKey(text: text, speed: speed))
    if let cached = try? Data(contentsOf: file), !cached.isEmpty { return cached }
    let fetched: Data? = await withTaskGroup(of: Data?.self) { group in
      group.addTask { try? await Backend.shared.speak(text: text, speed: speed) }
      group.addTask {
        try? await Task.sleep(for: waitForVoice)
        return nil
      }
      let first = await group.next() ?? nil
      group.cancelAll()
      return first
    }
    guard let fetched, fetched.count > 1000 else { return nil }
    try? fetched.write(to: file, options: .atomic)
    return fetched
  }

  private static func cacheFile(for key: String) -> URL {
    let directory = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0].appendingPathComponent("squeek-voice", isDirectory: true)
    try? FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    return directory.appendingPathComponent("\(key).mp3")
  }

  /// Plays a recording; false if it can't be played, so the caller falls back to the local voice.
  private func play(_ data: Data) -> Bool {
    guard let player = try? AVAudioPlayer(data: data) else { return false }
    player.delegate = self
    self.player = player
    guard player.play() else {
      self.player = nil
      return false
    }
    setSpeaking(true)
    return true
  }

  func audioPlayerDidFinishPlaying(_ player: AVAudioPlayer, successfully flag: Bool) {
    queue.async { [self] in
      if self.player === player {
        self.player = nil
        setSpeaking(false)
      }
    }
  }

  // MARK: - The phone's own voice

  private func speakLocally(_ text: String, rate: Double) {
    if voice == nil {
      voice = AVSpeechSynthesisVoice(language: Locale.preferredLanguages.first ?? "en-US")
    }
    let utterance = AVSpeechUtterance(string: text)
    utterance.rate = Float(min(max(rate, 0.1), 1.0)) * AVSpeechUtteranceMaximumSpeechRate
    utterance.voice = voice
    synthesizer.speak(utterance)
  }

  private func stopPlayback() {
    player?.stop()
    player = nil
    if synthesizer.isSpeaking { synthesizer.stopSpeaking(at: .immediate) }
    setSpeaking(false)
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
