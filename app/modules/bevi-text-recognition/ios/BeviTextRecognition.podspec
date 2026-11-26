Pod::Spec.new do |s|
  s.name           = 'BeviTextRecognition'
  s.version        = '1.0.0'
  s.summary        = 'Reads text out of a local image with the Vision framework, on the device.'
  s.description    = 'A local Expo module: one VNRecognizeTextRequest per image, nothing leaves the phone.'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  # iPhone only, matching app.config.ts's ios.deploymentTarget. No tvOS target exists.
  s.platforms      = {
    :ios => '16.4'
  }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
