import SqueekCore
import Foundation
import Supabase
import SwiftUI

enum AppTab: Hashable {
  case home, activity, person
}

/// App state: account, synced data, and pushing block lists and settings to the extensions.
@MainActor
final class AppModel: ObservableObject {
  static let shared = AppModel()

  @Published var selectedTab: AppTab = .home
  @Published var showingSettings = false
  @Published private(set) var notificationsOn = false
  /// DEBUG-only sample data for reviewing screens without an account (launch with -SqueekDemo).
  @Published var isDemo = false

  @Published private(set) var isSignedIn = false
  @Published private(set) var email: String?
  @Published private(set) var profile: Profile?
  @Published private(set) var incidents: [Incident] = []
  @Published private(set) var serverEntries: [BlockEntry] = []
  @Published private(set) var localEntries: [BlockEntry] = []
  @Published private(set) var members: [HouseholdMember] = []
  @Published private(set) var helperDevices: [HelperDevice] = []
  @Published private(set) var myDevices: [Device] = []
  @Published private(set) var callBlockingStatus: CallDirectorySync.Status = .unknown
  @Published private(set) var isRefreshing = false
  @Published var errorMessage: String?

  /// iOS doesn't tell apps whether text filtering or the Safari extension is on, so the person
  /// ticks these off in setup.
  @Published var textsGuardOn = UserDefaults.standard.bool(forKey: AppModel.textsGuardKey) {
    didSet { UserDefaults.standard.set(textsGuardOn, forKey: Self.textsGuardKey) }
  }
  @Published var webGuardOn = UserDefaults.standard.bool(forKey: AppModel.webGuardKey) {
    didSet { UserDefaults.standard.set(webGuardOn, forKey: Self.webGuardKey) }
  }
  /// Call forwarding is set with a carrier code in the Phone app, which Squeek can't check.
  @Published var forwardingOn = UserDefaults.standard.bool(forKey: AppModel.forwardingKey) {
    didSet { UserDefaults.standard.set(forwardingOn, forKey: Self.forwardingKey) }
  }

  /// This person's Squeek phone line, where unanswered calls are forwarded. Nil until claimed.
  @Published private(set) var screeningLine: String?
  @Published private(set) var hasSafeWord = false

  /// Settings used when signed out; mirrored into the App Group for the extensions.
  @Published private(set) var localSettings: SharedSettings

  let store: SharedStore?
  private var client: SupabaseClient? { Backend.shared.client }
  private var authTask: Task<Void, Never>?
  private var channel: RealtimeChannelV2?
  private var realtimeTasks: [Task<Void, Never>] = []
  private var subscribedUserId: String?
  private var lastPublishedBlockList: Data?

  private static let localEntriesKey = "squeek.localBlockEntries"
  private static let alertedIncidentsKey = "squeek.alertedIncidentIds"
  private static let alertsSinceKey = "squeek.alertsSince"
  private static let textsGuardKey = "squeek.setup.texts"
  private static let webGuardKey = "squeek.setup.web"
  private static let forwardingKey = "squeek.setup.forwarding"
  private static let lastVisitKey = "squeek.lastVisit"

  /// Home's summary covers what happened after this: the end of the person's last visit to the app.
  @Published private(set) var summarySince = Date().addingTimeInterval(-24 * 3600)
  private var activeSince: Date?

  private init() {
    store = SharedStore(appGroup: SqueekConfig.appGroup)
    localSettings = store?.settings() ?? SharedSettings()
    if let data = UserDefaults.standard.data(forKey: Self.localEntriesKey),
      let entries = try? JSONDecoder().decode([BlockEntry].self, from: data)
    {
      localEntries = entries
    }
  }

  // MARK: - Derived state

  var userId: String? {
    #if DEBUG
      if isDemo { return DemoData.userId }
    #endif
    return Backend.shared.userId
  }

  /// Whether account screens (warnings, family) have data to show.
  var showsAccountData: Bool { isSignedIn || isDemo }

  func isOn(_ guard: SqueekGuard) -> Bool {
    switch `guard` {
    // Blocking known scammers, plus Squeek answering the rest and calling the person to say what it found.
    case .calls:
      return callBlockingStatus == .enabled && (forwardingOn || isDemo) && screeningLine != nil && profile?.alertPhone != nil
    case .texts: return textsGuardOn
    case .web: return webGuardOn
    case .person: return members.count > 1
    }
  }

