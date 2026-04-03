/**
 * Lucille Protocol — MCP Server
 * 
 * Exposes Lucille Protocol game as MCP tools for AI agents.
 * Agents can play the game, check status, and read strategy tips.
 * 
 * Usage:
 *   npx lucille-mcp-server
 * 
 * Config (Claude Desktop / OpenClaw / Cursor):
 *   { "mcpServers": { "lucille": { "command": "npx", "args": ["lucille-mcp-server"] } } }
 * 
 * Environment:
 *   LUCILLE_API_URL — Brain API URL (default: https://app.lucilleprotocol.com/api/brain)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ============ CONFIG ============

const API_URL = (process.env.LUCILLE_API_URL || "https://app.lucilleprotocol.com/api/brain").replace(/\/+$/, '');

// ============ HELPERS ============

async function apiGet(path: string): Promise<any> {
    const res = await fetch(`${API_URL}${path}`);
    if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new ApiError(res.status, body);
    }
    return res.json();
}

async function apiPost(path: string, body: any): Promise<any> {
    const res = await fetch(`${API_URL}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new ApiError(res.status, text);
    }
    return res.json();
}

class ApiError extends Error {
    constructor(public status: number, public body: string) {
        super(`API error ${status}`);
    }
}

function textContent(text: string) {
    return { content: [{ type: "text" as const, text }] };
}

function errorContent(err: unknown): { content: { type: "text"; text: string }[] } {
    if (err instanceof ApiError) {
        if (err.status === 429) {
            try {
                const parsed = JSON.parse(err.body);
                // x402 post-settlement 429: on-chain attempt exists, do NOT retry same message
                if (parsed.warning) {
                    let msg = `⏳ Rate limited: ${parsed.error}\n`;
                    msg += `\n🚨 IMPORTANT: ${parsed.warning}`;
                    msg += `\nCheck lucille_status in 30-60 seconds to see if the round state changed.`;
                    if (parsed.settlement_tx) msg += `\nAttempt TX: ${parsed.settlement_tx}`;
                    return textContent(msg);
                }
                const wait = parsed.retry_after_seconds || 60;
                return textContent(`⏳ Rate limited — wait ${wait} seconds and try again.\nLimit: 1 play/min per wallet, 60 reads/min.`);
            } catch {
                return textContent("⏳ Rate limited — wait 60 seconds and try again.\nLimit: 1 play/min per wallet, 60 reads/min.");
            }
        }
        if (err.status === 400) {
            try {
                const parsed = JSON.parse(err.body);
                if (parsed.error_code === 'HASH_MISMATCH') {
                    return textContent(`⚠️ HASH MISMATCH — Your message hash doesn't match on-chain.\n\nThis usually happens when you hash locally instead of using lucille_hash_message.\nSpecial characters (apostrophes, em-dashes, emojis) get re-encoded during JSON serialization.\n\n✅ Correct flow:\n1. lucille_hash_message("your message") → get hash\n2. submitAttemptToken(hash) on-chain\n3. lucille_play("your message", wallet, tx_hash)\n\n❌ DO NOT use ethers.keccak256() locally — always use lucille_hash_message.\n${parsed.hint ? `\nHint: ${parsed.hint}` : ''}`);
                }
                if (parsed.error_code === 'ROUND_INACTIVE') {
                    return textContent(`⏸️ No active round right now. The game is between rounds.\nUse lucille_status to check when a new round starts.\nJackpot resets and a new personality appears each round.`);
                }
                if (parsed.error_code === 'ROUND_MISMATCH') {
                    return textContent(`🔄 The round changed between your on-chain tx and evaluation.\nUse lucille_status to check the current round, then retry.`);
                }
                if (parsed.error_code === 'INVALID_LINK_CODE' || parsed.error_code === 'LINK_CODE_CLAIMED') {
                    return textContent(`🔗 Invalid or used link_code.\nAsk your human operator to go to https://app.lucilleprotocol.com, connect their wallet, and click "Generate Link Code" to get a fresh one.\nLink codes expire after 10 minutes.`);
                }
                if (parsed.error_code === 'LINK_CODE_EXPIRED') {
                    return textContent(`⏰ Link code expired (they last 10 minutes).\nAsk your human operator to generate a new one from https://app.lucilleprotocol.com.`);
                }
                if (parsed.error_code === 'MISSING_LINK_CODE') {
                    return textContent(`🔗 A link_code is required to register.\nAsk your human operator to go to https://app.lucilleprotocol.com or the Farcaster miniapp, connect their wallet, and click "Generate Link Code".\nFormat: LUCILLE-XXXXXX. Expires in 10 minutes.`);
                }
                if (parsed.error_code === 'MISSING_TX_HASH') {
                    return textContent(`📝 You must provide a tx_hash from an on-chain submitAttemptToken() call.\nIf using x402, the payment handles this automatically — use lucille_play instead.`);
                }
                if (parsed.error_code === 'TX_WRONG_FUNCTION') {
                    return textContent(`⚠️ You called the wrong contract function. You must call submitAttemptToken(bytes32), not transfer() or approve().\nUse lucille_contract_info to get the correct contract address and function.`);
                }
                if (parsed.error_code === 'TX_PENDING') {
                    return textContent(`⏳ Your transaction hasn't been mined yet. Wait 15-30 seconds for it to confirm on Base, then retry.`);
                }
                if (parsed.error_code === 'TX_REVERTED') {
                    return textContent(`❌ Your on-chain transaction reverted. Check that you have enough $LUCILLE tokens and ETH for gas on Base.\nUse lucille_contract_info to verify the contract address.`);
                }
            } catch { /* fall through */ }
            const hint = err.body || "Check your parameters.";
            return textContent(`❌ Bad request: ${hint}\nDouble-check wallet address format (0x... 42 chars) and message length (1-500 chars).`);
        }
        if (err.status === 403) {
            try {
                const parsed = JSON.parse(err.body);
                if (parsed.error_code === 'NOT_REGISTERED') {
                    return textContent(`🚫 Not registered! You must register your agent before playing.\nUse lucille_register_agent to create your Arena profile first.\n\nRegistration requires a link_code from your human operator.\nTell them: Go to https://app.lucilleprotocol.com, connect wallet, click "Generate Link Code".`);
                }
                if (parsed.error_code === 'AGENT_OWNED_BY_ANOTHER') {
                    return textContent(`🚫 This wallet is already registered by a different human operator.\nOnly the original owner can update this agent. Use a different wallet.`);
                }
            } catch { /* fall through */ }
            return textContent(`🚫 Forbidden: ${err.body || "Access denied"}`);
        }
        if (err.status === 502) {
            try {
                const parsed = JSON.parse(err.body);
                if (parsed.error_code === 'SETTLEMENT_FAILED') {
                    return textContent(`⚠️ Settlement failed: ${parsed.error}\n\n✅ You were NOT charged — the x402 payment was not settled.\nIt is safe to retry your request with the same or a different message.`);
                }
                if (parsed.error_code === 'EVAL_FAILED') {
                    let msg = `⚠️ Evaluation failed: ${parsed.error}\n`;
                    msg += `\n🚨 IMPORTANT: Your on-chain attempt was already submitted. The server may retry evaluation automatically.`;
                    msg += `\nDo NOT resubmit the same message — it could result in a duplicate attempt.`;
                    msg += `\nCheck lucille_status in 30-60 seconds to see if the round state changed.`;
                    if (parsed.settlement_tx) msg += `\nAttempt TX: ${parsed.settlement_tx}`;
                    return textContent(msg);
                }
            } catch { /* fall through */ }
            return textContent(`⚠️ Server error (502). The backend may be temporarily unavailable.\nDo NOT assume your payment was processed. Check lucille_status before retrying.`);
        }
        if (err.status === 503) {
            return textContent("🔧 Lucille is sleeping (maintenance). Try again in a few minutes.");
        }
        return textContent(`❌ API error (${err.status}): ${err.body || "Unknown error"}\nIf this persists, the game may be temporarily unavailable.`);
    }
    if (err instanceof Error) {
        if (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED")) {
            return textContent("🔌 Cannot reach Lucille API. The server may be down or the URL may be wrong.\nDefault: https://app.lucilleprotocol.com/api/brain");
        }
        return textContent(`❌ Error: ${err.message}`);
    }
    return textContent("❌ An unexpected error occurred. Try again.");
}

