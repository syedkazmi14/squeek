import CoreText
import SwiftUI
import WidgetKit

@main
struct SqueekWidgetsBundle: WidgetBundle {
  init() {
    for url in Bundle.main.urls(forResourcesWithExtension: "ttf", subdirectory: nil) ?? [] {
      CTFontManagerRegisterFontsForURL(url as CFURL, .process, nil)
    }
  }

  var body: some Widget {
    SqueekLiveActivity()
  }
}