  /// Guards that are on, for Home and the Live Activity.
  var protectionsOn: Int { SqueekGuard.allCases.filter(isOn).count }
  var protectionsTotal: Int { SqueekGuard.allCases.count }

  var deviceId: String {
    if let id = localSettings.deviceId { return id }
    let id = UUID().uuidString.lowercased()
    localSettings.deviceId = id
    try? store?.save(localSettings)
    return id
  }

  var blockEntries: [BlockEntry] {
    var seen = Set<String>()
    return (localEntries + serverEntries).filter { seen.insert("\($0.kind):\($0.value)").inserted }
  }

  var muted: Bool { profile?.muted ?? localSettings.muted }
  var voiceRate: Double { profile?.voiceRate ?? localSettings.voiceRate }
  var textScale: Double { profile?.textScale ?? 1.0 }

  /// The first household this person belongs to. The UI supports one family group.
  var household: (id: String, name: String)? {
    members.first.map { ($0.householdId, $0.householdName) }
  }

  var myRole: String? { members.first { $0.isMe }?.role }

  func memberName(_ userId: String) -> String? {
    members.first { $0.userId == userId }?.displayName
  }

  var minimumTypeSize: DynamicTypeSize? {
    switch textScale {
    case ..<1.05: return nil
    case ..<1.25: return .xLarge
    case ..<1.45: return .xxxLarge
    case ..<1.75: return .accessibility2
    default: return .accessibility4
    }
  }

  // MARK: - Lifecycle

  func appBecameActive() {
    activeSince = Date()
    guard !isDemo else { return }
    // First visit: the last day.
    summarySince = UserDefaults.standard.object(forKey: Self.lastVisitKey) as? Date ?? Date().addingTimeInterval(-24 * 3600)
  }

  /// Ends the visit. A glance of a few seconds doesn't count, so switching apps briefly doesn't
  /// clear the summary.
  func appWentToBackground() {
    guard !isDemo, let activeSince, Date().timeIntervalSince(activeSince) >= 10 else { return }
    UserDefaults.standard.set(Date(), forKey: Self.lastVisitKey)
  }

  func homeSummary() -> HomeSummary {
    HomeSummary(
      name: profile?.displayName, incidents: incidents, myUserId: userId, since: summarySince,
      guardsOff: protectionsTotal - protectionsOn, memberName: memberName)
  }

  func start() {
    #if DEBUG
      if ProcessInfo.processInfo.arguments.contains("-SqueekDemo") {
        DemoData.load(into: self)
        return
      }
    #endif
    publishToExtensions()
    Task { await refreshProtectionStatus() }
    guard authTask == nil, let client else { return }
    authTask = Task { [weak self] in
      for await (event, session) in client.auth.authStateChanges {
        guard let self else { return }
        switch event {
        case .initialSession, .signedIn, .tokenRefreshed, .userUpdated:
          if let session { await self.didSignIn(session) } else { self.didSignOut() }
        case .signedOut, .userDeleted:
          self.didSignOut()
        default:
          break
        }
      }
    }
  }

  private func didSignIn(_ session: Session) async {
    let uid = session.user.id.uuidString.lowercased()
    email = session.user.email
    isSignedIn = true
    guard subscribedUserId != uid else { return }
    subscribedUserId = uid
    if UserDefaults.standard.object(forKey: Self.alertsSinceKey) == nil {
      UserDefaults.standard.set(Date(), forKey: Self.alertsSinceKey)
    }
    await registerDevice()
    await refreshAll()
    await subscribeRealtime(userId: uid)
  }

  private func didSignOut() {
    let wasSignedIn = isSignedIn
    isSignedIn = false
    email = nil
    profile = nil
    incidents = []
    serverEntries = []
    members = []
    helperDevices = []
    myDevices = []
    screeningLine = nil
    hasSafeWord = false
    subscribedUserId = nil
    Task { await unsubscribeRealtime() }
    if wasSignedIn {
      // A new device row for the next account, since rows belong to one user.
      localSettings.deviceId = nil
    }
    publishToExtensions()
  }