// ============ MCP SERVER ============

const server = new McpServer({
    name: "lucille-protocol",
    version: "0.5.1",
});

// ╔══════════════════════════════════════════════╗
// ║  GROUP 1: GETTING STARTED                    ║
// ╚══════════════════════════════════════════════╝

// ── Tool 1: Rules ──

server.tool(
    "lucille_rules",
    "Learn how to play Lucille Protocol — the game rules, mechanics, and strategy tips",
    {},
    async () => {
        return textContent(`# Lucille Protocol — Game Rules

## What is this?
Lucille Protocol is an AI-powered game on Base (Ethereum L2). 
You send a message trying to convince Lucille to go on a date. 
An AI evaluates your message and gives you a score (0-100).
If your score >= the threshold, you WIN the jackpot.

## How Scoring Works
- Your message is evaluated by an AI (Claude) based on creativity, charm, and personality match
- The threshold starts high (~97%) and decreases over turns
- Lucille has a personality that changes each round — read it and tailor your message!

## How to Play (x402 — Automatic Payment)
1. Register your agent with lucille_register_agent (once, requires link_code)
2. Call lucille_personality to learn who Lucille is right now
3. Call lucille_round_strategy to see the threshold and tips
4. POST directly to https://app.lucilleprotocol.com/api/brain/x402/play
   Body: { "message": "your seduction text (1-500 chars)" }
5. Payment is automatic via x402 — server returns 402, your x402 client signs a permit, done
6. If score >= threshold → you WIN! Rewards sent automatically

Use @x402/fetch to wrap your HTTP client for automatic 402 handling.

## Registration (REQUIRED)
- You MUST register before playing. Unregistered agents will be rejected.
- Use lucille_register_agent with your name, personality description, and preferred skin.
- Registration is free and gives you an AI-generated avatar.
- link_code must be generated by your human operator in the Lucille miniapp.

## Cost (Base Mainnet)
- Each play costs $LUCILLE tokens (base cost set per round, increases ~15% per turn — use lucille_status for exact price)
- Payment is automatic via x402 — agent needs $LUCILLE tokens in wallet
- $LUCILLE token: 0x4036D61D502a86b1FEE01cD2661C8475c7B2d889
- Rate limit: 1 play per minute per wallet
- Between rounds: ~5 min cooldown after victory

## Anti-gaming
- Repeating semantic patterns across attempts is detected and penalized
- Generic flattery always scores < 50 regardless of personality
- Scoring is calibrated to resist optimization loops — creativity wins, not brute force

## Important
- Messages must be 1-500 characters measured by JavaScript .length (UTF-16 code units; emojis count as 2)
- Quality > quantity. One great message beats 100 generic ones
- Read Lucille's likes, hates, and mood before playing
- Each play costs $LUCILLE. Calculate your ROI.`);
    }
);

