# 🏢 Company Enrichment API

**Pass a domain → get structured company data. $0.05 per query via x402 micropayments.**

A pay-per-use company enrichment API built on the [x402 protocol](https://x402.org). AI agents and developers can query any company domain and receive structured data including company name, description, industry, location, social links, tech stack, email provider, and DNS security info.

No API keys. No subscriptions. Just pay $0.05 USDC per request on Base.

## What You Get

For any domain (e.g., `stripe.com`), the API returns:

| Field | Example |
|-------|---------|
| Company name | Stripe |
| Description | Financial infrastructure for the internet |
| Industry | Financial Technology |
| Location | San Francisco, CA |
| Social links | Twitter, LinkedIn, GitHub URLs |
| Tech stack | React, Next.js, Cloudflare, Stripe, Google Analytics |
| Email provider | Google Workspace |
| DNS security | SPF ✓, DMARC ✓ |
| Verified services | Google, Facebook, Atlassian |

Results are cached for 7 days. Cached lookups return in <100ms.

## Quick Start

### 1. Prerequisites

- Node.js v18+
- CDP credentials from [portal.cdp.coinbase.com](https://portal.cdp.coinbase.com/projects)
- An Ethereum wallet address to receive payments

### 2. Setup

```bash
git clone <your-repo-url>
cd company-enrichment-api
npm install
```

### 3. Configure Environment

```bash
cp .env.example .env
```

Edit `.env` with your credentials:

```
CDP_API_KEY_ID=your_key_id
CDP_API_KEY_SECRET=your_key_secret
WALLET_ADDRESS=0xYourAddress
PORT=3000
```

### 4. Run Locally

```bash
npm start
```

### 5. Test

```bash
# Should return 402 Payment Required
curl -I http://localhost:3000/v1/enrich/stripe.com

# Free endpoints
curl http://localhost:3000/health
curl http://localhost:3000/api
```

## Deploy to Railway

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in Railway dashboard:
   - `CDP_API_KEY_ID`
   - `CDP_API_KEY_SECRET`
   - `WALLET_ADDRESS`
4. Railway auto-deploys on push

### Verify Deployment

```bash
# Should return 402 with X-Payment header
curl -I https://your-app.up.railway.app/v1/enrich/stripe.com
```

## API Endpoints

| Endpoint | Price | Description |
|----------|-------|-------------|
| `GET /` | Free | Homepage with wallet UI |
| `GET /health` | Free | Health check + cache stats |
| `GET /api` | Free | API info and pricing |
| `GET /v1/enrich/:domain` | $0.05 | Enrich a company domain |

## How It Works

1. Agent/user requests `GET /v1/enrich/stripe.com`
2. Server responds with `402 Payment Required` + payment details
3. Client signs a gasless USDC authorization (EIP-3009)
4. Client retries the request with the signed payment
5. Server verifies payment via CDP facilitator
6. Server scrapes the domain, extracts data, and returns JSON
7. Result is cached for 7 days for instant future lookups
8. USDC is settled on-chain to your wallet

## Architecture

```
company-enrichment-api/
├── package.json       # Dependencies (x402 ^2.1.0)
├── bootstrap.js       # Crypto polyfill (REQUIRED entry point)
├── api.js             # Express app + x402 middleware + routes
├── enrichment.js      # Scraping & data extraction engine
├── cache.js           # SQLite cache layer
├── .env.example       # Environment variable template
└── .gitignore
```

## x402 Integration Notes

This project follows the critical x402 patterns from the official integration guide:

- ✅ `bootstrap.js` as entry point with crypto polyfill
- ✅ `import { HTTPFacilitatorClient } from '@x402/core/server'` (NOT `/http`)
- ✅ `import { facilitator } from '@coinbase/x402'` (NOT `createFacilitatorConfig`)
- ✅ Route patterns use wildcard `*` (NOT Express `:param`)
- ✅ Paywall passed as 4th parameter to `paymentMiddleware()`
- ✅ Base Mainnet `eip155:8453`

## License

MIT
