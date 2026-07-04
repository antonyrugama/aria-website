# Community Feed — Legal Update Drafts (pre-launch)

**Status:** DRAFT for owner review. Not live until merged/applied. Prepared for
the Community Feed feature (Aria PRD #3618). Store submissions and go-live
timing remain with the account owner.

This document collects the **privacy** and **terms** changes required before the
Community Feed (athlete-to-athlete social layer) launches. It has two homes:

| Change | Where it lives (source of truth) | Status in this PR |
| --- | --- | --- |
| Privacy Policy update | `privacy.html` in this repo → `https://runwitharia.com/privacy` | **Applied** in this PR (see `privacy.html` diff) |
| Terms of Use update | `app-backend/server/routes.ts` `/terms` route → `https://api.runwitharia.com/terms` (Aria monorepo) | **Draft below** — ready to apply; not yet applied |

The public Terms of Use is served by the Aria backend, not by this static site,
so the terms text below is a ready-to-apply draft rather than a file edit here.
Keep both surfaces in sync at launch.

---

## 1. Privacy Policy update (applied in `privacy.html`)

A new **§5 "Community And Social Features"** section was added, and the social
layer was threaded through the collection, use, sharing, children's-privacy, and
retention language. It covers:

- **Opt-in by social profile.** The community layer is off until an athlete
  creates a social profile (handle + optional bio + photo). No profile = not
  visible, cannot post/comment/react/be followed.
- **Handles, not real names.** 30-day handle-change cooldown; handles screened
  automatically. Coaches still see real names only in coaching surfaces.
- **Minors.** Social profile creation requires a date of birth; the community
  features are **not available under 13**. The rest of the app is unaffected.
- **What the feed carries.** Posts are anchored to a completed session, logged
  time, or race; optional caption + up to 3 photos; per-post toggles for
  results/times, exercise details, and PR badge. **The feed never carries
  bodyweight, readiness, heart rate, sleep, or other wellness/physiological
  data**, and is never a side channel around coach data sharing.
- **Photos.** EXIF (incl. GPS) stripped at upload; automated content screen
  (Azure AI Content Safety) before publish — clear violations blocked, borderline
  flagged; stored in Azure Blob, served via short-lived access-checked links.
- **Visibility model.** Follows require acceptance (no public accounts); Team
  feed = coach-owned training-group teammates; Following feed = who you follow +
  the official Aria account. Feeds reflect current relationships; leaving a group
  or removing a follower revokes access to past posts. No DMs, no tagging, no
  third-party cross-posting in v1.
- **Reporting, blocking, moderation.** Report any post/comment/profile (four
  categories); safety-concern reports prioritized; 24-hour acknowledgment aim;
  moderation can remove content and suspend social access; block = mutual
  invisibility.
- **Deletion cascade.** Deleting the profile removes the community presence;
  deleting the account cascades through posts, comments, reactions, follows, and
  profile.

**Version stamp NOT bumped in this draft.** `privacy.html` keeps
`data-version="2"` / `Effective June 2, 2026`. Bumping it forces every existing
user to re-accept on next app open; that should happen **at launch**, not now,
while the feature is still dark. See the launch checklist below.

---

## 2. Terms of Use update (ready to apply to `/terms`)

Apply these changes to the `/terms` HTML in `app-backend/server/routes.ts`
(the page served at `https://api.runwitharia.com/terms`). They match that page's
existing `<div class="card">` structure so they can be pasted in directly.

### 2a. New card — add after the "Your Account and Data" card

```html
<div class="card">
<h2>Community and User-Generated Content</h2>
<p>Aria offers optional community features where athletes can share workout posts, photos, comments, and reactions. Using them requires creating a social profile, and they are not available to anyone under 13.</p>
<p>You keep ownership of the content you post. By posting, you grant Aria a non-exclusive, worldwide, royalty-free license to host, store, reproduce, adapt for display, and distribute that content to the audiences you choose and as needed to operate, secure, and moderate the service. This license ends when you delete the content or your account, except for copies retained for legal, security, or moderation purposes and any copies other users saved outside Aria.</p>
<p>You are responsible for what you post and must have the rights to it, including any photos and the likeness of anyone shown. Do not post another person's private or identifying information.</p>
<p>The following are not allowed in community content: harassment, bullying, hate speech, threats or incitement of violence; sexual content, nudity, or content that sexualizes minors; illegal content or activity; spam, scams, or deceptive behavior; impersonation; infringement of intellectual-property or privacy rights; and posting personal or physiological health data about others.</p>
<p>Community content is subject to automated screening and human moderation. We do not review all content before it appears and are not obligated to. You can report posts, comments, and profiles, and you can block other users. We may remove content and limit, suspend, or terminate access to the community features &mdash; separately from your overall account &mdash; for violations of these terms. Safety-related reports are prioritized.</p>
</div>
```

### 2b. Expand the existing "Acceptable Use" card

Replace the current list with the list below (adds the community-specific
rules while keeping the existing three):

```html
<div class="card">
<h2>Acceptable Use</h2>
<ul>
<li>Do not misuse Aria, interfere with the service, or attempt unauthorized access.</li>
<li>Do not upload content you do not have the right to use.</li>
<li>Do not use Aria to create harmful, abusive, illegal, or deceptive content.</li>
<li>Do not harass, bully, threaten, impersonate, or share the private information of other users.</li>
<li>Do not post sexual, hateful, violent, or otherwise objectionable content in the community features.</li>
</ul>
</div>
```

### 2c. Plain-language summary (for reference / any future aria-website terms page)

- **Ownership + license:** users keep ownership; grant Aria a license to host,
  display, and moderate; license ends on deletion (with the usual retained-copy
  carve-outs).
- **User responsibility:** you must have rights to what you post (incl. photos
  and people shown); no doxxing.
- **Prohibited content:** harassment/bullying/hate/threats, sexual/nudity/CSAE,
  illegal, spam/scam/deception, impersonation, IP/privacy infringement, posting
  others' health/physiological data.
- **Moderation + enforcement:** automated screening + human moderation; no
  pre-publication review guarantee; report + block tools; Aria may remove content
  and suspend/terminate community access (distinct from the account); safety
  reports prioritized.
- **Minors:** community features require a social profile and are 13+.

---

## 3. Launch-blocking checklist

These MUST be done before the Community Feed ships to production. None are done
by this draft PR:

- [ ] **Apply the Terms of Use update** (§2 above) to `/terms` in
      `app-backend/server/routes.ts` and redeploy the backend.
- [ ] **Bump the privacy version stamp to force re-acceptance:** in
      `privacy.html` set `data-version="3"` + a new `data-effective` date and the
      "Version 3 — Effective &lt;date&gt;" text, and bump `CURRENT_TERMS_VERSION`
      in `app-backend/server/legal.ts` to the matching `YYYY-MM-DD`. These two
      must agree or the app re-prompt logic breaks.
- [ ] **Merge and deploy `privacy.html`** so
      `https://runwitharia.com/privacy` reflects the social section, and re-run
      the public legal-page live check.
- [ ] **Complete the Apple + Google store forms** using the answers doc in the
      Aria monorepo: `docs/legal/community-feed-ugc-age-rating-answers.md`
      (Apple UGC Guideline 1.2 controls, age rating, App Privacy label; Google
      Play UGC policy, content-rating/IARC, Data safety). Age rating / UGC
      declarations are launch-blocking for both stores.
- [ ] **Confirm the four Apple UGC controls are shipping** (content filtering,
      report mechanism with ~24h action, user blocking, published contact) before
      submitting the build — Apple rejects UGC apps without all four.
- [ ] **Ship a neutral 13+ DOB age gate** at social-profile creation (blank
      month/day/year, no preset) — required for COPPA and both stores.
- [ ] **Show Terms / community guidelines at social onboarding, not skippable**
      (Google Play UGC requirement).
- [ ] **Report and Block are separate, clearly-labeled in-app controls** that act
      in a timely manner (Apple 1.2 + Google Play UGC).
- [ ] **Verify account deletion cascades all social content** (posts, comments,
      reactions, follows, profile).

> Full store-form detail and the complete 12-item launch-blocking table live in
> the Aria monorepo answers doc:
> `docs/legal/community-feed-ugc-age-rating-answers.md`.