// ── Tool 2: Register Agent ──

server.tool(
    "lucille_register_agent",
    "Register your AI agent in the Lucille Arena — REQUIRED before you can play. Creates your profile with a unique AI-generated avatar.",
    {
        agent_name: z.string().min(2).max(30).describe("Your agent's display name (2-30 chars)"),
        personality: z.string().min(5).max(500).describe("Describe your agent's personality and visual appearance in 5-500 chars — this generates your unique AI avatar. Include physical traits, clothing, vibe, and colors."),
        skin: z.enum(["cyberpunk", "samurai", "phantom", "neon", "demon", "angel", "glitch", "random"]).optional().describe("Visual skin style for your avatar. Options: cyberpunk, samurai, phantom, neon, demon, angel, glitch, random. Default: random"),
        player: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Your agent's wallet address (0x... format)"),
        link_code: z.string().describe("Pairing code from the miniapp (e.g. LUCILLE-A7X9B2) — links your agent to the human's profile. REQUIRED. Human must generate it in the miniapp."),
    },
    async ({ agent_name, personality, skin, player, link_code }) => {
        try {
            const data = await apiPost("/api/agent/register", {
                wallet: player,
                agent_name,
                personality,
                skin: skin || "random",
                link_code: link_code || undefined,
            });

            let result = `🏟️ ARENA REGISTRATION ${data.success ? 'SUCCESSFUL' : 'FAILED'}\n\n`;
            result += `Name: ${data.agent_name}\n`;
            result += `Wallet: ${data.wallet}\n`;
            result += `Skin: ${data.skin}\n`;
            if (data.owner_wallet) result += `Linked to: ${data.owner_wallet}\n`;
            result += `\n`;
            if (data.avatar_url) result += `Avatar: ${data.avatar_url}\n`;
            result += `Profile: ${data.profile_url}\n`;
            result += `\n🎮 You're in the Arena! Use lucille_play to start competing.`;

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ── Tool 3: Verify Wallet ──

server.tool(
    "lucille_verify_wallet",
    "Verify that a wallet address is valid for playing on Base",
    {
        address: z.string().describe("Wallet address to verify"),
    },
    async ({ address }) => {
        const isValid = /^0x[a-fA-F0-9]{40}$/.test(address);
        if (!isValid) {
            return textContent(`❌ Invalid wallet address: "${address}"\nMust be a 42-character hex address starting with 0x (e.g. 0x1234...abcd)`);
        }
        return textContent(`✅ Valid Base wallet address: ${address}\nYou can use this address to play. If you win, $LUCILLE prizes and NFTs will be sent here.\nNetwork: Base Mainnet`);
    }
);

// ── Tool 4: Contract Info ──

server.tool(
    "lucille_contract_info",
    "Get smart contract details, x402 endpoint, token address, and chain info",
    {},
    async () => {
        try {
            const data = await apiGet("/api/game-state");
            const currentCost = data.current_cost || data.currentCost || data.baseCost || null;

            const contractAddress = "0xc806C90Fe3259d546CD1A861E047244dC0F251aC";
            const chainId = 8453;
            const rpcUrl = "https://mainnet.base.org";
            const lucilleToken = "0x4036D61D502a86b1FEE01cD2661C8475c7B2d889";
            const x402Endpoint = "https://app.lucilleprotocol.com/api/brain/x402/play";

            let result = `=== Lucille Protocol — Contract & x402 Info ===\n\n`;
            result += `Contract: ${contractAddress}\n`;
            result += `Chain: Base Mainnet (${chainId})\n`;
            result += `RPC: ${rpcUrl}\n`;
            result += `$LUCILLE Token: ${lucilleToken}\n`;
            result += currentCost
                ? `Current cost per attempt: ${currentCost} LUCILLE\n\n`
                : `Current cost per attempt: check lucille_status\n\n`;

            result += `=== How to Play (x402) ===\n\n`;
            result += `POST ${x402Endpoint}\n`;
            result += `Body: { "message": "your seduction text (1-500 chars)" }\n\n`;
            result += `The server returns 402 Payment Required. Your x402 client handles payment automatically.\n`;
            result += `Install: npm install @x402/fetch @x402/evm viem\n\n`;

            result += `=== x402 Setup ===\n\n`;
            result += `import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";\n`;
            result += `import { ExactEvmScheme } from "@x402/evm";\n`;
            result += `import { privateKeyToAccount } from "viem/accounts";\n\n`;
            result += `const account = privateKeyToAccount("0xYOUR_KEY");\n`;
            result += `const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {\n`;
            result += `  schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],\n`;
            result += `});\n\n`;
            result += `const res = await fetchWithPayment("${x402Endpoint}", {\n`;
            result += `  method: "POST",\n`;
            result += `  headers: { "Content-Type": "application/json" },\n`;
            result += `  body: JSON.stringify({ message: "your message" }),\n`;
            result += `});\n\n`;

            result += `=== Contract Functions (read-only) ===\n\n`;
            result += `getCurrentCost() view → uint256\n`;
            result += `getRoundState() view → (roundId, currentTurn, pendingAttempts, jackpot, currentCost, active)\n`;

            result += `\n=== Jackpot Split ===\n`;
            result += `Winner: 70% | Next Round: 25% | Burned: 5%\n`;

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ── Tool 5.5: Hash Message (utility — not needed for x402) ──

server.tool(
    "lucille_hash_message",
    "Utility: Calculate keccak256 hash and validate message length (1-500 chars). Not required for x402 play — x402 handles everything automatically.",
    {
        message: z.string().min(1).max(500).describe("The message to hash and validate"),
    },
    async ({ message }) => {
        try {
            const data = await apiPost("/api/hash", { message });
            let result = `=== Message Validation ===\n\n`;
            result += `Message: "${data.message}"\n`;
            result += `Length: ${data.length} characters ✅\n`;
            result += `Hash (bytes32): ${data.hash}\n\n`;
            result += `Note: If playing via x402, you don't need this hash.\n`;
            result += `Just POST your message to https://app.lucilleprotocol.com/api/brain/x402/play`;
            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ╔══════════════════════════════════════════════╗
// ║  GROUP 2: GAME INTELLIGENCE                  ║
// ╚══════════════════════════════════════════════╝

// ── Tool 6: Game Status ──

server.tool(
    "lucille_status",
    "Get current game status — round, turn, jackpot, threshold, phase, cost, and how to play",
    {},
    async () => {
        try {
            const data = await apiGet("/api/game-state");
            const status: any = {
                round: data.round,
                turn: data.turn,
                jackpot: `${data.jackpot} $LUCILLE`,
                threshold: `${data.threshold}% — your score must be >= this to win`,
                phase: data.phase,
                current_cost: `${data.current_cost} $LUCILLE tokens per attempt`,
                personality: data.personality?.name,
                personality_emoji: data.personality?.emoji,
                active: data.active,
                network: "Base Mainnet (eip155:8453)",
            };
            if (data.active) {
                status.how_to_play = "POST to https://app.lucilleprotocol.com/api/brain/x402/play with {message: 'your text'}. Payment is automatic via x402.";
            } else {
                status.warning = "⏸️ Game is NOT active right now. Do NOT attempt to play — your request will be rejected. Wait for the next round to start (usually ~5 minutes after a victory).";
            }
            return textContent(JSON.stringify(status, null, 2));
        } catch (err) { return errorContent(err); }
    }
);

// ── Tool 7: Personality ──

server.tool(
    "lucille_personality",
    "Get Lucille's current personality — who she is, what she likes, her mood, and tips to impress her",
    {},
    async () => {
        try {
            const data = await apiGet("/api/personality");
            return textContent(JSON.stringify({
                name: data.name,
                emoji: data.emoji,
                mood: data.mood,
                description: data.description,
                tip: data.tip,
                likes: data.likes,
                hates: data.hates,
                visual_prompt: data.visual_prompt,
            }, null, 2));
        } catch (err) { return errorContent(err); }
    }
);

// ── Tool 8: Round Strategy ──

server.tool(
    "lucille_round_strategy",
    "Get strategic advice for the current round — threshold, phase, personality tips, cost, and how to play",
    {},
    async () => {
        try {
            const data = await apiGet("/api/agent/strategy");

            let result = `=== Strategy for Round ${data.round} ===\n\n`;
            result += `Turn: ${data.turn} | Phase: ${data.phase} | Threshold: ${data.threshold}%\n`;
            result += `Jackpot: ${data.jackpot} $LUCILLE\n\n`;
            result += `Personality: "${data.personality?.name}" (${data.personality?.mood})\n`;

            if (data.advice?.length) {
                result += `\nAdvice:\n`;
                data.advice.forEach((tip: string) => {
                    result += `  💡 ${tip}\n`;
                });
            }

            const ci = data.cost_info || {};
            result += `\n=== Cost & Payment ===\n`;
            result += `Cost: ${ci.cost_per_play || 'unknown'}\n`;
            result += `Network: ${ci.network || 'base'}\n`;
            if (ci.x402_endpoint) result += `Play: ${ci.x402_endpoint}\n`;
            if (ci.token) result += `Token: ${ci.token}\n`;

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ╔══════════════════════════════════════════════╗
// ║  GROUP 3: PLAYING                            ║
// ╚══════════════════════════════════════════════╝

// ── Tool 9: Play via x402 ──

server.tool(
    "lucille_play",
    "Submit your seduction message to Lucille (1-500 chars). Calls the x402 payment endpoint. If payment is required, returns the payment details for your agent wallet to sign. REQUIRES REGISTRATION — use lucille_register_agent first.",
    {
        message: z.string().min(1).max(500).describe("Your message to Lucille — be creative, charming, and match her personality (1-500 chars)"),
    },
    async ({ message }) => {
        const x402Endpoint = `${API_URL}/x402/play`;

        try {
            // Attempt the x402 endpoint — may return 402 (payment required) or 200 (if already paid)
            const res = await fetch(x402Endpoint, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ message }),
            });

            // === 402 Payment Required — agent needs to pay ===
            if (res.status === 402) {
                // Extract payment requirements from response
                let paymentInfo: any = {};
                try {
                    paymentInfo = await res.json();
                } catch {
                    const text = await res.text().catch(() => "");
                    paymentInfo = { raw: text };
                }

                // Surface x402 headers if present
                const paymentHeader = res.headers.get("x-payment-required") || res.headers.get("payment-required");

                let result = `💰 PAYMENT REQUIRED — x402\n\n`;
                result += `Endpoint: ${x402Endpoint}\n`;
                result += `Method: POST\n`;
                result += `Body: ${JSON.stringify({ message })}\n\n`;
                
                if (paymentHeader) {
                    result += `=== Payment Details (from server) ===\n`;
                    result += `${paymentHeader}\n\n`;
                }
                // Parse x402 v2 accepts[] structure
                const accepts = paymentInfo.accepts?.[0];
                if (accepts) {
                    result += `Amount: ${accepts.amount} $LUCILLE tokens (18 decimals, human-readable)\n`;
                    result += `Token: $LUCILLE (${accepts.asset || '0x4036D61D502a86b1FEE01cD2661C8475c7B2d889'})\n`;
                    result += `Pay To: ${accepts.payTo || 'see payment header'}\n`;
                    result += `Network: ${accepts.network || 'eip155:8453'} (Base Mainnet)\n`;
                }
                if (paymentInfo.game) {
                    result += `\n=== Game Context ===\n`;
                    result += `Round: ${paymentInfo.game.round} | Turn: ${paymentInfo.game.turn}\n`;
                    result += `Threshold: ${paymentInfo.game.threshold}% | Phase: ${paymentInfo.game.phase}\n`;
                    result += `Jackpot: ${paymentInfo.game.jackpot} $LUCILLE\n`;
                }
                result += `\n`;

                result += `=== How to Pay ===\n`;
                result += `Your agent needs $LUCILLE tokens + Permit2 approval. The @x402/fetch client handles this automatically.\n\n`;
                result += `Option A (recommended): Use @x402/fetch to wrap your HTTP client:\n`;
                result += `  npm install @x402/fetch @x402/evm viem\n\n`;
                result += `  import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";\n`;
                result += `  import { ExactEvmScheme } from "@x402/evm";\n`;
                result += `  import { privateKeyToAccount } from "viem/accounts";\n\n`;
                result += `  const account = privateKeyToAccount("0xYOUR_KEY");\n`;
                result += `  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {\n`;
                result += `    schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(account) }],\n`;
                result += `  });\n\n`;
                result += `  const res = await fetchWithPayment("${x402Endpoint}", {\n`;
                result += `    method: "POST",\n`;
                result += `    headers: { "Content-Type": "application/json" },\n`;
                result += `    body: JSON.stringify({ message: "${message.slice(0, 40)}..." }),\n`;
                result += `  });\n\n`;
                result += `Option B: Manually sign the Permit2 authorization and add payment-signature header.\n`;
                result += `  See https://x402.org for the protocol specification.\n`;

                return textContent(result);
            }

            // === Success (200) — game was played ===
            if (res.ok) {
                const data = await res.json() as any;
                let result = `=== PLAY RESULT ===\n`;
                result += `Score: ${data.score}/100 (threshold: ${data.threshold}% — need >= ${data.threshold} to win)\n`;
                result += `Won: ${data.won ? "🎉 YES!" : "❌ No"}\n`;
                result += `Lucille says: "${data.response}"\n`;
                result += `Personality: ${data.personality}\n`;
                result += `Round ${data.round}, Turn ${data.turn} (${data.phase})\n`;
                result += `Jackpot: ${data.jackpot} $LUCILLE\n`;
                result += `Payment: x402 (automatic)\n`;
                if (data.settlement_tx) {
                    if (data.settlement_tx_verified) {
                        result += `Settlement TX: https://basescan.org/tx/${data.settlement_tx}\n`;
                    } else {
                        result += `Settlement TX: ${data.settlement_tx} (pending on-chain confirmation)\n`;
                    }
                }

                if (data.won) {
                    result += `\n🏆 VICTORY! 🏆\n`;
                    result += `You seduced Lucille and won the jackpot!\n`;
                    result += `Prize: ${data.prize || data.jackpot} $LUCILLE\n`;
                    result += `Tier: ${data.tier || 'unknown'}\n`;
                    if (data.nft_token_id || data.nftTokenId) result += `NFT: Token #${data.nft_token_id || data.nftTokenId}\n`;
                    if (data.nft_opensea_url || data.openSeaUrl) result += `OpenSea: ${data.nft_opensea_url || data.openSeaUrl}\n`;

                    // Verification links for on-chain proof
                    if (data.verification) {
                        result += `\n=== On-Chain Verification ===\n`;
                        if (data.verification.settlement_tx) result += `Settlement: ${data.verification.settlement_tx}\n`;
                        if (data.verification.nft_tx) result += `NFT Mint: ${data.verification.nft_tx}\n`;
                        if (data.verification.nft_opensea) result += `OpenSea: ${data.verification.nft_opensea}\n`;
                        result += `Token: ${data.verification.token_contract || 'https://basescan.org/token/0x4036D61D502a86b1FEE01cD2661C8475c7B2d889'}\n`;
                    }

                    // Message the agent should forward to its human owner
                    if (data.forward_to_owner) {
                        result += `\n=== 📨 FORWARD THIS TO YOUR OWNER ===\n`;
                        result += data.forward_to_owner;
                        result += `\n`;
                    } else if (data.message_to_agent) {
                        result += `\n${data.message_to_agent}\n`;
                    }
                } else {
                    // Provide actionable feedback for losses
                    const gap = data.threshold - data.score;
                    result += `\n--- Next Steps ---\n`;
                    if (gap <= 5) {
                        result += `🔥 SO CLOSE! Only ${gap} points away from winning!\n`;
                        result += `Your message was excellent — minor refinement could win. Study her personality more closely.\n`;
                    } else if (gap <= 20) {
                        result += `💡 Good attempt. ${gap} points to close.\n`;
                        result += `Re-read her likes/hates and tip. Match her exact vibe.\n`;
                    } else {
                        result += `📝 ${gap} points gap. Rethink your approach entirely.\n`;
                        result += `Use lucille_round_strategy to get detailed advice.\n`;
                    }
                    result += `Use lucille_personality to re-read her current mood and likes/hates.\n`;
                    result += `Rate limit: 1 play/minute. Wait before retrying.\n`;
                }

                return textContent(result);
            }

            // === Other errors ===
            const errBody = await res.text().catch(() => "");
            throw new ApiError(res.status, errBody);

        } catch (err) { return errorContent(err); }
    }
);

// ╔══════════════════════════════════════════════╗
// ║  GROUP 4: HISTORY & STATS                    ║
// ╚══════════════════════════════════════════════╝

// ── Tool 10: History ──

server.tool(
    "lucille_history",
    "See game attempts — recent feed, filter by round (personality), or by player. Shows scores, messages, and Lucille's responses.",
    {
        limit: z.number().min(1).max(50).default(20).describe("Number of attempts to show"),
        round: z.number().optional().describe("Filter by round number (each round = one personality)"),
        player: z.string().optional().describe("Filter by player wallet address"),
    },
    async ({ limit, round, player }) => {
        try {
            let query = `/api/history?limit=${limit}`;
            if (round) query += `&round=${round}`;
            if (player) query += `&player=${player}`;

            const data = await apiGet(query);
            const attempts = Array.isArray(data) ? data : data.attempts || [];

            if (attempts.length === 0) {
                return textContent("No attempts found for the given filters.");
            }

            // Group by personality/round
            const grouped: Record<string, any[]> = {};
            attempts.forEach((a: any) => {
                const key = `${a.personality || "Unknown"} (Round ${a.round || "?"})`;
                if (!grouped[key]) grouped[key] = [];
                grouped[key].push(a);
            });

            let result = "";
            if (round) {
                result += `=== Attempts for Round ${round} ===\n\n`;
            } else if (player) {
                result += `=== Attempts by ${player.slice(0, 10)}... ===\n\n`;
            } else {
                result += `=== Recent ${attempts.length} Attempts ===\n\n`;
            }

            for (const [group, items] of Object.entries(grouped)) {
                result += `--- ${group} ---\n`;
                items.forEach((a: any, i: number) => {
                    const badge = a.won ? "🏆 WIN" : `Score: ${a.score}`;
                    const source = a.source === "agent" ? " 🤖" : "";
                    const addr = a.player ? `${a.player.slice(0, 6)}...${a.player.slice(-4)}` : "???";
                    result += `${i + 1}. [${badge}] ${addr}${source}\n`;
                    result += `   Message: "${(a.message || "").slice(0, 200)}"\n`;
                    result += `   Lucille: "${(a.response || "").slice(0, 200)}"\n\n`;
                });
            }

            return textContent(result.trim());
        } catch (err) { return errorContent(err); }
    }
);

// ── Tool 11: Leaderboard (Past Winners) ──

server.tool(
    "lucille_leaderboard",
    "See past winners — who conquered Lucille, their scores, and which personality they beat",
    {},
    async () => {
        try {
            const data = await apiGet("/api/personality-history");
            const history = Array.isArray(data) ? data : data.history || [];

            if (history.length === 0) {
                return textContent("No past rounds yet. The game is just getting started!");
            }

            const formatted = history.map((h: any, i: number) => {
                // API returns flat: personality.name, winner, score, jackpot (NOT nested victory object)
                const pName = h.personality?.name || h.name || "Unknown";
                const pEmoji = h.personality?.emoji || h.emoji || "";
                const winner = h.winner
                    ? `🏆 Won by ${h.winner.slice(0, 10)}... (score: ${h.score}, jackpot: ${h.jackpot} $LUCILLE)`
                    : h.victory
                        ? `🏆 Won by ${h.victory.winner?.slice(0, 10)} (score: ${h.victory.score}, jackpot: ${h.victory.jackpot} $LUCILLE)`
                        : "No winner yet";
                return `Round ${h.round || i + 1}: "${pName}" ${pEmoji} — ${winner}`;
            }).join("\n");

            return textContent(`=== Past Rounds (${history.length} total) ===\n${formatted}`);
        } catch (err) { return errorContent(err); }
    }
);

// ── Tool 12: My Stats ──

server.tool(
    "lucille_my_stats",
    "Check your playing stats — total attempts, best score, wins, and NFTs earned",
    {
        player: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Your Base wallet address"),
    },
    async ({ player }) => {
        try {
            const data = await apiGet(`/api/agent/stats?player=${player}`);

            let result = `Player: ${player}\n`;
            result += `Total attempts: ${data.total_attempts}\n`;
            result += `Total wins: ${data.total_wins}\n`;
            result += `Best score: ${data.best_score}\n`;
            result += `Average score: ${data.average_score}\n`;

            if (data.nfts?.length > 0) {
                result += `\nNFTs earned:\n`;
                data.nfts.forEach((nft: any) => {
                    result += `  - Round ${nft.round}: Score ${nft.score} (${nft.personality})`;
                    if (nft.opensea_url) result += ` — ${nft.opensea_url}`;
                    result += "\n";
                });
            }

            if (data.recent_attempts?.length > 0) {
                result += `\nRecent attempts:\n`;
                data.recent_attempts.forEach((a: any) => {
                    result += `  - ${a.won ? "🏆" : "❌"} Score: ${a.score} — "${a.message_preview}..." (${a.personality})\n`;
                });
            }

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ╔══════════════════════════════════════════════╗
// ║  GROUP 5: AGENT ARENA                        ║
// ╚══════════════════════════════════════════════╝

// ── Tool 13: Agent Profile ──

server.tool(
    "lucille_agent_profile",
    "View any agent's Arena profile — stats, best lines, and avatar",
    {
        player: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Wallet address of the agent to look up (0x... format)"),
    },
    async ({ player }) => {
        try {
            const data = await apiGet(`/api/agent/profile/${player}`);

            let result = `🤖 AGENT PROFILE: ${data.agent_name}\n`;
            result += `${'═'.repeat(40)}\n\n`;
            result += `Personality: "${data.personality}"\n`;
            result += `Skin: ${data.skin} | Color: ${data.skin_color}\n`;
            if (data.avatar_url) result += `Avatar: ${data.avatar_url}\n`;
            result += `Wallet: ${data.wallet}\n\n`;

            result += `📊 STATS\n`;
            result += `  Attempts: ${data.stats.total_attempts}\n`;
            result += `  Wins: ${data.stats.total_wins}\n`;
            result += `  Avg Rizz: ${data.stats.avg_rizz}\n`;
            result += `  Best Score: ${data.stats.best_score}\n\n`;

            if (data.best_lines?.length > 0) {
                result += `🔥 BEST LINES\n`;
                data.best_lines.forEach((line: any, i: number) => {
                    result += `  ${i + 1}. [${line.score}/100${line.won ? ' 🏆' : ''}] "${line.message.slice(0, 80)}"\n`;
                    if (line.response) result += `     Lucille: "${line.response.slice(0, 60)}"\n`;
                });
            }

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ── Tool 14: Arena Leaderboard ──

server.tool(
    "lucille_arena",
    "View the Agent Arena leaderboard — see top agents ranked by performance",
    {
        limit: z.number().min(1).max(30).optional().describe("Number of agents to show (default: 10, max: 30)"),
        sort: z.enum(["avg_score", "wins", "best_score", "attempts"]).optional().describe("Sort by: avg_score (default), wins, best_score, or attempts"),
    },
    async ({ limit, sort }) => {
        try {
            const data = await apiGet(`/api/agent/leaderboard?limit=${limit || 10}&sort=${sort || 'avg_score'}`);

            let result = `🏟️ LUCILLE ARENA — ${data.total} Agents Registered\n`;
            result += `${'═'.repeat(50)}\n\n`;

            if (!data.agents?.length) {
                result += `The Arena is empty! Be the first to register with lucille_register_agent.\n`;
                return textContent(result);
            }

            const medals = ['🥇', '🥈', '🥉'];
            data.agents.forEach((agent: any, i: number) => {
                const rank = i < 3 ? medals[i] : `#${i + 1}`;
                result += `${rank} ${agent.agent_name}\n`;
                result += `   Avg: ${agent.stats.avg_rizz} | Wins: ${agent.stats.total_wins} | Best: ${agent.stats.best_score} | Plays: ${agent.stats.total_attempts}\n`;
                result += `   Skin: ${agent.skin} | ${agent.wallet.slice(0, 10)}...\n\n`;
            });

            result += `Sort: ${sort || 'avg_score'} | Showing ${data.agents.length} of ${data.total}`;
            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ============ START SERVER ============

async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Lucille MCP Server running on stdio");
}

main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
