// Makes the animated mascot's body: SqueekMark without its spark lines and with the eyes painted
// over, so the app can draw blinking eyes and pulsing sparks on top (MascotView in Shared/).
// Prints the eye and spark geometry as fractions of the mark. Run from apps/ios after
// extract-mark.swift: swift scripts/extract-body.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let source = "Shared/Assets.xcassets/SqueekMark.imageset/mark.png"
let output = "Shared/Assets.xcassets/SqueekBody.imageset/body.png"

guard let imageSource = CGImageSourceCreateWithURL(URL(fileURLWithPath: source) as CFURL, nil),
  let src = CGImageSourceCreateImageAtIndex(imageSource, 0, nil)
else { fatalError("cannot read mark") }

let w = src.width, h = src.height
var px = [UInt8](repeating: 0, count: w * h * 4)
let ctx = CGContext(
  data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(src, in: CGRect(x: 0, y: 0, width: w, height: h))

func alpha(_ i: Int) -> Int { Int(px[i * 4 + 3]) }
func level(_ i: Int) -> Int { Int(max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) }

/// 4-connected components of the pixels where `inside` holds.
func components(_ inside: (Int) -> Bool) -> [[Int]] {
  var seen = [Bool](repeating: false, count: w * h)
  var result: [[Int]] = []
  for start in 0..<(w * h) where !seen[start] && inside(start) {
    var queue = [start]
    seen[start] = true
    var head = 0
    while head < queue.count {
      let i = queue[head]; head += 1
      let x = i % w, y = i / w
      for n in [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]
      where n >= 0 && !seen[n] && inside(n) {
        seen[n] = true
        queue.append(n)
      }
    }
    result.append(queue)
  }
  return result
}

func describe(_ name: String, _ pixels: [Int]) {
  let xs = pixels.map { Double($0 % w) }, ys = pixels.map { Double($0 / w) }
  let cx = xs.reduce(0, +) / Double(xs.count), cy = ys.reduce(0, +) / Double(ys.count)
  // Principal axis, for the spark lines' angle and length.
  var sxx = 0.0, syy = 0.0, sxy = 0.0
  for (x, y) in zip(xs, ys) { sxx += (x - cx) * (x - cx); syy += (y - cy) * (y - cy); sxy += (x - cx) * (y - cy) }
  let angle = 0.5 * atan2(2 * sxy, sxx - syy)
  let along = zip(xs, ys).map { ($0 - cx) * cos(angle) + ($1 - cy) * sin(angle) }
  let across = zip(xs, ys).map { -($0 - cx) * sin(angle) + ($1 - cy) * cos(angle) }
  let length = along.max()! - along.min()! + 1, thickness = across.max()! - across.min()! + 1
  print(
    String(
      format: "%@ center (%.4f, %.4f) size (%.4f, %.4f) angle %.1f°", name, cx / Double(w), cy / Double(h),
      length / Double(w), thickness / Double(h), angle * 180 / .pi))
}

// The body is the biggest painted blob; the rest are the three spark lines.
let painted = components { alpha($0) > 8 }.sorted { $0.count > $1.count }
let body = Set(painted[0])
for (n, spark) in painted.dropFirst().filter({ $0.count > 30 }).enumerated() { describe("spark \(n + 1)", spark) }

// Eyes: dark blobs inside the body. Grow each by a few pixels to take in the soft edge.
let eyes = components { body.contains($0) && level($0) < 120 }.filter { $0.count > 40 }.sorted { $0[0] % w < $1[0] % w }
for (n, eye) in eyes.enumerated() { describe("eye \(n + 1)", eye) }
var eyeMask = [Bool](repeating: false, count: w * h)
for eye in eyes { for i in eye { eyeMask[i] = true } }
for _ in 0..<9 {
  var grown = eyeMask
  for i in 0..<(w * h) where eyeMask[i] {
    let x = i % w, y = i / w
    for n in [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1] where n >= 0 { grown[n] = true }
  }
  eyeMask = grown
}

var out = [UInt8](repeating: 0, count: w * h * 4)
for i in body { for c in 0..<4 { out[i * 4 + c] = px[i * 4 + c] } }
// Paint over each eye row by blending the body colour just left and right of it.
for y in 0..<h {
  var x = 0
  while x < w {
    guard eyeMask[y * w + x] else { x += 1; continue }
    var end = x
    while end < w && eyeMask[y * w + end] { end += 1 }
    let left = y * w + max(x - 1, 0), right = y * w + min(end, w - 1)
    for xi in x..<end {
      let t = Double(xi - x + 1) / Double(end - x + 1)
      for c in 0..<4 { out[(y * w + xi) * 4 + c] = UInt8(Double(px[left * 4 + c]) * (1 - t) + Double(px[right * 4 + c]) * t) }
    }
    x = end
  }
}
// Then smooth each patch by relaxing it towards the average of its neighbours (a harmonic fill),
// so it blends into the body with no seams or stripes.
for _ in 0..<400 {
  for i in 0..<(w * h) where eyeMask[i] {
    let x = i % w, y = i / w
    guard x > 0, x < w - 1, y > 0, y < h - 1 else { continue }
    for c in 0..<4 {
      let sum = [i - w, i - 1, i + 1, i + w].reduce(0) { $0 + Int(out[$1 * 4 + c]) }
      out[i * 4 + c] = UInt8(sum / 4)
    }
  }
}

try? FileManager.default.createDirectory(
  atPath: (output as NSString).deletingLastPathComponent, withIntermediateDirectories: true)
let provider = CGDataProvider(data: Data(out) as CFData)!
let image = CGImage(
  width: w, height: h, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: w * 4,
  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
  provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("body \(w)x\(h)")
