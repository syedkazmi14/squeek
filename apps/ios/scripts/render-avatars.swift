// Draws the two demo profile pictures (Syed and Aisha) as flat illustrations.
// Run from apps/ios: swift scripts/render-avatars.swift
import CoreGraphics
import Foundation
import ImageIO
import UniformTypeIdentifiers

func color(_ rgb: UInt32) -> CGColor {
  CGColor(red: CGFloat((rgb >> 16) & 0xFF) / 255, green: CGFloat((rgb >> 8) & 0xFF) / 255, blue: CGFloat(rgb & 0xFF) / 255, alpha: 1)
}

struct Look {
  var name: String
  var background: UInt32
  var skin: UInt32
  var shade: UInt32
  var hair: UInt32
  var shirt: UInt32
  var longHair: Bool
  var beard: Bool
}

func render(_ look: Look, size: Int = 512) {
  let s = CGFloat(size)
  let ctx = CGContext(
    data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
    space: CGColorSpace(name: CGColorSpace.sRGB)!, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
  ctx.setAllowsAntialiasing(true)
  // Origin is bottom-left; everything is laid out in a 100-unit square and scaled.
  ctx.scaleBy(x: s / 100, y: s / 100)
  func fill(_ rgb: UInt32, _ draw: () -> Void) {
    ctx.setFillColor(color(rgb))
    draw()
    ctx.fillPath()
  }

  fill(look.background) { ctx.addRect(CGRect(x: 0, y: 0, width: 100, height: 100)) }
  // Soft sun behind the head.
  ctx.setFillColor(color(0xFFFFFF).copy(alpha: 0.28)!)
  ctx.fillEllipse(in: CGRect(x: 18, y: 28, width: 64, height: 64))

  if look.longHair {
    // Hair behind the shoulders.
    fill(look.hair) {
      ctx.addPath(CGPath(roundedRect: CGRect(x: 27, y: 14, width: 46, height: 62), cornerWidth: 22, cornerHeight: 22, transform: nil))
    }
  }

  // Shoulders and shirt.
  fill(look.shirt) {
    ctx.addPath(CGPath(roundedRect: CGRect(x: 10, y: -30, width: 80, height: 62), cornerWidth: 34, cornerHeight: 34, transform: nil))
  }
  // Neck.
  fill(look.shade) { ctx.addPath(CGPath(roundedRect: CGRect(x: 42, y: 28, width: 16, height: 18), cornerWidth: 6, cornerHeight: 6, transform: nil)) }
  // Collar.
  fill(look.skin) {
    ctx.move(to: CGPoint(x: 40, y: 34))
    ctx.addLine(to: CGPoint(x: 60, y: 34))
    ctx.addLine(to: CGPoint(x: 50, y: 24))
    ctx.closePath()
  }

  // Head.
  fill(look.skin) { ctx.addEllipse(in: CGRect(x: 30, y: 36, width: 40, height: 46)) }
  // Ears.
  fill(look.skin) {
    ctx.addEllipse(in: CGRect(x: 26.5, y: 52, width: 8, height: 11))
    ctx.addEllipse(in: CGRect(x: 65.5, y: 52, width: 8, height: 11))
  }

  if look.beard {
    fill(look.hair) {
      ctx.move(to: CGPoint(x: 31, y: 55))
      ctx.addCurve(to: CGPoint(x: 50, y: 33), control1: CGPoint(x: 30, y: 40), control2: CGPoint(x: 40, y: 33))
      ctx.addCurve(to: CGPoint(x: 69, y: 55), control1: CGPoint(x: 60, y: 33), control2: CGPoint(x: 70, y: 40))
      ctx.addCurve(to: CGPoint(x: 62, y: 49), control1: CGPoint(x: 68, y: 54), control2: CGPoint(x: 66, y: 50))
      ctx.addCurve(to: CGPoint(x: 38, y: 49), control1: CGPoint(x: 56, y: 44), control2: CGPoint(x: 44, y: 44))
      ctx.addCurve(to: CGPoint(x: 31, y: 55), control1: CGPoint(x: 34, y: 50), control2: CGPoint(x: 32, y: 54))
      ctx.closePath()
    }
  }

  // Hair on top.
  fill(look.hair) {
    if look.longHair {
      ctx.move(to: CGPoint(x: 28, y: 60))
      ctx.addCurve(to: CGPoint(x: 50, y: 88), control1: CGPoint(x: 26, y: 78), control2: CGPoint(x: 38, y: 88))
      ctx.addCurve(to: CGPoint(x: 72, y: 60), control1: CGPoint(x: 62, y: 88), control2: CGPoint(x: 74, y: 78))
      ctx.addCurve(to: CGPoint(x: 58, y: 70), control1: CGPoint(x: 70, y: 70), control2: CGPoint(x: 66, y: 72))
      ctx.addCurve(to: CGPoint(x: 40, y: 72), control1: CGPoint(x: 52, y: 68), control2: CGPoint(x: 46, y: 76))
      ctx.addCurve(to: CGPoint(x: 28, y: 60), control1: CGPoint(x: 34, y: 70), control2: CGPoint(x: 30, y: 66))
      ctx.closePath()
    } else {
      ctx.move(to: CGPoint(x: 29, y: 62))
      ctx.addCurve(to: CGPoint(x: 50, y: 86), control1: CGPoint(x: 27, y: 78), control2: CGPoint(x: 38, y: 87))
      ctx.addCurve(to: CGPoint(x: 71, y: 62), control1: CGPoint(x: 62, y: 87), control2: CGPoint(x: 73, y: 78))
      ctx.addCurve(to: CGPoint(x: 62, y: 70), control1: CGPoint(x: 70, y: 66), control2: CGPoint(x: 67, y: 69))
      ctx.addCurve(to: CGPoint(x: 38, y: 71), control1: CGPoint(x: 54, y: 74), control2: CGPoint(x: 45, y: 75))
      ctx.addCurve(to: CGPoint(x: 29, y: 62), control1: CGPoint(x: 33, y: 69), control2: CGPoint(x: 30, y: 66))
      ctx.closePath()
    }
  }

  // Eyes and brows.
  fill(0x2B1B14) {
    ctx.addEllipse(in: CGRect(x: 38.5, y: 55, width: 5, height: 6))
    ctx.addEllipse(in: CGRect(x: 56.5, y: 55, width: 5, height: 6))
  }
  ctx.setStrokeColor(color(look.hair))
  ctx.setLineWidth(1.8)
  ctx.setLineCap(.round)
  ctx.move(to: CGPoint(x: 37.5, y: 65)); ctx.addQuadCurve(to: CGPoint(x: 45, y: 65.5), control: CGPoint(x: 41, y: 67.5)); ctx.strokePath()
  ctx.move(to: CGPoint(x: 55, y: 65.5)); ctx.addQuadCurve(to: CGPoint(x: 62.5, y: 65), control: CGPoint(x: 59, y: 67.5)); ctx.strokePath()
  // Smile.
  ctx.setStrokeColor(color(look.beard ? 0xF3D9C8 : 0x9A4B3A))
  ctx.setLineWidth(2)
  ctx.move(to: CGPoint(x: 44, y: 46.5)); ctx.addQuadCurve(to: CGPoint(x: 56, y: 46.5), control: CGPoint(x: 50, y: 41)); ctx.strokePath()
  // Cheeks.
  if !look.beard {
    ctx.setFillColor(color(0xE8836F).copy(alpha: 0.28)!)
    ctx.fillEllipse(in: CGRect(x: 34, y: 47, width: 7, height: 5))
    ctx.fillEllipse(in: CGRect(x: 59, y: 47, width: 7, height: 5))
  }

  let url = URL(fileURLWithPath: "Squeek/Assets.xcassets/Avatar\(look.name).imageset/avatar.png")
  try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
  let dest = CGImageDestinationCreateWithURL(url as CFURL, UTType.png.identifier as CFString, 1, nil)!
  CGImageDestinationAddImage(dest, ctx.makeImage()!, nil)
  CGImageDestinationFinalize(dest)
  let contents = """
    {
      "images" : [ { "filename" : "avatar.png", "idiom" : "universal" } ],
      "info" : { "author" : "xcode", "version" : 1 }
    }
    """
  try? contents.write(to: url.deletingLastPathComponent().appendingPathComponent("Contents.json"), atomically: true, encoding: .utf8)
}

render(Look(name: "Syed", background: 0xBFD8C8, skin: 0xC98F6B, shade: 0xB57A58, hair: 0x2A1D17, shirt: 0x3C5A78, longHair: false, beard: true))
render(Look(name: "Aisha", background: 0xF4C9A8, skin: 0xD8A07E, shade: 0xC28963, hair: 0x1E1512, shirt: 0xC4503A, longHair: true, beard: false))
print("avatars rendered")
