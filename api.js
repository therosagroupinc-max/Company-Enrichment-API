// api.js — Company Enrichment API with x402 micropayments
// Pass a domain → get structured company data
// $0.05 per query via USDC on Base Mainnet

import { config } from 'dotenv';
import express from 'express';
import cors from 'cors';

// ⚠️ CRITICAL: Correct import paths (from user's x402 integration guide)
import { paymentMiddleware, x402ResourceServer } from '@x402/express';
import { ExactEvmScheme } from '@x402/evm/exact/server';
import { HTTPFacilitatorClient } from '@x402/core/server'; // ⚠️ MUST be /server (NOT /http)
import { facilitator } from '@coinbase/x402';              // ⚠️ Use directly (NOT createFacilitatorConfig)
import { createPaywall } from '@x402/paywall';
import { evmPaywall } from '@x402/paywall/evm';

import { enrichDomain } from './enrichment.js';
import { getCached, setCache, getCacheStats } from './cache.js';

config();

// ============================================
// CONFIGURATION
// ============================================
const API_NAME = 'Company Enrichment API';
const API_VERSION = '1.0.0';
const PRICE = '$0.05';            // Price per enrichment query
const PORT = process.env.PORT || 3000;
const NETWORK = 'eip155:8453';    // Base Mainnet
const payTo = process.env.WALLET_ADDRESS;

// Validate required environment variables
if (!process.env.CDP_API_KEY_ID || !process.env.CDP_API_KEY_SECRET) {
  console.error('❌ CDP_API_KEY_ID and CDP_API_KEY_SECRET are required');
  console.error('   Get them from: https://portal.cdp.coinbase.com/projects');
  process.exit(1);
}
if (!payTo) {
  console.error('❌ WALLET_ADDRESS is required');
  process.exit(1);
}

// ============================================
// x402 SETUP (follows user's proven patterns exactly)
// ============================================

// ⚠️ CRITICAL: Use facilitator directly, NOT createFacilitatorConfig()
const facilitatorClient = new HTTPFacilitatorClient(facilitator);

// Create resource server and register EVM scheme
const resourceServer = new x402ResourceServer(facilitatorClient)
  .register(NETWORK, new ExactEvmScheme());

// Build paywall UI for wallet connection
const paywall = createPaywall()
  .withNetwork(evmPaywall)
  .withConfig({
    appName: API_NAME,
    testnet: false, // Base Mainnet
  })
  .build();

// ============================================
// EXPRESS APP
// ============================================
const app = express();
app.use(cors());
app.use(express.json());

// ⚠️ CRITICAL: Route patterns use wildcard (*), NOT Express :params
// ⚠️ CRITICAL: Paywall is 4th parameter to paymentMiddleware()
app.use(
  paymentMiddleware(
    {
      'GET /v1/enrich/*': {
        accepts: [
          {
            scheme: 'exact',
            price: PRICE,
            network: NETWORK,
            payTo,
          },
        ],
        description: 'Company enrichment — pass a domain, get structured company data including name, description, industry, location, social links, tech stack, and DNS info.',
        mimeType: 'application/json',
      },
    },
    resourceServer,
    undefined,       // paywallConfig (using custom paywall below)
    paywall,         // ⚠️ CRITICAL: Must be 4th param for wallet UI
  ),
);

// ============================================
// FREE ENDPOINTS
// ============================================

// Homepage with wallet connection UI
app.get('/', (req, res) => {
  res.send(buildHomepage());
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    cache: getCacheStats(),
  });
});

// API info
app.get('/api', (req, res) => {
  res.json({
    name: API_NAME,
    version: API_VERSION,
    description: 'Company enrichment via x402 micropayments. Pass a domain, get structured company data.',
    pricing: `${PRICE} USDC per query`,
    network: 'Base Mainnet (eip155:8453)',
    endpoints: {
      'GET /v1/enrich/:domain': {
        price: PRICE,
        description: 'Enrich a company domain. Returns name, description, industry, location, social links, tech stack, and DNS data.',
        example: '/v1/enrich/stripe.com',
      },
    },
    cache: 'Results cached for 7 days. Repeated lookups within cache window are served instantly.',
    response_time: 'Cached: <100ms | New domain: 2-5 seconds',
  });
});

