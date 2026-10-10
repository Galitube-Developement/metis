# Account profile and usage

Open the avatar at the bottom of the sidebar for Settings, Profile and Usage.
The menu also works in the mobile sidebar and retains the update indicator.

Profile has an editable display name (separate from login username), picture,
bio and up to five HTTP/HTTPS links. Images are resized to 256 × 256 PNG in the
client; the server bounds the PNG dimensions and payload. No arbitrary remote
avatar URLs or SVG uploads are accepted.

Profiles are private initially. Enabling a shareable link creates an unguessable
token at /p/<token>. Disabling sharing invalidates it; enabling again creates a
new token. Daily token activity requires a separate opt-in. Public profiles
never include account identifiers, model breakdowns, costs, chat contents or
credentials.

Usage supports 7, 30, 90 and 365 days, custom dates, Cost/Tokens/Requests graphs,
model sorting and CSV export. Dates and the profile's 365-day activity heatmap
use UTC. Requests mean completed Metis runs, rather than individual provider
HTTP calls. Project agents and subagents count under their account owner.

The account_usage ledger records completed assistant run metadata with an
owner/message unique key. Provider-reported tokens and costs are used; context
window sizes, estimated inputs and repeated cached token counts are excluded.
Unreported values are unavailable and coverage is displayed. These are local
Metis statistics, not a provider invoice or activity from other applications.

Existing owned transcripts are migrated incrementally on first access and
after changes. Shared clones are excluded by their completion/creation dates.
The ledger survives chat deletion and has no global routing-telemetry pruning.
Account deletion cascades to profile and usage data.

Authenticated APIs:
- GET /api/profile and PUT /api/profile
- GET /api/account-usage?from=YYYY-MM-DD&to=YYYY-MM-DD

Run focused checks with:
pnpm exec tsx --test tests/account-profile-usage.test.ts tests/share-security.test.ts tests/chat-page-payload.test.ts
