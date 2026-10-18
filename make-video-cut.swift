// make-video-cut.swift
//
// A lighter copy of a home-feed video at a given size: scaled to cover that frame and
// cropped to its centre — exactly what the site shows there with object-fit: cover.
// H.264 MP4 with the index at the start (plays while it loads), no audio, a keyframe
// every second. Plays in every browser.
//
//   swift make-video-cut.swift <in.mp4> <out.mp4> <width> <height> [bits per second]
//
// generate-manifests.js makes two per video (and keeps the original as the fallback):
//   sizes/<name>-portrait.mp4  1296×1620, 2.5 Mbit/s — phones (the 4:5 slice they show)
//   sizes/<name>-1080.mp4      1920×1080, 5 Mbit/s   — everything else
import AVFoundation
import Foundation

let args = CommandLine.arguments
guard args.count >= 5, let OUT_W = Int(args[3]), let OUT_H = Int(args[4]) else {
  print("usage: swift make-video-cut.swift <in.mp4> <out.mp4> <width> <height> [bits per second]"); exit(1)
}
let BITRATE = args.count > 5 ? Int(args[5]) ?? 2_500_000 : 2_500_000
let src = URL(fileURLWithPath: args[1]), dst = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: dst)

let asset = AVURLAsset(url: src)
let sema = DispatchSemaphore(value: 0)
Task {
  do {
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { print("no video track"); exit(1) }
    let (natural, transform, fps, duration) = try await track.load(.naturalSize, .preferredTransform, .nominalFrameRate, .timeRange)
    let size = natural.applying(transform), w = abs(size.width), h = abs(size.height)
    // Scale to cover the output frame, crop the centre
    let scale = max(CGFloat(OUT_W) / w, CGFloat(OUT_H) / h)
    let dx = (w * scale - CGFloat(OUT_W)) / 2, dy = (h * scale - CGFloat(OUT_H)) / 2
    let comp = AVMutableVideoComposition()
    comp.renderSize = CGSize(width: OUT_W, height: OUT_H)
    comp.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, round(fps))))
    let instr = AVMutableVideoCompositionInstruction()
    instr.timeRange = duration
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(transform.concatenating(CGAffineTransform(scaleX: scale, y: scale)).concatenating(CGAffineTransform(translationX: -dx, y: -dy)), at: .zero)
    instr.layerInstructions = [layer]
    comp.instructions = [instr]

    let reader = try AVAssetReader(asset: asset)
    let out = AVAssetReaderVideoCompositionOutput(videoTracks: [track], videoSettings: [kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32BGRA])
    out.videoComposition = comp
    reader.add(out)

    let writer = try AVAssetWriter(outputURL: dst, fileType: .mp4)
    writer.shouldOptimizeForNetworkUse = true // index first: playback starts while loading
    let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
      AVVideoCodecKey: AVVideoCodecType.h264,
      AVVideoWidthKey: OUT_W, AVVideoHeightKey: OUT_H,
      AVVideoCompressionPropertiesKey: [
        AVVideoAverageBitRateKey: BITRATE,
        AVVideoProfileLevelKey: AVVideoProfileLevelH264HighAutoLevel,
        AVVideoMaxKeyFrameIntervalDurationKey: 1, // a keyframe every second: quick start and rewind
        AVVideoAllowFrameReorderingKey: true,
      ],
    ])
    input.expectsMediaDataInRealTime = false
    writer.add(input)
    guard reader.startReading() else { print("reader: \(String(describing: reader.error))"); exit(1) }
    guard writer.startWriting() else { print("writer: \(String(describing: writer.error))"); exit(1) }
    writer.startSession(atSourceTime: .zero)
    let q = DispatchQueue(label: "encode")
    input.requestMediaDataWhenReady(on: q) {
      while input.isReadyForMoreMediaData {
        if reader.status == .failed { print("reader: \(String(describing: reader.error))"); exit(1) } // (also keeps the reader alive)
        if let buf = out.copyNextSampleBuffer() { input.append(buf) }
        else {
          input.markAsFinished()
          writer.finishWriting {
            if writer.status == .completed { print("wrote \(dst.path)") } else { print("failed: \(String(describing: writer.error))") }
            sema.signal()
          }
          return
        }
      }
    }
  } catch { print("error: \(error)"); exit(1) }
}
sema.wait()
