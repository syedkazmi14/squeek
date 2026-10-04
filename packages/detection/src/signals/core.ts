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
  patternExtractor("pressure", /\b(immediately|urgent|secret|do not tell|don't tell|keep (?:this|it) between us|today|arrest)\b/.source, "weak"),
  patternExtractor("remote_access",
    /\b(install|download|allow|open)\b[^.!?\n]{0,40}\b(anydesk|teamviewer|remote access|ultraviewer|quick ?assist|logmein|rustdesk|screenconnect|supremo)\b/.source, "strong"),
  // Someone in trouble: the opening of friend, family and grandparent scams.
  patternExtractor("hardship",
    /\b(hard times|dire need|in (?:a bit of |some |big )?trouble|stranded|stuck (?:in|at)|in (?:the )?hospital|in jail|been arrested|lost my (?:phone|wallet|passport)|emergency|accident|can't access my (?:bank|account))\b/.source, "weak"),
  // Asking the reader personally for money: a loan, a favour, help.
  patternExtractor("money_ask",
    /\b(loan|lend me|borrow|financial (?:assistance|help|support)|help me (?:out )?(?:with|financially)|need (?:some )?money|a small favou?r)\b/.source, "weak"),
  // "Move your money to a safe account" and cash handed to a courier: bank and police impersonation.
  patternExtractor("safe_account",
    /\b((?:safe|secure|protected) account|move (?:your )?(?:money|funds|savings)|withdraw (?:the )?cash|a courier will|courier (?:will|to) (?:collect|pick)|cash in an envelope)\b/.source, "strong"),
  // "Call us at 1-800-..." about a charge you never made: callback phishing.
  patternExtractor("callback",
    /\b(?:call|contact|phone|dial)\b[^.!?\n]{0,40}(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/.source, "weak"),
  patternExtractor("billing_bait",
    /\b(auto-?renew(?:al|ed)?|renewal|subscription|has been charged|will be charged|refund|norton|mcafee|geek squad|order (?:confirmation|#))\b/.source, "weak"),
  patternExtractor("fee_demand",
    /\b(unpaid toll|toll balance|customs fee|redelivery fee|shipping fee|processing fee|release fee|small fee|clearance fee)\b/.source, "weak"),
  patternExtractor("prize",
    /\b(you(?:'ve| have) won|winner|lottery|sweepstakes|inheritance|beneficiary|unclaimed (?:funds|money))\b/.source, "weak"),
  patternExtractor("extortion",
    /\b(recorded you|your (?:webcam|camera)|compromising (?:video|photos)|intimate (?:video|photos)|send (?:it|them) to (?:all )?your contacts)\b/.source, "weak"),
  patternExtractor("investment",
    /\b(investment opportunity|guaranteed (?:returns|profit)|trading platform|double your (?:money|investment)|recover your (?:lost )?(?:funds|money|crypto))\b/.source, "weak"),
  patternExtractor("romance", /\b(I love you|my love|our love|sweetheart|romance)\b/.source, "weak"),
  patternExtractor("money",
    `\\b(send|transfer|pay|buy|wire|remit|deposit)\\b[^.!?\\n]{0,40}(?:\\b(?:money|payment|funds|gift cards?|crypto|bitcoin|wire transfer)\\b|${amount}|${destination})`,
    "strong"),
];
