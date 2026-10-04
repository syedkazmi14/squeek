import SwiftUI

#if canImport(VisionKit) && os(iOS)
  import VisionKit
#endif

/// Signs Clickey on a computer into this account by scanning the QR code it shows.
struct PairComputerView: View {
  @EnvironmentObject private var model: AppModel
  @State private var code = ""
  @State private var scanning = false
  @State private var paired = false
  @State private var working = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 18) {
        VStack(alignment: .leading, spacing: 10) {
          Image(systemName: paired ? "checkmark.circle.fill" : "desktopcomputer")
            .font(.system(size: 44, weight: .medium))
            .foregroundStyle(Theme.forest)
            .contentTransition(.symbolEffect(.replace))
          Text(paired ? "Computer connected" : "Connect your computer")
            .font(.display(.title))
            .foregroundStyle(Theme.ink)
          Text(
            paired
              ? "It finishes signing in by itself. Warnings now sync between your iPhone and computer."
              : "On your computer, open Clickey and choose Connect to iPhone. A code appears on the screen."
          )
          .font(.title3)
          .foregroundStyle(Theme.secondaryInk)
          .fixedSize(horizontal: false, vertical: true)
        }

        if !paired {
          if QRScanner.isAvailable {
            Button {
              scanning = true
            } label: {
              Label("Scan the code", systemImage: "qrcode.viewfinder")
            }
            .primaryAction()
          }
          VStack(alignment: .leading, spacing: 12) {
            Text("Or type the code").font(.headline)
            TextField("8-character code", text: $code)
              .textInputAutocapitalization(.characters)
              .autocorrectionDisabled()
              .font(.title2.monospaced())
              .padding(14)
              .background(Theme.ground, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            Button {
              Task { await claim(code) }
            } label: {
              if working { ProgressView() } else { Text("Connect") }
            }
            .secondaryAction()
            .disabled(code.filter { $0.isLetter || $0.isNumber }.count < 8 || working)
          }
          .card(padding: 20)
        }
      }
      .padding(Theme.pagePadding)
    }
    .screenBackground()
    .navigationTitle("Connect a computer")
    .navigationBarTitleDisplayMode(.inline)
    .sheet(isPresented: $scanning) {
      QRScanner { value in
        scanning = false
        Task { await claim(value) }
      }
      .ignoresSafeArea()
    }
  }

  private func claim(_ value: String) async {
    working = true
    defer { working = false }
    let ok = await model.pairComputer(code: value)
    withAnimation(.spring) { paired = ok }
  }
}

#if canImport(VisionKit) && os(iOS)
  /// Live camera QR scanner (VisionKit). Not available in the Simulator.
  struct QRScanner: UIViewControllerRepresentable {
    var onScan: (String) -> Void

    @MainActor static var isAvailable: Bool {
      DataScannerViewController.isSupported && DataScannerViewController.isAvailable
    }

    func makeUIViewController(context: Context) -> DataScannerViewController {
      let controller = DataScannerViewController(
        recognizedDataTypes: [.barcode(symbologies: [.qr])], qualityLevel: .balanced, isHighlightingEnabled: true)
      controller.delegate = context.coordinator
      try? controller.startScanning()
      return controller
    }

    func updateUIViewController(_ controller: DataScannerViewController, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(onScan: onScan) }

    final class Coordinator: NSObject, DataScannerViewControllerDelegate {
      let onScan: (String) -> Void
      private var done = false

      init(onScan: @escaping (String) -> Void) { self.onScan = onScan }

      func dataScanner(_ scanner: DataScannerViewController, didAdd items: [RecognizedItem], allItems: [RecognizedItem]) {
        guard !done else { return }
        for case .barcode(let barcode) in items {
          if let value = barcode.payloadStringValue, value.lowercased().hasPrefix("clickey-pair:") {
            done = true
            scanner.stopScanning()
            onScan(value)
            return
          }
        }
      }
    }
  }
#else
  struct QRScanner: View {
    var onScan: (String) -> Void
    static var isAvailable: Bool { false }
    var body: some View { EmptyView() }
  }
#endif
