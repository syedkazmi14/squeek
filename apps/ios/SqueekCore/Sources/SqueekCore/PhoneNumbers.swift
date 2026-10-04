import Foundation

// Swift mirror of packages/detection/src/phone.ts.
public enum PhoneNumbers {
  /// Returns "+<digits>" or nil. Ten-digit numbers are treated as US/Canada (+1).
  public static func normalizeE164(_ input: String, defaultCountryCode: String = "1") -> String? {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    let digits = trimmed.filter(\.isASCII).filter(\.isNumber)
    let e164: String
    if trimmed.hasPrefix("+") {
      e164 = "+" + digits
    } else if trimmed.hasPrefix("00") {
      e164 = "+" + digits.dropFirst(2)
    } else if digits.count == 10 {
      e164 = "+" + defaultCountryCode + digits
    } else if digits.count == 11 && digits.hasPrefix("1") {
      e164 = "+" + digits
    } else {
      e164 = "+" + digits
    }
    guard e164.range(of: "^\\+[1-9][0-9]{6,14}$", options: .regularExpression) != nil else { return nil }
    return e164
  }

  /// CallKit wants the full number with country code as an integer, without "+".
  public static func callKitNumber(fromE164 e164: String) -> Int64? {
    Int64(e164.dropFirst())
  }

  /// Readable form for US/Canada numbers; other numbers are shown as stored.
  public static func display(_ e164: String) -> String {
    let d = Array(e164.dropFirst())
    guard e164.hasPrefix("+1"), d.count == 11 else { return e164 }
    return "(\(String(d[1...3]))) \(String(d[4...6]))-\(String(d[7...10]))"
  }
}