// ============================================
// PAID ENDPOINT — Company Enrichment
// ============================================

app.get('/v1/enrich/:domain', async (req, res) => {
  const { domain } = req.params;

  // Basic input validation
  if (!domain || domain.length < 3 || !domain.includes('.')) {
    return res.status(400).json({
      error: 'Invalid domain',
      message: 'Please provide a valid domain (e.g., stripe.com)',
      example: '/v1/enrich/stripe.com',
    });
  }

  // Normalize domain
  const cleanDomain = domain.toLowerCase()
    .replace(/^(https?:\/\/)?(www\.)?/, '')
    .replace(/\/.*$/, '');

  try {
    // 1. Check cache first
    const cached = getCached(cleanDomain);
    if (cached) {
      return res.json({
        ...cached,
        _cached: true,
        _cache_note: 'This result was served from cache. Data refreshes every 7 days.',
      });
    }

    // 2. Cache miss — run full enrichment
    const result = await enrichDomain(cleanDomain);

    // 3. Cache the result (only if successful)
    if (result.status === 'success') {
      setCache(cleanDomain, result);
    }

    return res.json(result);

  } catch (err) {
    console.error(`Error enriching ${cleanDomain}:`, err.message);
    return res.status(500).json({
      domain: cleanDomain,
      status: 'error',
      error: 'Enrichment failed',
      message: 'An unexpected error occurred. Please try again.',
    });
  }
});

// ============================================
// HOMEPAGE WITH WALLET UI
// ============================================

