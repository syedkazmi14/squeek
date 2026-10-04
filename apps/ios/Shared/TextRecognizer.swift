import CoreGraphics
import Foundation
@preconcurrency import Vision

/// On-device text recognition for screenshots. Images never leave the phone; only the text does,
/// after redaction.
enum TextRecognizer {
  static func recognize(_ image: CGImage) async throws -> String {
    try await withCheckedThrowingContinuation { continuation in
      let request = VNRecognizeTextRequest { request, error in
        if let error {
          continuation.resume(throwing: error)
          return
        }
        let lines = (request.results as? [VNRecognizedTextObservation] ?? [])
          .compactMap { $0.topCandidates(1).first?.string }
        continuation.resume(returning: lines.joined(separator: "\n"))
      }
      request.recognitionLevel = .accurate
      request.usesLanguageCorrection = true
      DispatchQueue.global(qos: .userInitiated).async {
        do {
          try VNImageRequestHandler(cgImage: image).perform([request])
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }
}
