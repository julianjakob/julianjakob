// make-portrait-video.swift
//
// Phone version of a home-feed video: the centre portrait slice that a phone shows
// anyway (the slide fills the screen with object-fit: cover), at phone resolution and
// a streaming-friendly bitrate. H.264 MP4 with the index at the start (plays while it
// loads), no audio. Plays in every browser, so phones need only this one file.
//
//   swift make-portrait-video.swift projects/05/home/01.mp4 projects/05/home/sizes/01-portrait.mp4
//
// Then run: node generate-manifests.js && node build-projects.js
import AVFoundation
import Foundation

let OUT_W = 1296, OUT_H = 1620   // 4:5 — covers any portrait phone slide (box aspect ≤ 0.8)
let BITRATE = Int(ProcessInfo.processInfo.environment["BITRATE"] ?? "") ?? 2_500_000 // bits/s: starts quickly on a weak connection, no visible loss at phone size

let args = CommandLine.arguments
guard args.count == 3 else { print("usage: swift make-portrait-video.swift <in.mp4> <out.mp4>"); exit(1) }
let src = URL(fileURLWithPath: args[1]), dst = URL(fileURLWithPath: args[2])
try? FileManager.default.removeItem(at: dst)

let asset = AVURLAsset(url: src)
let sema = DispatchSemaphore(value: 0)
Task {
  do {
    guard let track = try await asset.loadTracks(withMediaType: .video).first else { print("no video track"); exit(1) }
    let (natural, transform, fps, duration) = try await track.load(.naturalSize, .preferredTransform, .nominalFrameRate, .timeRange)
    let size = natural.applying(transform), w = abs(size.width), h = abs(size.height)
    // Scale to the output height, crop the centre
    let scale = CGFloat(OUT_H) / h
    let dx = (w * scale - CGFloat(OUT_W)) / 2
    let comp = AVMutableVideoComposition()
    comp.renderSize = CGSize(width: OUT_W, height: OUT_H)
    comp.frameDuration = CMTime(value: 1, timescale: CMTimeScale(max(1, round(fps))))
    let instr = AVMutableVideoCompositionInstruction()
    instr.timeRange = duration
    let layer = AVMutableVideoCompositionLayerInstruction(assetTrack: track)
    layer.setTransform(transform.concatenating(CGAffineTransform(scaleX: scale, y: scale)).concatenating(CGAffineTransform(translationX: -dx, y: 0)), at: .zero)
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
