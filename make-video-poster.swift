// make-video-poster.swift
//
// The first frame of a video as a still (PNG), shown while the video loads — so its slide
// never shows white first. Videos always start from their first frame (see rewindVideo).
//
//   swift make-video-poster.swift <in.mp4> <out.png> [max width]
//
// generate-manifests.js runs it and turns the PNG into a WebP (cwebp).
import AVFoundation
import Foundation
import ImageIO
import UniformTypeIdentifiers

let args = CommandLine.arguments
guard args.count >= 3 else { print("usage: swift make-video-poster.swift <in.mp4> <out.png> [max width]"); exit(1) }
let maxW = args.count > 3 ? Double(args[3]) ?? 1920 : 1920
let gen = AVAssetImageGenerator(asset: AVURLAsset(url: URL(fileURLWithPath: args[1])))
gen.appliesPreferredTrackTransform = true
gen.requestedTimeToleranceBefore = .zero
gen.requestedTimeToleranceAfter = .zero
gen.maximumSize = CGSize(width: maxW, height: maxW * 4)
let sema = DispatchSemaphore(value: 0)
gen.generateCGImageAsynchronously(for: .zero) { image, _, error in
  guard let image else { print("error: \(String(describing: error))"); exit(1) }
  let url = URL(fileURLWithPath: args[2]) as CFURL
  guard let dest = CGImageDestinationCreateWithURL(url, UTType.png.identifier as CFString, 1, nil) else { print("cannot write"); exit(1) }
  CGImageDestinationAddImage(dest, image, nil)
  if CGImageDestinationFinalize(dest) { print("wrote \(args[2]) \(image.width)×\(image.height)") } else { print("write failed"); exit(1) }
  sema.signal()
}
sema.wait()
