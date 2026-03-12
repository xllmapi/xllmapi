# xllmapi Frontend Information Architecture v1

## Public

### `/`
- Hero
- Market preview
- Protocol compatibility
- CTA to `/market`, `/docs`, `/auth`

### `/market`
- Public model list
- Search/filter
- Featured suppliers

### `/u/:handle`
- Public supplier profile
- Public offerings
- Stability/runtime/user-count

### `/docs`
- OpenAI-compatible examples
- Anthropic-compatible examples
- Base URL, auth, model naming

### `/auth`
- Email
- Verification code
- Invite-only messaging

## App

### `/app`
Views:
- overview
- market
- account
- invitations
- publish
- shared-supply
- shared-consumption
- usage

## Admin

### `/admin`
Views:
- overview
- users
- invitations
- reviews
- providers
- market
- usage

