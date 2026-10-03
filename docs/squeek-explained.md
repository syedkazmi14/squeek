# Squeek explained

This is what we plan to build. The monitoring and security features have not been implemented yet.

## Version to share with friends

We're building Squeek, a Windows companion that helps older people notice scams while they're using their computer. It would spot suspicious messages, explain what looks wrong, and speak the warning out loud. The user installs one Electron app. A small Windows helper comes inside it, so there's no separate browser extension or helper to install.

The plan is to keep the watching part on the person's computer. The bundled helper would use Windows accessibility features to read text that supported apps expose and notice relevant changes. If accessible text is missing, local OCR could read an approved part of the foreground window. If the same content stays open, we wouldn't keep sending it to AI. Moving the cursor wouldn't make an AI call either. We'd do basic checks locally, then send a small amount of redacted text to Jev for a more detailed assessment. New relevant content still gets checked even if it doesn't contain an obvious scam word.

That keeps the paid work tied to new information. Jev is a model that gives structured decisions, so we'd use it to assess things like payment pressure, impersonation, and requests for private information. Our code would decide what warning or review to show. Jev wouldn't be able to send money, message anyone, or change the app's protective rules.

Privacy is part of the design too. Monitoring would need permission, work only on supported enabled apps and approved visible regions, and have a visible pause control. We'd exclude password controls and known sensitive regions, minimize what we collect, remove sensitive details locally where possible, and avoid keeping screenshots or private messages in logs. Some text would still leave the computer for cloud analysis, so we need to be clear about that. Redaction reduces exposure; it doesn't guarantee anonymity. One install doesn't mean skipping consent or any Windows capture prompts.

We'll first test email and messages in a real foreground browser using Windows accessibility features, without changing browser settings. App support varies, and hidden link destinations may not be available. Local OCR turns image text into readable text, but can miss details and uses CPU and battery. We need to test both methods before promising coverage. Live phone-call protection is outside the first version.

There's also a difference between noticing a scam and stopping an action. Squeek can warn and help someone review what they're seeing in another app. It cannot reliably block every click or payment in that app. For the demo, a payment screen we control can deliberately pause its own submission. We'll make that distinction clear.

The main thing we need to prove is that this catches useful scam signals without constantly interrupting normal activity. We'll test scam examples, legitimate messages, AI-steering attempts, changed payment details, and outages, and measure the actual cost and speed. We won't claim it catches every scam or protects every app.

## How the parts fit together

| Part | What it does |
| --- | --- |
| Cursor companion | Gives Squeek a visible presence; movement stays on the computer |
| Bundled Windows helper | Reads exposed text and observes relevant changes in supported foreground apps; ships in the same installer |
| Local OCR fallback | Reads changed, approved image regions when accessibility text is incomplete |
| Local checks | Extract text, reduce sensitive data, find rule-based signals, and skip duplicate work |
| Jev | Assesses a small text request and returns structured decisions |
| App rules | Decide when to warn or offer review; only our cooperating demo can hold its own payment action |
| Voice | Reads the warning; the first version aims to use local speech |

## What the cost example means

As of October 3, 2026, TypeSafe lists Jev input at $0.042 per million tokens. Tokens are the units the provider uses to measure text input. If one assessment uses 2,000 input tokens, 1,000 assessments would cost about $0.084 for Jev alone. That's an example, not a measured total bill. Hosting, optional cloud voice, and any other services cost extra; local processing uses CPU and battery. [Published pricing](https://docs.typesafe.ai/models).

Calling the model every two seconds would mean 1,800 requests an hour. If a session instead needs 60 distinct assessments, that's 30 times fewer requests. Whether our actual workload looks like that needs measurement. Skipping repeated checks must not mean skipping new messages or changed payment details.

## Short explanation for judges

Squeek is designed as one Electron app with a bundled Windows observer. Monitoring runs locally through accessibility events and cropped OCR where needed. It runs local checks and sends minimal, deduplicated text for AI assessment. This keeps repeated inference and private-data exposure down while preserving automatic detection. We'll demonstrate permissions, source validation, redaction, and measured detection quality, request counts, latency, and resource use. External-app warnings are advisory; payment enforcement is limited to our cooperating demo.

## Questions we're likely to get

| Question | Answer |
| --- | --- |
| Do I have to install an extension? | No. The observer and its dependencies are planned to ship inside the Electron installer. Compatibility must be verified without special browser settings. |
| Are you streaming the whole screen to AI? | The proposed first version reads exposed text or processes approved cropped images locally, then sends necessary text. It doesn't continuously upload screen video. |
| Does someone have to press a button for every check? | After monitoring is enabled, new relevant foreground content triggers a check automatically on supported surfaces. A manual check is available when automatic reading is incomplete. |
| Could a scam message trick the AI? | Yes. Jev documents that risk. We treat message text as untrusted, keep independent rules, and test adversarial examples. [Known limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13). |
| Is everything kept on the device? | Observation, local checks, and planned local speech stay there. Necessary redacted text goes to the cloud for Jev assessment. Provider retention needs review before using real private content. |
| Can it stop any payment? | No. It warns in external apps. A payment screen we control can pause its own action for review, but that doesn't give Squeek control over other apps or banks. |
| What happens when AI is unavailable? | Local rules keep running and the app shows that cloud assessment is unavailable. It must not imply that a successful scan happened. |
| Have you proven the savings or accuracy? | No. These are design choices and example calculations. The build plan includes measuring both cost and detection quality. |

The observation approach uses documented [Windows accessibility APIs](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-uiautomationoverview) and [change events](https://learn.microsoft.com/en-us/windows/win32/winauto/uiauto-eventsoverview). Documentation establishes available mechanisms, not compatibility with every app.

The [technical design and build milestones](superpowers/specs/2026-10-03-squeek-scam-protection-design.md) contain the proposed implementation details and verification requirements.
