import ExpoModulesCore
import UIKit
import Vision

/**
 Reads the text in a local image with Apple's Vision framework -- the engine behind Live Text.
 It runs on the device, offline and free; no image and no text ever leaves the phone.

 One line per `VNRecognizedTextObservation`, in Vision's own normalised coordinates
 (origin bottom-left), deliberately unaltered: the caller's parser groups a row by `y` and
 picks the per-serving column by `x`, so flipping or renormalising here would break it.
 */
public class BeviTextRecognitionModule: Module {
  public func definition() -> ModuleDefinition {
    Name("BeviTextRecognition")

    // Expo runs an async function off the main thread, which is where a Vision request belongs.
    AsyncFunction("recogniseText") { (uri: String) -> [RecognisedTextLine] in
      return try recogniseText(inImageAt: uri)
    }
  }
}

/** One recognised line. Shaped exactly like `RecognisedLine` on the JS side. */
internal struct RecognisedTextLine: Record {
  @Field var text: String = ""
  /** Vision's own confidence in the top candidate, 0-1. */
  @Field var confidence: Double = 0
  /** The observation's bounding-box origin, normalised, origin bottom-left. */
  @Field var x: Double = 0
  @Field var y: Double = 0
}

/** The URI names nothing this module can decode into an image. */
internal final class ImageNotReadableException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    return "Cannot decode an image at '\(param)'"
  }
}

/** Vision refused the request. The caller gets this, never a half-read list. */
internal final class TextRecognitionFailedException: GenericException<String>, @unchecked Sendable {
  override var reason: String {
    return "Text recognition failed: \(param)"
  }
}

private func recogniseText(inImageAt uri: String) throws -> [RecognisedTextLine] {
  let image = try loadImage(at: uri)
  guard let cgImage = image.cgImage else {
    throw ImageNotReadableException(uri)
  }

  let request = VNRecognizeTextRequest()
  // `.accurate` read printed panels at confidence 1.00 on the label photos this was built against.
  request.recognitionLevel = .accurate
  // Language correction MUST stay off: autocorrect on "0g" or "25mg" invents nutrition figures.
  request.usesLanguageCorrection = false
  request.recognitionLanguages = ["en-US"]

  // A photo carries its rotation in EXIF, so the orientation goes with the image: without it
  // Vision reads a sideways panel, and the bounding boxes would be in the wrong axes.
  let handler = VNImageRequestHandler(
    cgImage: cgImage,
    orientation: cgImagePropertyOrientation(from: image.imageOrientation),
    options: [:]
  )

  do {
    try handler.perform([request])
  } catch {
    throw TextRecognitionFailedException(error.localizedDescription).causedBy(error)
  }

  // No results is a legitimate answer (a photo of a wall); `nil` results is not, but Vision only
  // leaves it nil before the request has run, which `perform` above has done.
  let observations = request.results ?? []

  return observations.compactMap { observation -> RecognisedTextLine? in
    guard let candidate = observation.topCandidates(1).first else {
      return nil
    }
    let box = observation.boundingBox
    return RecognisedTextLine(
      text: candidate.string,
      confidence: Double(candidate.confidence),
      x: Double(box.origin.x),
      y: Double(box.origin.y)
    )
  }
}

/**
 `expo-image-picker` hands JS a `file://` URI; a bare path is accepted too. Anything else --
 `ph://`, `http://`, a content URI -- is refused rather than quietly read as a relative path.
 */
private func loadImage(at uri: String) throws -> UIImage {
  let path: String
  if let url = URL(string: uri), url.isFileURL {
    // Percent-decoded: the picker encodes spaces in a cache file's name.
    path = url.path(percentEncoded: false)
  } else if uri.hasPrefix("/") {
    path = uri
  } else {
    throw ImageNotReadableException(uri)
  }

  guard let image = UIImage(contentsOfFile: path) else {
    throw ImageNotReadableException(uri)
  }
  return image
}

/**
 `UIImage.Orientation` and `CGImagePropertyOrientation` have different raw values for the same
 orientation, so they are mapped case by case, as Apple's own Vision samples do.
 */
private func cgImagePropertyOrientation(from orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
  switch orientation {
  case .up: return .up
  case .upMirrored: return .upMirrored
  case .down: return .down
  case .downMirrored: return .downMirrored
  case .left: return .left
  case .leftMirrored: return .leftMirrored
  case .right: return .right
  case .rightMirrored: return .rightMirrored
  @unknown default: return .up
  }
}
