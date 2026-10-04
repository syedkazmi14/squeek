import ClickeyCore
import Foundation
import Supabase
import SwiftUI

/// App state: account, synced data, and pushing block lists and settings to the extensions.
@MainActor
final class AppModel: ObservableObject {
  static let shared = AppModel()

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
  @Published private(set) var protectiveDNSEnabled = false
  @Published private(set) var isRefreshing = false
  @Published var errorMessage: String?

  /// Settings used when signed out; mirrored into the App Group for the extensions.
  @Published private(set) var localSettings: SharedSettings

  let store: SharedStore?
  private var client: SupabaseClient? { Backend.shared.client }
  private var authTask: Task<Void, Never>?
  private var channel: RealtimeChannelV2?
  private var realtimeTasks: [Task<Void, Never>] = []
  private var subscribedUserId: String?
  private var lastPublishedBlockList: Data?
  private var apnsToken: String?

  private static let localEntriesKey = "clickey.localBlockEntries"

  private init() {
    store = SharedStore(appGroup: ClickeyConfig.appGroup)
    localSettings = store?.settings() ?? SharedSettings()
    if let data = UserDefaults.standard.data(forKey: Self.localEntriesKey),
      let entries = try? JSONDecoder().decode([BlockEntry].self, from: data)
    {
      localEntries = entries
    }
  }

  // MARK: - Derived state

  var userId: String? { Backend.shared.userId }

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

  func start() {
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
    subscribedUserId = nil
    Task { await unsubscribeRealtime() }
    if wasSignedIn {
      // A new device row for the next account, since rows belong to one user.
      localSettings.deviceId = nil
    }
    publishToExtensions()
  }

  func refreshAll() async {
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
    } catch {
      report(error)
    }
    publishToExtensions()
  }

  func backgroundRefresh() async {
    await refreshAll()
    BackgroundRefresh.schedule()
  }

  // MARK: - Realtime

  private func subscribeRealtime(userId uid: String) async {
    await unsubscribeRealtime()
    guard let client else { return }
    let channel = client.channel("clickey-\(uid)")
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
    guard incident.level == .danger, incident.deviceId != localSettings.deviceId else { return }
    if incident.userId != userId {
      let who = memberName(incident.userId) ?? "Someone you help"
      Notifications.post(title: "Clickey warning", body: "\(who) got something that looks like a scam.")
    } else if incident.platform == "windows" {
      Notifications.post(title: "Clickey on your PC", body: "Your computer warned you about a likely scam.")
    }
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
    } catch { report(error) }
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
    callBlockingStatus = await CallDirectorySync.status()
    protectiveDNSEnabled = await ProtectiveDNS.isEnabled()
  }

  func setProtectiveDNS(_ enabled: Bool) async {
    do {
      if enabled { try await ProtectiveDNS.install() } else { try await ProtectiveDNS.remove() }
    } catch {
      report(error)
    }
    await refreshProtectionStatus()
    await registerDevice()
  }

  // MARK: - Account

  /// The emailed sign-in link reopens the app here (allowed in supabase/config.toml).
  static let signInRedirect = URL(string: "clickey://login-callback")!

  func sendCode(to email: String) async throws {
    guard let client else { throw BackendError.notConfigured }
    try await client.auth.signInWithOTP(email: email, redirectTo: Self.signInRedirect, shouldCreateUser: true)
  }

  /// Finishes sign-in when the person taps the link in the email.
  func handleOpenURL(_ url: URL) {
    guard let client, url.scheme == Self.signInRedirect.scheme else { return }
    Task {
      do {
        _ = try await client.auth.session(from: url)
      } catch {
        report(error)
      }
    }
  }

  func verify(email: String, code: String) async throws {
    guard let client else { throw BackendError.notConfigured }
    _ = try await client.auth.verifyOTP(email: email, token: code, type: .email)
  }

  func signInWithApple(idToken: String, nonce: String) async throws {
    guard let client else { throw BackendError.notConfigured }
    _ = try await client.auth.signInWithIdToken(
      credentials: OpenIDConnectCredentials(provider: .apple, idToken: idToken, nonce: nonce))
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

  func setAPNSToken(_ token: String) {
    apnsToken = token
    Task { await registerDevice() }
  }

  private func registerDevice() async {
    guard let client, let uid = userId else { return }
    let status = [
      callBlockingStatus == .enabled ? "calls on" : "calls off",
      protectiveDNSEnabled ? "dns on" : "dns off",
    ].joined(separator: ", ")
    let row = DeviceUpsert(
      id: deviceId, userId: uid, name: DeviceInfo.name, appVersion: ClickeyConfig.appVersion,
      monitoringStatus: status, apnsToken: apnsToken)
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
    guard let id, let client, isSignedIn else { return }
    if let index = incidents.firstIndex(where: { $0.id == id }) { incidents[index].userAction = action }
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
