import SqueekCore
import Foundation

// Runs tests/fixtures/golden.json against the Swift engine. The TypeScript engine runs the same file
// (packages/detection/test/golden.test.ts). Usage: swift run SqueekChecks [repo-root]

let repoRoot: URL = {
  if CommandLine.arguments.count > 1 { return URL(fileURLWithPath: CommandLine.arguments[1]) }
  // .../apps/ios/SqueekCore/Sources/SqueekChecks/main.swift -> repo root
  var url = URL(fileURLWithPath: #filePath)
  for _ in 0..<6 { url.deleteLastPathComponent() }
  return url
}()

let rules = try RuleSet.load(from: repoRoot.appendingPathComponent("packages/detection/rules/rules.json"))
let golden =
  try JSONSerialization.jsonObject(
    with: Data(contentsOf: repoRoot.appendingPathComponent("tests/fixtures/golden.json"))) as! [String: Any]

let engine = DetectionEngine(rules: rules)
let analyzer = LinkAnalyzer(rules: rules)
var passed = 0
var failures: [String] = []

func check(_ name: String, _ ok: Bool, _ detail: @autoclosure () -> String) {
  if ok { passed += 1 } else { failures.append("\(name): \(detail())") }
}

for c in golden["text"] as! [[String: Any]] {
  let id = c["id"] as! String
  let result = engine.assessLocally(redactedText: engine.redact(c["input"] as! String))
  let ids = result.matches.map(\.id)
  let expected = c["signals"] as! [String]
  let missing = expected.filter { !ids.contains($0) }
  check(
    "text \(id)", result.risk.rawValue == c["risk"] as! String && missing.isEmpty && (!expected.isEmpty || ids.isEmpty),
    "risk \(result.risk.rawValue) (want \(c["risk"]!)), signals \(ids), missing \(missing)")
}

for c in golden["redact"] as! [[String: Any]] {
  let out = engine.redact(c["input"] as! String)
  check("redact \(c["id"]!)", out == c["output"] as! String, "got \"\(out)\"")
}

for c in golden["links"] as! [[String: Any]] {
  let result = analyzer.analyze(c["input"] as! String, blockedDomains: c["blocked"] as? [String] ?? [])
  let ids = result.findings.map(\.id).sorted()
  let want = (c["findings"] as! [String]).sorted()
  check(
    "link \(c["id"]!)", result.verdict.rawValue == c["verdict"] as! String && ids == want,
    "verdict \(result.verdict.rawValue) (want \(c["verdict"]!)), findings \(ids) (want \(want))")
}

for c in golden["phones"] as! [[String: Any]] {
  let out = PhoneNumbers.normalizeE164(c["input"] as! String)
  check("phone \(c["input"]!)", out == c["output"] as? String, "got \(out ?? "nil")")
}

// Call Directory plan: sorted, unique, disjoint.
let snapshot = BlockListSnapshot(
  numbers: [
    BlockedNumber(e164: "+15555550199", label: nil, source: "seed"),
    BlockedNumber(e164: "+15555550100", label: nil, source: "user"),
    BlockedNumber(e164: "+15555550150", label: nil, source: "community"),
  ], domains: [], blockReportedNumbers: false)
let plan = CallDirectoryPlan.make(snapshot)
check("calldirectory blocking", plan.blocking == [15_555_550_100], "\(plan.blocking)")
check(
  "calldirectory identification", plan.identification.map(\.number) == [15_555_550_150, 15_555_550_199],
  "\(plan.identification)")

// Local checker combines message rules with link findings.
let checker = LocalChecker(rules: rules)
let combined = checker.checkText(
  "Hi, see the photos here https://login.irs-refund-claim.example/start", blockedDomains: ["irs-refund-claim.example"])
check("local blocked link", combined.level == .danger, "\(combined.level)")

// Check-ins are open for a day, until answered.
let asked = Date().addingTimeInterval(-3600)
check("fresh check-in is open", CheckIn(id: "1", protectedUserId: "a", helperId: "b", status: "asked", createdAt: asked).isOpen(), "")
check(
  "old check-in lapses",
  !CheckIn(id: "2", protectedUserId: "a", helperId: "b", status: "asked", createdAt: Date().addingTimeInterval(-25 * 3600)).isOpen(), "")
check(
  "answered check-in is closed",
  !CheckIn(id: "3", protectedUserId: "a", helperId: "b", status: "ok", createdAt: asked, answeredAt: Date()).isOpen(), "")
let decodedCheckIn = try? JSONDecoder().decode(
  CheckIn.self,
  from: Data(#"{"id":"4","protected_user_id":"a","helper_id":"b","status":"call_me","created_at":"2026-10-05T10:00:00.123456+00:00","answered_at":null}"#.utf8))
check("check-in decodes from the server", decodedCheckIn?.status == "call_me" && decodedCheckIn?.date != nil, "\(String(describing: decodedCheckIn))")

// Screen Guard: sampling, alert cooldowns, and the hand-off through the App Group.
let guardPolicy = ScreenGuardPolicy()
let t0 = Date(timeIntervalSince1970: 1_000_000)
check("first frame is sampled", guardPolicy.shouldSample(now: t0), "")
check("frames within 30s are dropped", !guardPolicy.shouldSample(now: t0.addingTimeInterval(29)), "")
check("next frame after 30s is sampled", guardPolicy.shouldSample(now: t0.addingTimeInterval(31)), "")
check("first alert is allowed", guardPolicy.shouldAlert(fingerprint: 1, now: t0), "")
check("any alert within a minute is held", !guardPolicy.shouldAlert(fingerprint: 2, now: t0.addingTimeInterval(30)), "")
check("a different screen alerts after a minute", guardPolicy.shouldAlert(fingerprint: 2, now: t0.addingTimeInterval(61)), "")
check("the same screen waits ten minutes", !guardPolicy.shouldAlert(fingerprint: 1, now: t0.addingTimeInterval(300)), "")
check("the same screen alerts again later", guardPolicy.shouldAlert(fingerprint: 1, now: t0.addingTimeInterval(700)), "")
check("Squeek's own screens are skipped", ScreenGuardPolicy.isOwnScreen("Likely scam call · Squeek answered"), "")
check("other screens are not", !ScreenGuardPolicy.isOwnScreen("Pay with gift cards now"), "")
check("short text is not judged", !ScreenGuardPolicy.hasEnoughText("Home"), "")
let beat = ScreenGuardStatus(startedAt: t0, lastFrameAt: t0)
check("recent heartbeat means running", beat.isRunning(now: t0.addingTimeInterval(60)), "")
check("old heartbeat means stopped", !beat.isRunning(now: t0.addingTimeInterval(120)), "")

let tempDir = FileManager.default.temporaryDirectory.appendingPathComponent("screenguard-\(UUID().uuidString)")
try? FileManager.default.createDirectory(at: tempDir, withIntermediateDirectories: true)
let store = SharedStore(directory: tempDir)
check("no status before a broadcast", store.screenGuardStatus() == nil, "")
store.saveScreenGuardStatus(beat)
check("status round-trips", store.screenGuardStatus()?.lastFrameAt == beat.lastFrameAt, "")
store.clearScreenGuardStatus()
check("status clears when the broadcast ends", store.screenGuardStatus() == nil, "")
store.addScreenGuardAlert(ScreenGuardAlert(id: "b", date: t0.addingTimeInterval(5), headline: "Second", excerpt: nil, reasons: [], notified: false))
store.addScreenGuardAlert(ScreenGuardAlert(id: "a", date: t0, headline: "First", excerpt: "gift cards", reasons: ["Asks for gift cards"], notified: true))
let taken = store.takeScreenGuardAlerts()
check("alerts come back oldest first", taken.map(\.headline) == ["First", "Second"], "\(taken.map(\.headline))")
check("alerts are deleted once taken", store.takeScreenGuardAlerts().isEmpty, "")
try? FileManager.default.removeItem(at: tempDir)

print("SqueekChecks: \(passed) passed, \(failures.count) failed")
for f in failures { print("  FAIL \(f)") }
exit(failures.isEmpty ? 0 : 1)