  func refreshAll() async {
    guard !isDemo else { return }
    guard let client, isSignedIn, let uid = userId else {
      publishToExtensions()
      return
    }
    isRefreshing = true
    defer { isRefreshing = false }
    do {
      profile = try await client.from("profiles").select().eq("id", value: uid).single().execute().value
      incidents = try await client.from("incidents").select().order("created_at", ascending: false).limit(100)
        .execute().value
      serverEntries = try await client.rpc("my_block_list").execute().value
      members = try await client.rpc("my_household_members").execute().value
      helperDevices = try await client.rpc("household_devices").execute().value
      myDevices = try await client.from("devices").select("id, user_id, platform, name, app_version, monitoring_status, last_seen_at")
        .order("last_seen_at", ascending: false).execute().value
      let lines: [ScreeningLineRow] = try await client.from("screening_lines").select("e164").execute().value
      screeningLine = lines.first?.e164
      hasSafeWord = await fetchHasSafeWord()
    } catch {
      report(error)
    }
    publishToExtensions()
  }

  /// Background App Refresh (free for any developer account) stands in for push notifications:
  /// iOS wakes the app every so often, and new warnings from the PC or family become local alerts.
  func backgroundRefresh() async {
    await refreshAll()
    incidents.filter(isNewSinceAlertsStarted).reversed().forEach(alertIfNeeded)
    BackgroundRefresh.schedule()
  }

  private func isNewSinceAlertsStarted(_ incident: Incident) -> Bool {
    guard let since = UserDefaults.standard.object(forKey: Self.alertsSinceKey) as? Date,
      let created = incident.date
    else { return false }
    return created > since
  }

  /// Shows one local notification per warning from another device, a family member, or Squeek's call screener.
  private func alertIfNeeded(_ incident: Incident) {
    var alerted = UserDefaults.standard.stringArray(forKey: Self.alertedIncidentsKey) ?? []
    guard !alerted.contains(incident.id) else { return }
    if incident.isScreenedCall && incident.userId == userId {
      // Squeek also phones the person; this covers the app being open.
      switch incident.level {
      case .danger: Notifications.post(title: "Squeek answered a scam call", body: incident.evidenceRedacted ?? "Open Squeek to see what they wanted.")
      case .caution: Notifications.post(title: "Squeek answered a call", body: "Some things about it seemed off. Open Squeek to see why.")
      case .clear: Notifications.post(title: "Squeek took a message", body: incident.evidenceRedacted ?? "Open Squeek to see who called.")
      case .unknown: return
      }
    } else if incident.level != .danger || incident.deviceId == localSettings.deviceId {
      return
    } else if incident.userId != userId {
      let who = memberName(incident.userId) ?? "Someone you help"
      Notifications.post(title: "Squeek warning", body: "\(who) got something that looks like a scam.")
    } else if incident.platform == "windows" {
      Notifications.post(title: "Squeek on your PC", body: "Your computer warned you about a likely scam.")
    } else {
      return
    }
    alerted.append(incident.id)
    UserDefaults.standard.set(Array(alerted.suffix(200)), forKey: Self.alertedIncidentsKey)
  }

  // MARK: - Realtime

  private func subscribeRealtime(userId uid: String) async {
    await unsubscribeRealtime()
    guard let client else { return }
    let channel = client.channel("squeek-\(uid)")
    let incidentInserts = channel.postgresChange(InsertAction.self, schema: "public", table: "incidents")
    let incidentUpdates = channel.postgresChange(UpdateAction.self, schema: "public", table: "incidents")
    let numbers = channel.postgresChange(AnyAction.self, schema: "public", table: "blocked_numbers")
    let domains = channel.postgresChange(AnyAction.self, schema: "public", table: "blocked_domains")
    let profiles = channel.postgresChange(UpdateAction.self, schema: "public", table: "profiles")
    let householdMembers = channel.postgresChange(AnyAction.self, schema: "public", table: "household_members")
    do {
      try await channel.subscribeWithError()
    } catch {
      report(error)
      return
    }
    self.channel = channel
    realtimeTasks = [
      Task { [weak self] in
        for await insert in incidentInserts { self?.received(insert: insert) }
      },
      Task { [weak self] in
        for await update in incidentUpdates { self?.received(update: update) }
      },
      Task { [weak self] in
        for await _ in numbers { await self?.reloadBlockList() }
      },
      Task { [weak self] in
        for await _ in domains { await self?.reloadBlockList() }
      },
      Task { [weak self] in
        for await _ in profiles { await self?.reloadProfile() }
      },
      Task { [weak self] in
        for await _ in householdMembers { await self?.reloadHousehold() }
      },
    ]
  }

  private func unsubscribeRealtime() async {
    realtimeTasks.forEach { $0.cancel() }
    realtimeTasks = []
    if let channel { await client?.removeChannel(channel) }
    channel = nil
  }

