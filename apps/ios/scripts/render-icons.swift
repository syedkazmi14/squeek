// Renders Clickey's icons (incomplete forest-green ring with an ochre dot, v5 design direction).
// Run from apps/ios: swift scripts/render-icons.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func color(_ rgb: UInt32, _ a: CGFloat = 1) -> CGColor {
  CGColor(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: a)
}

func render(size: Int, background: Bool, ring: UInt32 = 0x1F4D3A, dot: UInt32 = 0x9A6A1E, to path: String) {
  let s = CGFloat(size)
  let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!,
    bitmapInfo: background ? CGImageAlphaInfo.noneSkipLast.rawValue : CGImageAlphaInfo.premultipliedLast.rawValue)!
  if background {
    ctx.setFillColor(color(0xFAF6EE))
    ctx.fill(CGRect(x: 0, y: 0, width: s, height: s))
  }
  let center = CGPoint(x: s * 0.47, y: s * 0.47)
  let radius = s * (background ? 0.27 : 0.36)
  ctx.setStrokeColor(color(ring))
  ctx.setLineWidth(radius * 0.36)
  ctx.setLineCap(.round)
  // Gap at the upper right, where the dot sits.
  ctx.addArc(center: center, radius: radius, startAngle: .pi * 0.42, endAngle: .pi * 0.08, clockwise: false)
  ctx.strokePath()
  ctx.setFillColor(color(dot))
  let d = radius * 0.5
  let dotCenter = CGPoint(x: center.x + radius * 0.98, y: center.y + radius * 0.98)
  ctx.fillEllipse(in: CGRect(x: dotCenter.x - d / 2, y: dotCenter.y - d / 2, width: d, height: d))

  let url = URL(fileURLWithPath: path)
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
  CGImageDestinationFinalize(dest)
}

render(size: 1024, background: true, to: "Clickey/Assets.xcassets/AppIcon.appiconset/AppIcon.png")
for size in [48, 96, 128, 256, 512] {
  render(size: size, background: true, to: "SafariExtension/Resources/images/icon-\(size).png")
}
render(size: 64, background: false, ring: 0x1C1B19, dot: 0x1C1B19, to: "SafariExtension/Resources/images/toolbar-icon.png")
print("icons rendered")
