// Cuts Squeek's mascot (without the wordmark) out of docs/brand/squeek-logo.png onto a transparent
// background. Run from apps/ios: swift scripts/extract-mark.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

let source = "../../docs/brand/squeek-logo.png"
let output = "Shared/Assets.xcassets/SqueekMark.imageset/mark.png"
// Crop box in the source image: the mascot and its spark lines, stopping short of the "S".
let crop = CGRect(x: 420, y: 238, width: 384, height: 312)

guard let imageSource = CGImageSourceCreateWithURL(URL(fileURLWithPath: source) as CFURL, nil),
  let src = CGImageSourceCreateImageAtIndex(imageSource, 0, nil),
  let cropped = src.cropping(to: crop)
else { fatalError("cannot read logo") }

let w = cropped.width, h = cropped.height
var px = [UInt8](repeating: 0, count: w * h * 4)
let ctx = CGContext(
  data: &px, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
ctx.draw(cropped, in: CGRect(x: 0, y: 0, width: w, height: h))

func level(_ i: Int) -> Int { Int(max(px[i * 4], px[i * 4 + 1], px[i * 4 + 2])) }

// Background = dark pixels connected to the border; the dark eyes stay inside the mascot.
let threshold = 70
var outside = [Bool](repeating: false, count: w * h)
var queue: [Int] = []
func seed(_ i: Int) { if !outside[i], level(i) < threshold { outside[i] = true; queue.append(i) } }
for x in 0..<w { seed(x); seed((h - 1) * w + x) }
for y in 0..<h { seed(y * w); seed(y * w + w - 1) }
var head = 0
while head < queue.count {
  let i = queue[head]; head += 1
  let x = i % w, y = i / w
  if x > 0 { seed(i - 1) }
  if x < w - 1 { seed(i + 1) }
  if y > 0 { seed(i - w) }
  if y < h - 1 { seed(i + w) }
}

var out = [UInt8](repeating: 0, count: w * h * 4)
for y in 0..<h {
  for x in 0..<w {
    let i = y * w + x
    if outside[i] { continue }
    var alpha = 255.0
    let left = x > 0 && outside[i - 1]
    let right = x < w - 1 && outside[i + 1]
    let up = y > 0 && outside[i - w]
    let down = y < h - 1 && outside[i + w]
    let nearOutside = left || right || up || down
    if nearOutside { alpha = min(255, max(0, Double(level(i) - threshold) / 90 * 255)) }
    // Un-premultiply against black so edge pixels keep the yellow instead of going muddy.
    let scale = nearOutside ? 255.0 / Double(max(level(i), 1)) : 1
    for c in 0..<3 { out[i * 4 + c] = UInt8(min(255, Double(px[i * 4 + c]) * scale * alpha / 255)) }
    out[i * 4 + 3] = UInt8(alpha)
  }
}

// Trim to the painted area.
var minX = w, minY = h, maxX = 0, maxY = 0
for y in 0..<h { for x in 0..<w where out[(y * w + x) * 4 + 3] > 8 { minX = min(minX, x); maxX = max(maxX, x); minY = min(minY, y); maxY = max(maxY, y) } }
let tw = maxX - minX + 1, th = maxY - minY + 1
var trimmed = [UInt8](repeating: 0, count: tw * th * 4)
for y in 0..<th { for x in 0..<tw { for c in 0..<4 { trimmed[(y * tw + x) * 4 + c] = out[((y + minY) * w + x + minX) * 4 + c] } } }

let provider = CGDataProvider(data: Data(trimmed) as CFData)!
let image = CGImage(
  width: tw, height: th, bitsPerComponent: 8, bitsPerPixel: 32, bytesPerRow: tw * 4,
  space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGBitmapInfo(rawValue: CGImageAlphaInfo.premultipliedLast.rawValue),
  provider: provider, decode: nil, shouldInterpolate: true, intent: .defaultIntent)!
let dest = CGImageDestinationCreateWithURL(URL(fileURLWithPath: output) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(dest, image, nil)
CGImageDestinationFinalize(dest)
print("mark \(tw)x\(th)")