  private static let realtimeDecoder = JSONDecoder()

  private func received(insert: InsertAction) {
    guard let incident = try? insert.decodeRecord(as: Incident.self, decoder: Self.realtimeDecoder) else { return }
    guard !incidents.contains(where: { $0.id == incident.id }) else { return }
    incidents.insert(incident, at: 0)
    // Alert about warnings from the person's other devices or from family members they help.
    alertIfNeeded(incident)
  }

  private func received(update: UpdateAction) {
    guard let incident = try? update.decodeRecord(as: Incident.self, decoder: Self.realtimeDecoder),
      let index = incidents.firstIndex(where: { $0.id == incident.id })
    else { return }
    incidents[index] = incident
  }

  private func reloadBlockList() async {
    guard let client, isSignedIn else { return }
    do {
      serverEntries = try await client.rpc("my_block_list").execute().value
      publishToExtensions()
    } catch { report(error) }
  }

  private func reloadProfile() async {
    guard let client, let uid = userId else { return }
    do {
      profile = try await client.from("profiles").select().eq("id", value: uid).single().execute().value
      publishToExtensions()
    } catch { report(error) }
  }

  private func reloadHousehold() async {
    guard let client, isSignedIn else { return }
    do {
      members = try await client.rpc("my_household_members").execute().value
      helperDevices = try await client.rpc("household_devices").execute().value
      hasSafeWord = await fetchHasSafeWord()
    } catch { report(error) }
  }

  private func fetchHasSafeWord() async -> Bool {
    guard let client, let household else { return false }
    return (try? await client.rpc("household_has_safe_word", params: ["p_household_id": household.id]).execute().value) ?? false
  }

  // MARK: - Extensions

  /// Writes the block list and settings to the App Group and reloads the call blocker when the list changed.
  func publishToExtensions() {
    guard let store else { return }
    let snapshot = BlockListSnapshot(entries: blockEntries, blockReportedNumbers: profile?.blockReportedNumbers ?? false)
    var settings = localSettings
    settings.signedIn = isSignedIn
    settings.muted = muted
    settings.voiceRate = voiceRate
    settings.historySync = profile?.historySync ?? false
    settings.deviceId = deviceId
    localSettings = settings
    try? store.save(settings)

    let fingerprint = try? JSONEncoder().encode([snapshot.numbers.map(\.e164), snapshot.numbers.map(\.source)])
      + JSONEncoder().encode([snapshot.blockReportedNumbers])
    try? store.save(snapshot)
    guard fingerprint != lastPublishedBlockList else { return }
    lastPublishedBlockList = fingerprint
    Task {
      await CallDirectorySync.reload()
      await refreshProtectionStatus()
    }
  }

  func refreshProtectionStatus() async {
    guard !isDemo else { return }
    callBlockingStatus = await CallDirectorySync.status()
    notificationsOn = await Notifications.isAuthorized()
  }

  #if DEBUG
    func applyDemo(
      incidents: [Incident], entries: [BlockEntry], members: [HouseholdMember], devices: [HelperDevice], profile: Profile
    ) {
      isDemo = true
      email = "syed@example.com"
      self.incidents = incidents
      serverEntries = entries
      self.members = members
      helperDevices = devices
      self.profile = profile
      callBlockingStatus = .enabled
      notificationsOn = true
      screeningLine = "+16822041962"
      hasSafeWord = true
    }
  #endif

  // MARK: - Account

  /// The emailed sign-in link reopens the app here (allowed in supabase/config.toml).
  static let signInRedirect = URL(string: "squeek://login-callback")!

  func sendCode(to email: String) async throws {
    guard let client else { throw BackendError.notConfigured }
    try await client.auth.signInWithOTP(email: email, redirectTo: Self.signInRedirect, shouldCreateUser: true)
  }

  /// Finishes sign-in when the person taps the link in the email.
  func handleOpenURL(_ url: URL) {
    // squeek://live is the Dynamic Island tap: just open the app.
    guard let client, url.scheme == Self.signInRedirect.scheme, url.host != "live" else { return }
    Task {
      do {
        _ = try await client.auth.session(from: url)
      } catch {
        report(error)
      }
    }
  }

  /// Signs in to a demo account by email alone; see Backend.demoSignIn.
  func demoSignIn(email: String) async throws {
    guard let client else { throw BackendError.notConfigured }
    let tokenHash = try await Backend.shared.demoSignIn(email: email)
    _ = try await client.auth.verifyOTP(tokenHash: tokenHash, type: .email)
  }

