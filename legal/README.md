# Legal

Legal documents for **Keystone Digital Sdn. Bhd.** (202601031998 (1694093-U)) and the Keystone Sovereign Agent / ModelArk Studio services.

| Document | File | API route |
|---|---|---|
| Terms of Service | [terms-of-service.md](terms-of-service.md) | `/legal/terms` |
| Privacy Policy & PDPA Notice (English; Malay on request) | [privacy-policy.md](privacy-policy.md) | `/legal/privacy` |
| Cookie Policy | [cookie-policy.md](cookie-policy.md) | `/legal/cookies` |
| Acceptable Use Policy | [acceptable-use-policy.md](acceptable-use-policy.md) | `/legal/acceptable-use` |
| Refund & Cancellation Policy | [refund-and-cancellation-policy.md](refund-and-cancellation-policy.md) | `/legal/refunds` |
| Disclaimer | [disclaimer.md](disclaimer.md) | `/legal/disclaimer` |
| Sub-processors | [subprocessors.md](subprocessors.md) | `/legal/subprocessors` |

`GET /legal` returns the index as JSON.

All documents: effective date **17 November 2026**, version **1.0**.

## Before publishing

These are drafts prepared for Malaysian law (PDPA 2010 as amended in 2024, Contracts Act 1950, Consumer Protection Act 1999, Electronic Commerce Act 2006). All documents are in British English. **Have them reviewed by a Malaysian lawyer before relying on them.**

Done (18 November 2026):

- [x] Legal, DPO, abuse and billing contact emails filled in (`owen.lim@keystonedigital.com.my`)
- [x] Data Protection Officer named (Lim Chi Loon)
- [x] Registered address corrected to Level 22, Suite 015, Menara Merdeka 118, 50118 Kuala Lumpur, Malaysia (documents and `server.py`)
- [x] Bahasa Malaysia section removed; notices are provided in English, with a Malay version available on request (PDPA s.7(3))
- [x] Sub-processor list updated (video generation removed; Alibaba Cloud, Meta Muse, Google Workspace, GitHub, Stripe, PayPal and Telegram added)
- [x] "No training" promise softened to reflect provider settings where available
- [x] PDPA 2024 breach notification timelines added (Commissioner within 72 hours; affected individuals within 7 days where significant harm is likely)
- [x] In-document links point to `/legal/{slug}` routes

Still to do:

- [ ] Register the DPO with the PDP Commissioner
- [ ] Prepare a Malay translation of the Privacy Policy to send on request
- [ ] Set up an internal breach-response and breach-record process to meet the 72-hour / 7-day timelines
- [ ] Pricing-specific refund terms, if they differ from the defaults
- [ ] Check the cookie list against what the live website sets, and that the consent banner and "Cookie settings" link exist
- [ ] Re-check the sub-processor list whenever a vendor is added or removed
