import CoreGraphics
import ImageIO
import Foundation
import UniformTypeIdentifiers

let size = 1024
let colorSpace = CGColorSpaceCreateDeviceRGB()
let context = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0, space: colorSpace, bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
context.setAllowsAntialiasing(true)
context.setShouldAntialias(true)
context.clear(CGRect(x: 0, y: 0, width: size, height: size))
let sage = CGColor(colorSpace: colorSpace, components: [166/255, 201/255, 145/255, 1])!
let navy = CGColor(colorSpace: colorSpace, components: [5/255, 44/255, 101/255, 1])!
func rounded(_ rect: CGRect, radius: CGFloat, color: CGColor) {
    context.addPath(CGPath(roundedRect: rect, cornerWidth: radius, cornerHeight: radius, transform: nil))
    context.setFillColor(color)
    context.fillPath()
}
rounded(CGRect(x: 40, y: 40, width: 944, height: 944), radius: 198, color: sage)
rounded(CGRect(x: 85, y: 85, width: 854, height: 854), radius: 157, color: navy)
let cell: CGFloat = 184
let gap: CGFloat = 30
let origin: CGFloat = 206
for row in 0..<3 {
    for column in 0..<3 {
        let x = origin + CGFloat(column) * (cell + gap)
        let y = origin + CGFloat(row) * (cell + gap)
        rounded(CGRect(x: x, y: y, width: cell, height: cell), radius: 34, color: sage)
        rounded(CGRect(x: x + 14, y: y + 14, width: cell - 28, height: cell - 28), radius: 23, color: navy)
    }
}
let image = context.makeImage()!
let destination = CGImageDestinationCreateWithURL(URL(fileURLWithPath: CommandLine.arguments[1]) as CFURL, UTType.png.identifier as CFString, 1, nil)!
CGImageDestinationAddImage(destination, image, nil)
assert(CGImageDestinationFinalize(destination))