  func verify(email: String, code: String) async throws {
    guard let client else { throw BackendError.notConfigured }
    _ = try await client.auth.verifyOTP(email: email, token: code, type: .email)
  }

  func signOut() async {
    do { try await client?.auth.signOut() } catch { report(error) }
    didSignOut()
  }

  func deleteAccount() async {
    guard let client else { return }
    do {
      try await client.rpc("delete_my_account").execute()
      try? await client.auth.signOut(scope: .local)
      didSignOut()
    } catch { report(error) }
  }

  private func registerDevice() async {
    guard let client, let uid = userId else { return }
    let status = callBlockingStatus == .enabled ? "call blocking on" : "call blocking off"
    let row = DeviceUpsert(
      id: deviceId, userId: uid, name: DeviceInfo.name, appVersion: SqueekConfig.appVersion,
      monitoringStatus: status)
    do {
      try await client.from("devices").upsert(row).execute()
    } catch { report(error) }
  }

  // MARK: - Settings

  func updateProfile(_ change: (inout Profile) -> Void) async {
    guard var updated = profile else { return }
    change(&updated)
    profile = updated
    publishToExtensions()
    guard let client else { return }
    do {
      try await client.from("profiles").update(ProfileUpdate(updated)).eq("id", value: updated.id).execute()
    } catch { report(error) }
  }

  func setVoice(muted: Bool? = nil, rate: Double? = nil) async {
    if profile != nil {
      await updateProfile { p in
        if let muted { p.muted = muted }
        if let rate { p.voiceRate = rate }
      }
    } else {
      if let muted { localSettings.muted = muted }
      if let rate { localSettings.voiceRate = rate }
      publishToExtensions()
    }
  }

  // MARK: - Block lists

  func addBlock(kind: String, rawValue: String, label: String?, shareWithFamily: Bool, report reportToOthers: Bool) async
    -> Bool
  {
    guard let value = normalize(kind: kind, rawValue) else {
      errorMessage = kind == "phone" ? "That doesn't look like a phone number." : "That doesn't look like a website."
      return false
    }
    let label = label.flatMap { $0.trimmingCharacters(in: .whitespaces).isEmpty ? nil : String($0.prefix(60)) }
    guard let client, isSignedIn, let uid = userId else {
      addLocal(BlockEntry(entryId: nil, kind: kind, value: value, label: label, source: "user", householdId: nil))
      return true
    }
    let householdId = shareWithFamily ? household?.id : nil
    do {
      if reportToOthers {
        _ = try await Backend.shared.report(
          kind: kind, value: value, label: label, householdId: householdId, deviceId: deviceId)
      } else if kind == "phone" {
        try await client.from("blocked_numbers")
          .insert(NewBlockedNumber(ownerUserId: householdId == nil ? uid : nil, householdId: householdId, e164: value, label: label, createdBy: uid))
          .execute()
      } else {
        try await client.from("blocked_domains")
          .insert(NewBlockedDomain(ownerUserId: householdId == nil ? uid : nil, householdId: householdId, domain: value, label: label, createdBy: uid))
          .execute()
      }
      await reloadBlockList()
      return true
    } catch {
      report(error)
      return false
    }
  }

  func removeBlock(_ entry: BlockEntry) async {
    if entry.entryId == nil, let index = localEntries.firstIndex(of: entry) {
      localEntries.remove(at: index)
      saveLocalEntries()
      publishToExtensions()
      return
    }
    guard let client, let id = entry.entryId, entry.source == "user" || entry.source == "household" else { return }
    do {
      try await client.from(entry.kind == "phone" ? "blocked_numbers" : "blocked_domains").delete().eq("id", value: id)
        .execute()
      await reloadBlockList()
    } catch { report(error) }
  }

  func canRemove(_ entry: BlockEntry) -> Bool {
    entry.entryId == nil ? localEntries.contains(entry) : (entry.source == "user" || entry.source == "household")
  }

  func isBlocked(kind: String, value: String) -> Bool {
    blockEntries.contains { $0.kind == kind && $0.value == value }
  }

  private func normalize(kind: String, _ raw: String) -> String? {
    if kind == "phone" { return PhoneNumbers.normalizeE164(raw) }
    guard let rules = CheckService.shared.checker?.links else { return nil }
    let domain = rules.analyze(raw).domain
    return domain?.contains(".") == true ? domain : nil
  }

