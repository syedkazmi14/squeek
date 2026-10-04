// Renders Squeek's icons: the yellow mascot on warm charcoal.
// Run from apps/ios: swift scripts/extract-mark.swift && swift scripts/render-icons.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func color(_ rgb: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: a)
}

let markURL = URL(fileURLWithPath: "Shared/Assets.xcassets/SqueekMark.imageset/mark.png")
let mark = CGImageSourceCreateImageAtIndex(CGImageSourceCreateWithURL(markURL as CFURL, nil)!, 0, nil)!

/// `background`: charcoal square (app icon). Otherwise transparent, with the mark filled in `fill` (toolbar icon).
func render(size: Int, background: Bool, fill: UInt32? = nil, to path: String) {
  let s = CGFloat(size)
  let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: background ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue)!
  if background {
    ctx.setFillColor(color(0x1B1A17))
    ctx.fill(CGRect(x: 0, y: 0, width: s, height: s))
    // A faint warm glow behind the mascot.
    let glow = CGGradient(
      colorsSpace: CGColorSpace(name: CGColorSpace.sRGB)!,
      colors: [color(0xFFC83A, 0.16), color(0xFFC83A, 0)] as CFArray, locations: [0, 1])!
    ctx.drawRadialGradient(glow, startCenter: CGPoint(x: s / 2, y: s / 2), startRadius: 0, endCenter: CGPoint(x: s / 2, y: s / 2), endRadius: s * 0.5, options: [])
  }
  let width = s * (background ? 0.66 : 0.9)
  let height = width * CGFloat(mark.height) / CGFloat(mark.width)
  let rect = CGRect(x: (s - width) / 2, y: (s - height) / 2, width: width, height: height)
  ctx.interpolationQuality = .high
  if let fill {
    ctx.clip(to: rect, mask: mark)
    ctx.setFillColor(color(fill))
    ctx.fill(rect)
  } else {
    ctx.draw(mark, in: rect)
  }

  let url = URL(fileURLWithPath: path)
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
  CGImageDestinationFinalize(dest)
}

render(size: 1024, background: true, to: "Squeek/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
for size in [48, 96, 128, 256, 512] {
  render(size: size, background: true, to: "SafariExtension/Resources/images/icon-\(size).png")
}
render(size: 64, background: false, fill: 0x1B1A17, to: "SafariExtension/Resources/images/toolbar-icon.png")
print("icons rendered")
