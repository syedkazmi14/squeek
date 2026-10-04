import type { SignalExtractor } from "../types.ts";
import { amount, destination, patternExtractor } from "./patterns.ts";

export const coreExtractors: SignalExtractor[] = [
  patternExtractor("impersonation", /\b(IRS|government|bank agent|police|support agent)\b/.source, "weak"),
  patternExtractor("payment", /\b(gift cards?|crypto|wire transfer|bitcoin)\b/.source, "weak"),
  patternExtractor("amount", amount, "weak"),
  patternExtractor("destination", destination, "weak"),
  patternExtractor("credential",
    /\b(send|share|give|provide)\b[^.!?\n]{0,40}\b(password(?!\s+reset\s+(?:instructions|guidance|link|procedure)\b)|verification code|one.time code|PIN|recovery phrase)\b/.source,
    "strong"),
  patternExtractor("pressure", /\b(immediately|urgent|secret|do not tell|today|arrest)\b/.source, "weak"),
  patternExtractor("remote_access",
    /\b(install|download|allow)\b[^.!?\n]{0,40}\b(anydesk|teamviewer|remote access)\b/.source, "strong"),
  patternExtractor("romance", /\b(I love you|my love|our love|sweetheart|romance)\b/.source, "weak"),
  patternExtractor("money",
    `\\b(send|transfer|pay|buy|wire|remit|deposit)\\b[^.!?\\n]{0,40}(?:\\b(?:money|payment|funds|gift cards?|crypto|bitcoin|wire transfer)\\b|${amount}|${destination})`,
    "strong"),
];