  private func addLocal(_ entry: BlockEntry) {
    guard !localEntries.contains(where: { $0.kind == entry.kind && $0.value == entry.value }) else { return }
    localEntries.append(entry)
    saveLocalEntries()
    publishToExtensions()
  }

  private func saveLocalEntries() {
    UserDefaults.standard.set(try? JSONEncoder().encode(localEntries), forKey: Self.localEntriesKey)
  }

  func setBlockReportedNumbers(_ on: Bool) async {
    await updateProfile { $0.blockReportedNumbers = on }
  }

  // MARK: - Incidents

  func setAction(_ action: String, forIncident id: String?) async {
    guard let id else { return }
    if let index = incidents.firstIndex(where: { $0.id == id }) { incidents[index].userAction = action }
    guard let client, isSignedIn, !isDemo else { return }
    do {
      try await client.from("incidents").update(["user_action": action]).eq("id", value: id).execute()
    } catch { report(error) }
  }

  // MARK: - Family

  func createHousehold(name: String, role: String) async {
    guard let client else { return }
    do {
      let _: String = try await client.rpc("create_household", params: ["p_name": name, "p_role": role]).execute().value
      await reloadHousehold()
    } catch { report(error) }
  }

  func createInvite(role: String) async -> String? {
    guard let client, let household else { return nil }
    do {
      return try await client.rpc("create_household_invite", params: ["p_household_id": household.id, "p_role": role])
        .execute().value
    } catch {
      report(error)
      return nil
    }
  }

  func joinHousehold(code: String) async -> Bool {
    guard let client else { return false }
    do {
      let _: String = try await client.rpc("join_household", params: ["p_code": code]).execute().value
      await reloadHousehold()
      await reloadBlockList()
      return true
    } catch {
      report(error)
      return false
    }
  }

  func leaveHousehold() async {
    guard let client, let household, let uid = userId else { return }
    do {
      try await client.from("household_members").delete().eq("household_id", value: household.id)
        .eq("user_id", value: uid).execute()
      await reloadHousehold()
      await reloadBlockList()
    } catch { report(error) }
  }

  func setDisplayName(_ name: String) async {
    await updateProfile { $0.displayName = name.isEmpty ? nil : String(name.prefix(80)) }
  }

  // MARK: - Call screening

  /// Gets this person's Squeek line from the server, giving them a free one the first time.
  func claimScreeningLine() async {
    guard let client, isSignedIn, !isDemo else { return }
    do {
      screeningLine = try await client.rpc("claim_screening_line").execute().value
    } catch { report(error) }
  }

  /// Saves the number Squeek calls with verdicts. Empty removes it.
  func setAlertPhone(_ raw: String) async -> Bool {
    let trimmed = raw.trimmingCharacters(in: .whitespaces)
    guard trimmed.isEmpty || PhoneNumbers.normalizeE164(trimmed) != nil else {
      errorMessage = "That doesn't look like a phone number."
      return false
    }
    await updateProfile { $0.alertPhone = trimmed.isEmpty ? nil : PhoneNumbers.normalizeE164(trimmed) }
    return true
  }

  /// What the caller told Squeek's phone agent, for a call warning in Activity.
  func screenedCall(forIncident incidentId: String) async -> ScreenedCall? {
    #if DEBUG
      if isDemo { return DemoData.screenedCalls.first { $0.incidentId == incidentId } }
    #endif
    guard let client, isSignedIn else { return nil }
    let rows: [ScreenedCall]? = try? await client.from("screened_calls").select().eq("incident_id", value: incidentId)
      .limit(1).execute().value
    return rows?.first
  }

  /// Sets the word Squeek asks callers who say they're family. Empty removes it.
  func setSafeWord(_ word: String) async -> Bool {
    guard let client, let household else { return false }
    if isDemo {
      hasSafeWord = !word.isEmpty
      return true
    }
    do {
      try await client.rpc("set_safe_word", params: ["p_household_id": household.id, "p_word": word]).execute()
      hasSafeWord = await fetchHasSafeWord()
      return true
    } catch {
      report(error)
      return false
    }
  }

  // MARK: - Pairing

  func pairComputer(code: String) async -> Bool {
    do {
      try await Backend.shared.claimPairing(code: code)
      return true
    } catch {
      report(error)
      return false
    }
  }

  // MARK: - Errors

  func report(_ error: Error) {
    if error is CancellationError { return }
    errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
  }
}

private struct ScreeningLineRow: Decodable {
  let e164: String
}