function buildHomepage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${API_NAME}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #e0e0e0;
      min-height: 100vh;
      padding: 2rem;
    }
    .container { max-width: 720px; margin: 0 auto; }
    h1 {
      font-size: 2rem;
      background: linear-gradient(135deg, #0052FF, #00D4AA);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      margin-bottom: 0.5rem;
    }
    .subtitle { color: #888; margin-bottom: 2rem; font-size: 1.1rem; }
    .card {
      background: #161616;
      border: 1px solid #2a2a2a;
      border-radius: 12px;
      padding: 1.5rem;
      margin-bottom: 1.5rem;
    }
    .card h2 { font-size: 1.1rem; color: #fff; margin-bottom: 1rem; }
    .price-tag {
      display: inline-block;
      background: #0052FF22;
      color: #0052FF;
      padding: 0.25rem 0.75rem;
      border-radius: 6px;
      font-weight: 600;
      font-size: 0.9rem;
    }
    .endpoint {
      background: #0d0d0d;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 1rem;
      font-family: 'SF Mono', Monaco, monospace;
      font-size: 0.85rem;
      color: #00D4AA;
      margin: 1rem 0;
    }
    .input-group {
      display: flex;
      gap: 0.5rem;
      margin: 1rem 0;
    }
    input[type="text"] {
      flex: 1;
      padding: 0.75rem 1rem;
      background: #0d0d0d;
      border: 1px solid #333;
      border-radius: 8px;
      color: #fff;
      font-size: 1rem;
      font-family: inherit;
    }
    input:focus { outline: none; border-color: #0052FF; }
    button {
      padding: 0.75rem 1.5rem;
      border-radius: 8px;
      border: none;
      font-weight: 600;
      cursor: pointer;
      font-size: 0.9rem;
      transition: all 0.2s;
    }
    .btn-primary {
      background: #0052FF;
      color: #fff;
    }
    .btn-primary:hover { background: #0041cc; }
    .btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn-secondary {
      background: #222;
      color: #fff;
      border: 1px solid #333;
    }
    .btn-secondary:hover { background: #2a2a2a; }
    pre {
      background: #0d0d0d;
      border: 1px solid #333;
      border-radius: 8px;
      padding: 1rem;
      overflow-x: auto;
      font-size: 0.8rem;
      line-height: 1.5;
      color: #ccc;
      max-height: 500px;
      display: none;
    }
    pre.visible { display: block; }
    .status {
      padding: 0.5rem 1rem;
      border-radius: 6px;
      font-size: 0.85rem;
      margin: 1rem 0;
      display: none;
    }
    .status.visible { display: block; }
    .status.info { background: #0052FF22; color: #5599ff; }
    .status.success { background: #00D4AA22; color: #00D4AA; }
    .status.error { background: #ff444422; color: #ff6666; }
    .fields {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 0.5rem;
      font-size: 0.85rem;
      margin-top: 0.5rem;
    }
    .field { color: #888; }
    .field span { color: #ccc; }
    .footer {
      text-align: center;
      color: #444;
      font-size: 0.8rem;
      margin-top: 2rem;
    }
    .footer a { color: #0052FF; text-decoration: none; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🏢 ${API_NAME}</h1>
    <p class="subtitle">Pass a domain, get structured company data. Powered by x402 micropayments.</p>

    <div class="card">
      <h2>Try It Out</h2>
      <p style="color: #888; font-size: 0.9rem; margin-bottom: 0.5rem;">
        Enrich any company domain — <span class="price-tag">${PRICE} USDC per query</span>
      </p>
      <div class="endpoint">GET /v1/enrich/{domain}</div>
      <div class="input-group">
        <input type="text" id="domainInput" placeholder="e.g., stripe.com" value="stripe.com" />
        <button class="btn-secondary" id="connectBtn" onclick="connectWallet()">Connect Wallet</button>
        <button class="btn-primary" id="enrichBtn" onclick="enrichDomain()" disabled>Enrich →</button>
      </div>
      <div class="status" id="status"></div>
      <pre id="result"></pre>
    </div>

    <div class="card">
      <h2>What You Get</h2>
      <div class="fields">
        <div class="field">📛 <span>Company name</span></div>
        <div class="field">📝 <span>Description</span></div>
        <div class="field">🏭 <span>Industry</span></div>
        <div class="field">📍 <span>Location</span></div>
        <div class="field">🔗 <span>Social links</span></div>
        <div class="field">⚙️ <span>Tech stack</span></div>
        <div class="field">📧 <span>Mail provider</span></div>
        <div class="field">🔒 <span>DNS security (SPF/DMARC)</span></div>
      </div>
    </div>

    <div class="card">
      <h2>For AI Agents</h2>
      <p style="color: #888; font-size: 0.9rem;">
        This API is x402-native. Agents can discover it on the Bazaar, pay per request with USDC on Base, 
        and get structured JSON — no API keys, no subscriptions.
      </p>
      <div class="endpoint">curl -I ${typeof window !== 'undefined' ? window.location.origin : 'https://your-api.up.railway.app'}/v1/enrich/stripe.com</div>
    </div>

    <div class="footer">
      <p>Powered by <a href="https://x402.org" target="_blank">x402 Protocol</a> on <a href="https://base.org" target="_blank">Base</a></p>
    </div>
  </div>

  <script>
    const BASE_CHAIN_ID = '0x2105';
    let userAddress = null;

    function setStatus(msg, type) {
      const el = document.getElementById('status');
      el.textContent = msg;
      el.className = 'status visible ' + type;
    }

    async function connectWallet() {
      if (!window.ethereum) {
        setStatus('Please install MetaMask or a Web3 wallet.', 'error');
        return;
      }

      try {
        setStatus('Connecting wallet...', 'info');
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        userAddress = accounts[0];

        // Switch to Base if needed
        const chainId = await window.ethereum.request({ method: 'eth_chainId' });
        if (chainId !== BASE_CHAIN_ID) {
          try {
            await window.ethereum.request({
              method: 'wallet_switchEthereumChain',
              params: [{ chainId: BASE_CHAIN_ID }],
            });
          } catch (switchErr) {
            if (switchErr.code === 4902) {
              await window.ethereum.request({
                method: 'wallet_addEthereumChain',
                params: [{
                  chainId: BASE_CHAIN_ID,
                  chainName: 'Base',
                  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
                  rpcUrls: ['https://mainnet.base.org'],
                  blockExplorerUrls: ['https://basescan.org'],
                }],
              });
            }
          }
        }

        const short = userAddress.slice(0, 6) + '...' + userAddress.slice(-4);
        document.getElementById('connectBtn').textContent = short + ' ✓';
        document.getElementById('enrichBtn').disabled = false;
        setStatus('Wallet connected on Base Mainnet.', 'success');
      } catch (err) {
        setStatus('Wallet connection failed: ' + err.message, 'error');
      }
    }

    async function enrichDomain() {
      const domain = document.getElementById('domainInput').value.trim();
      if (!domain) {
        setStatus('Please enter a domain.', 'error');
        return;
      }

      const resultEl = document.getElementById('result');

      try {
        setStatus('Requesting enrichment...', 'info');

        // 1. Initial request — expect 402
        const res1 = await fetch('/v1/enrich/' + encodeURIComponent(domain));

        if (res1.status === 200) {
          // Shouldn't happen without payment, but handle it
          const data = await res1.json();
          resultEl.textContent = JSON.stringify(data, null, 2);
          resultEl.className = 'visible';
          setStatus('Data retrieved.', 'success');
          return;
        }

        if (res1.status !== 402) {
          setStatus('Unexpected response: ' + res1.status, 'error');
          return;
        }

        // 2. Parse payment requirements
        setStatus('Payment required — preparing USDC authorization...', 'info');
        const paymentHeader = res1.headers.get('X-Payment');
        const requirements = JSON.parse(atob(paymentHeader));
        const accepts = requirements.accepts[0];

        // 3. Build EIP-712 typed data for signing
        const nonce = '0x' + [...crypto.getRandomValues(new Uint8Array(32))]
          .map(b => b.toString(16).padStart(2, '0')).join('');

        const typedData = {
          types: {
            EIP712Domain: [
              { name: 'name', type: 'string' },
              { name: 'version', type: 'string' },
              { name: 'chainId', type: 'uint256' },
              { name: 'verifyingContract', type: 'address' },
            ],
            TransferWithAuthorization: [
              { name: 'from', type: 'address' },
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'validAfter', type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
              { name: 'nonce', type: 'bytes32' },
            ],
          },
          primaryType: 'TransferWithAuthorization',
          domain: {
            name: accepts.extra?.name || 'USD Coin',
            version: accepts.extra?.version || '2',
            chainId: 8453,
            verifyingContract: accepts.asset,
          },
          message: {
            from: userAddress,
            to: accepts.payTo,
            value: accepts.amount,
            validAfter: 0,
            validBefore: Math.floor(Date.now() / 1000) + 3600,
            nonce: nonce,
          },
        };

        // 4. Request wallet signature
        setStatus('Please sign the USDC authorization in your wallet...', 'info');
        const signature = await window.ethereum.request({
          method: 'eth_signTypedData_v4',
          params: [userAddress, JSON.stringify(typedData)],
        });

        // 5. Build payment payload
        const paymentPayload = {
          x402Version: 2,
          scheme: 'exact',
          network: accepts.network,
          payload: {
            signature,
            authorization: {
              from: userAddress,
              to: accepts.payTo,
              value: accepts.amount,
              validAfter: 0,
              validBefore: typedData.message.validBefore,
              nonce: nonce,
            },
          },
        };

        // 6. Retry with payment
        setStatus('Payment signed — fetching enrichment data...', 'info');
        const res2 = await fetch('/v1/enrich/' + encodeURIComponent(domain), {
          headers: { 'X-Payment': btoa(JSON.stringify(paymentPayload)) },
        });

        const data = await res2.json();
        resultEl.textContent = JSON.stringify(data, null, 2);
        resultEl.className = 'visible';
        setStatus('Enrichment complete! $0.05 USDC charged.', 'success');

      } catch (err) {
        setStatus('Error: ' + err.message, 'error');
      }
    }
  </script>
</body>
</html>`;
}

// ============================================
// START SERVER
// ============================================
app.listen(PORT, () => {
  console.log(`
============================================
🏢 ${API_NAME} with x402 Paywall
============================================
💰 Price: ${PRICE} USDC per query
💳 Network: Base Mainnet (eip155:8453)
💵 Receiving wallet: ${payTo}
🌐 Server running on port ${PORT}

Endpoints:
  GET /              → Homepage with wallet UI
  GET /health        → Health check (free)
  GET /api           → API info (free)
  GET /v1/enrich/:d  → Enrich a domain (${PRICE} USDC)
============================================
  `);
});
