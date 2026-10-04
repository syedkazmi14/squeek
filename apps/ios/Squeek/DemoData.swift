#if DEBUG
  import SqueekCore
  import Foundation

  /// Sample data for reviewing screens in the Simulator without signing in.
  /// Only in DEBUG builds, only when launched with the -SqueekDemo argument; never synced anywhere.
  enum DemoData {
    /// Syed, the person Squeek protects, and Aisha, who looks out for him.
    static let personId = "00000000-0000-0000-0000-00000000000a"
    static let helperId = "00000000-0000-0000-0000-00000000000b"
    /// Launch with `-SqueekRole helper` to see the app as Aisha, the trusted person.
    static var isHelper: Bool { argument("-SqueekRole") == "helper" }
    /// Whoever the demo is signed in as.
    static var userId: String { isHelper ? helperId : personId }

    static var contacts: [String: MemberContact] {
      isHelper
        ? [personId: MemberContact(id: personId, alertPhone: "+15555550111", shareIncidentsWithHelpers: true)]
        : [helperId: MemberContact(id: helperId, alertPhone: "+15555550112", shareIncidentsWithHelpers: false)]
    }

    /// `-SqueekCheckIn open` (as Syed: Aisha is asking), or `ok`, `call_me`, `waiting` (as Aisha).
    @MainActor static var checkIns: [CheckIn] {
      let now = Date()
      switch argument("-SqueekCheckIn") {
      case "open": return [CheckIn(id: "c1", protectedUserId: personId, helperId: helperId, status: "asked", createdAt: now.addingTimeInterval(-120))]
      case "waiting": return [CheckIn(id: "c1", protectedUserId: personId, helperId: helperId, status: "asked", createdAt: now.addingTimeInterval(-300))]
      case "ok": return [CheckIn(id: "c1", protectedUserId: personId, helperId: helperId, status: "ok", createdAt: now.addingTimeInterval(-900), answeredAt: now.addingTimeInterval(-600))]
      case "call_me": return [CheckIn(id: "c1", protectedUserId: personId, helperId: helperId, status: "call_me", createdAt: now.addingTimeInterval(-900), answeredAt: now.addingTimeInterval(-600))]
      default: return []
      }
    }
    /// Value after a launch argument, e.g. `-SqueekTab activity`.
    static func argument(_ name: String) -> String? {
      let args = ProcessInfo.processInfo.arguments
      guard let i = args.firstIndex(of: name), i + 1 < args.count else { return nil }
      return args[i + 1]
    }

    /// What the caller told Squeek, for the two demo call warnings.
    static var screenedCalls: [ScreenedCall] {
      let json = """
        [
          {"id":"s0","user_id":"\(personId)","caller_e164":"+15555550188","duration_secs":74,"risk":"high_risk",
           "categories":["impersonation","payment","pressure","secrecy"],"caller_claims":"Mike, the grandson",
           "caller_wants":"gift cards to pay bail, and for nobody to know","callback_e164":null,"safe_word":"wrong",
           "incident_id":"d0","created_at":"\(Timestamps.format(Date()))"},
          {"id":"s5","user_id":"\(personId)","caller_e164":"+15555550142","duration_secs":41,"risk":"clear","categories":[],
           "caller_claims":"Dr. Lee's office","caller_wants":"to confirm Tuesday's appointment",
           "callback_e164":"+15555550142","safe_word":null,"incident_id":"d5","created_at":"\(Timestamps.format(Date()))"}
        ]
        """
      return (try? JSONDecoder().decode([ScreenedCall].self, from: Data(json.utf8))) ?? []
    }

    @MainActor static func load(into model: AppModel) {
      let decoder = JSONDecoder()
      let now = Date()
      func stamp(_ minutesAgo: Double) -> String { Timestamps.format(now.addingTimeInterval(-minutesAgo * 60)) }

      let incidents = """
        [
          {"id":"d0","user_id":"\(personId)","device_id":null,"platform":"ios","surface":"call","risk":"high_risk",
           "categories":["impersonation","payment","pressure","secrecy"],"rule_ids":["call_family_no_safe_word","call_gift_card"],
           "evidence_redacted":"Mike, the grandson · gift cards to pay bail",
           "indicator_kind":"phone","indicator_value":"+15555550188","user_action":null,"created_at":"\(stamp(1))"},
          {"id":"d5","user_id":"\(personId)","device_id":null,"platform":"ios","surface":"call","risk":"clear",
           "categories":[],"rule_ids":[],"evidence_redacted":"Dr. Lee's office · to confirm Tuesday's appointment",
           "indicator_kind":"phone","indicator_value":"+15555550142","user_action":null,"created_at":"\(stamp(60 * 3))"},
          {"id":"d1","user_id":"\(personId)","device_id":"pc","platform":"windows","surface":"email","risk":"high_risk",
           "categories":["impersonation","payment"],"rule_ids":["gift_card"],
           "evidence_redacted":"This is the IRS. A warrant for your arrest will be issued today. Pay with Google Play gift cards…",
           "indicator_kind":null,"indicator_value":null,"user_action":null,"created_at":"\(stamp(2))"},
          {"id":"d2","user_id":"\(personId)","device_id":"phone","platform":"ios","surface":"call","risk":"high_risk",
           "categories":["reported"],"rule_ids":["user_report"],"evidence_redacted":null,
           "indicator_kind":"phone","indicator_value":"+15555550100","user_action":"reported","created_at":"\(stamp(60 * 20))"},
          {"id":"d3","user_id":"\(helperId)","device_id":"other","platform":"ios","surface":"sms","risk":"caution",
           "categories":["delivery","link"],"rule_ids":["delivery_problem"],
           "evidence_redacted":"USPS: Your package could not be delivered. A redelivery fee is required…",
           "indicator_kind":"domain","indicator_value":"usps-redelivery-fee.example","user_action":null,"created_at":"\(stamp(60 * 30))"},
          {"id":"d4","user_id":"\(personId)","device_id":"phone","platform":"ios","surface":"link","risk":"caution",
           "categories":["link"],"rule_ids":["brand_mismatch"],"evidence_redacted":"paypal-account-verify.example",
           "indicator_kind":"domain","indicator_value":"paypal-account-verify.example","user_action":"dismissed","created_at":"\(stamp(60 * 50))"}
        ]
        """
      let entries = """
        [
          {"entry_id":"e1","kind":"phone","value":"+15555550100","label":"Fake bank call","source":"user","household_id":null},
          {"entry_id":"e2","kind":"phone","value":"+15555550123","label":null,"source":"household","household_id":"h1"},
          {"entry_id":null,"kind":"phone","value":"+15555550177","label":"Reported by 4 people","source":"community","household_id":null},
          {"entry_id":"e3","kind":"domain","value":"paypal-account-verify.example","label":null,"source":"user","household_id":null}
        ]
        """
      let members = """
        [
          {"household_id":"h1","household_name":"Kazmi family","user_id":"\(personId)","role":"protected","display_name":"Syed","is_me":\(!isHelper)},
          {"household_id":"h1","household_name":"Kazmi family","user_id":"\(helperId)","role":"helper","display_name":"Aisha","is_me":\(isHelper)}
        ]
        """
      let profile = """
        {"id":"\(userId)","display_name":"\(isHelper ? "Aisha" : "Syed")","voice_rate":0.45,"text_scale":1.0,"muted":false,
         "history_sync":true,"share_incidents_with_helpers":\(!isHelper),"block_reported_numbers":false,
         "alert_phone":"\(isHelper ? "+15555550112" : "+15555550111")"}
        """
      switch argument("-SqueekTab") {
      case "activity": model.selectedTab = .activity
      case "person": model.selectedTab = .person
      case "settings": model.showingSettings = true
      default: break
      }
      model.applyDemo(
        incidents: (try? decoder.decode([Incident].self, from: Data(incidents.utf8))) ?? [],
        entries: (try? decoder.decode([BlockEntry].self, from: Data(entries.utf8))) ?? [],
        members: (try? decoder.decode([HouseholdMember].self, from: Data(members.utf8))) ?? [],
        devices: [],
        profile: try! decoder.decode(Profile.self, from: Data(profile.utf8)))
    }
  }
#endif
