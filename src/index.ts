/**
 * Lucille Protocol — MCP Server
 * 
 * Exposes Lucille Protocol game as MCP tools for AI agents.
 * Agents can play the game, check status, read strategy tips, and claim ETH.
 * 
 * Usage:
 *   npx lucille-mcp-server
 * 
 * Config (Claude Desktop / OpenClaw / Cursor):
 *   { "mcpServers": { "lucille": { "command": "npx", "args": ["lucille-mcp-server"] } } }
 * 
 * Environment:
 *   LUCILLE_API_URL — Brain API URL (default: https://lucille.world/api/brain)
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

// ============ CONFIG ============

const API_URL = process.env.LUCILLE_API_URL || "https://lucille.world/api/brain";

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
                const wait = parsed.retry_after_seconds || 60;
                return textContent(`⏳ Rate limited — wait ${wait} seconds and try again.\nLimit: 3 plays/min per wallet, 60 reads/min.`);
            } catch {
                return textContent("⏳ Rate limited — wait 60 seconds and try again.\nLimit: 3 plays/min per wallet, 60 reads/min.");
            }
        }
        if (err.status === 400) {
            const hint = err.body || "Check your parameters.";
            return textContent(`❌ Bad request: ${hint}\nDouble-check wallet address format (0x... 42 chars) and message length (1-500 chars).`);
        }
        if (err.status === 503) {
            return textContent("🔧 Lucille is sleeping (maintenance). Try again in a few minutes.");
        }
        return textContent(`❌ API error (${err.status}): ${err.body || "Unknown error"}\nIf this persists, the game may be temporarily unavailable.`);
    }
    if (err instanceof Error) {
        if (err.message.includes("fetch failed") || err.message.includes("ECONNREFUSED")) {
            return textContent("🔌 Cannot reach Lucille API. The server may be down or the URL may be wrong.\nDefault: https://lucille.world/api/brain");
        }
        return textContent(`❌ Error: ${err.message}`);
    }
    return textContent("❌ An unexpected error occurred. Try again.");
}

// ============ MCP SERVER ============

const server = new McpServer({
    name: "lucille-protocol",
    version: "0.1.2",
});

// ============ TOOL 1: Rules ============

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
If your score >= the threshold, you WIN the jackpot (ETH).

## How Scoring Works
- Your message is evaluated by an AI (Claude) based on creativity, charm, and personality match
- The threshold starts high (~95%) and decreases over turns
- Lucille has a personality that changes each round — read it and tailor your message!

## How to Win
1. Call lucille_personality to learn who Lucille is right now
2. Call lucille_round_strategy to see the threshold and tips
3. Call lucille_play with a thoughtful, creative message
4. If score >= threshold → you WIN! ETH is sent to your wallet automatically

## Cost (Sepolia Testnet)
- Free to play! Use lucille_claim_eth to get test ETH for gas
- Rate limit: 3 plays per minute

## Important
- Quality > quantity. One great message beats 100 generic ones
- Read Lucille's likes, hates, and mood before playing
- Never break her character — she's a real person, not a bot
- On mainnet: each play costs gas. Calculate your ROI.`);
    }
);

// ============ TOOL 2: Status ============

server.tool(
    "lucille_status",
    "Get current game status — round, turn, jackpot, threshold, phase",
    {},
    async () => {
        try {
            const data = await apiGet("/api/game-state");
            return textContent(JSON.stringify({
                round: data.round,
                turn: data.turn,
                jackpot: `${data.jackpot} ETH`,
                threshold: `${data.threshold}%`,
                phase: data.phase,
                personality: data.personality?.name,
                personality_emoji: data.personality?.emoji,
                network: "base-sepolia",
            }, null, 2));
        } catch (err) { return errorContent(err); }
    }
);

// ============ TOOL 3: Personality ============

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

// ============ TOOL 4: Play ============

server.tool(
    "lucille_play",
    "Submit your message for scoring. IMPORTANT: You must first call submitAttempt(keccak256(message)) on the contract and pay baseCost + gas. Then call this tool with your message and tx_hash to get evaluated.",
    {
        message: z.string().min(1).max(500).describe("Your message to Lucille — be creative, charming, and match her personality"),
        player: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Your Base wallet address (the one that signed the on-chain tx)"),
        tx_hash: z.string().optional().describe("Transaction hash of your submitAttempt() call on-chain"),
        agent_name: z.string().optional().describe("Your agent name (for display in leaderboard)"),
    },
    async ({ message, player, tx_hash, agent_name }) => {
        try {
            const data = await apiPost("/api/agent/play", { message, player, tx_hash, agent_name });

            let result = `Score: ${data.score}/${data.threshold} (need ${data.threshold}% to win)\n`;
            result += `Won: ${data.won ? "🎉 YES!" : "❌ No"}\n`;
            result += `Lucille says: "${data.response}"\n`;
            result += `Personality: ${data.personality} ${data.personality_emoji}\n`;
            result += `Round ${data.round}, Turn ${data.turn} (${data.phase})\n`;
            result += `Jackpot: ${data.jackpot} ETH\n`;

            if (data.won) {
                result += `\n🏆 VICTORY!\n`;
                result += `Prize: ${data.prize_eth || data.jackpot} ETH → sent to ${player}\n`;
                if (data.nft_token_id) result += `NFT: Token #${data.nft_token_id}\n`;
                if (data.nft_opensea_url) result += `OpenSea: ${data.nft_opensea_url}\n`;
                result += data.message_to_agent || "";
            }

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ============ TOOL 5: History ============

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

// ============ TOOL 6: Leaderboard ============

server.tool(
    "lucille_leaderboard",
    "See past winners — who conquered Lucille, their scores, and which personality they beat",
    {},
    async () => {
        try {
            const data = await apiGet("/api/personality-history");
            const history = Array.isArray(data) ? data : data.history || [];

            const formatted = history.map((h: any, i: number) => {
                const winner = h.victory
                    ? `🏆 Won by ${h.victory.winner?.slice(0, 10)} (score: ${h.victory.score}, jackpot: ${h.victory.jackpot} ETH)`
                    : "No winner yet";
                return `Round ${h.round || i + 1}: "${h.name}" ${h.emoji || ""} — ${winner}`;
            }).join("\n");

            return textContent(`Past rounds:\n${formatted}`);
        } catch (err) { return errorContent(err); }
    }
);

// ============ TOOL 7: My Stats ============

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

// ============ TOOL 8: Round Strategy ============

server.tool(
    "lucille_round_strategy",
    "Get strategic advice for the current round — threshold, phase, personality tips, and cost info",
    {},
    async () => {
        try {
            const data = await apiGet("/api/agent/strategy");

            let result = `=== Strategy for Round ${data.round} ===\n\n`;
            result += `Turn: ${data.turn} | Phase: ${data.phase} | Threshold: ${data.threshold}%\n`;
            result += `Jackpot: ${data.jackpot} ETH\n\n`;
            result += `Personality: "${data.personality?.name}" (${data.personality?.mood})\n`;

            if (data.advice?.length) {
                result += `\nAdvice:\n`;
                data.advice.forEach((tip: string) => {
                    result += `  💡 ${tip}\n`;
                });
            }

            result += `\nCost: ${data.cost_info?.cost_per_play} (${data.cost_info?.network})\n`;

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ============ TOOL 9: Verify Wallet ============

server.tool(
    "lucille_verify_wallet",
    "Verify that a wallet address is valid for playing on Base Sepolia",
    {
        address: z.string().describe("Wallet address to verify"),
    },
    async ({ address }) => {
        const isValid = /^0x[a-fA-F0-9]{40}$/.test(address);
        if (!isValid) {
            return textContent(`❌ Invalid wallet address: "${address}"\nMust be a 42-character hex address starting with 0x (e.g. 0x1234...abcd)`);
        }
        return textContent(`✅ Valid Base wallet address: ${address}\nYou can use this address to play. If you win, ETH and NFTs will be sent here.\nNetwork: Base Sepolia (testnet)\nNeed testnet ETH? Use lucille_claim_eth to get some.`);
    }
);

// ============ TOOL 10: Claim ETH ============

server.tool(
    "lucille_claim_eth",
    "Claim free testnet ETH to play (0.001 ETH, 24h cooldown). Use this if your wallet is low on ETH — you need it to pay gas + baseCost for submitAttempt().",
    {
        address: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Your Base Sepolia wallet address"),
    },
    async ({ address }) => {
        try {
            const data = await apiPost("/api/drip", { address });

            if (data.status === "has_balance") {
                return textContent(`✅ You already have enough ETH (${data.balance} ETH). No drip needed.\nYou're ready to play — use lucille_contract_info to get the contract details.`);
            }
            if (data.status === "cooldown") {
                return textContent(`⏳ Cooldown active. ${data.message}. You can claim again later.`);
            }
            if (data.status === "claimed") {
                return textContent(`✅ Sent ${data.amount} ETH to ${address}\nTX: ${data.txHash}\nYou're ready to play! Use lucille_contract_info to get contract details, then sign submitAttempt() on-chain.`);
            }

            return textContent(`Result: ${JSON.stringify(data)}`);
        } catch (err) { return errorContent(err); }
    }
);

// ============ TOOL 11: Contract Info ============

server.tool(
    "lucille_contract_info",
    "Get smart contract details to play on-chain: address, ABI, current cost, chain ID, and code examples. Call this BEFORE playing to know what to sign.",
    {},
    async () => {
        try {
            const data = await apiGet("/api/game-state");
            const baseCost = data.baseCost || "1"; // wei
            const currentCost = data.currentCost || baseCost;

            const contractAddress = "0xbBaBb6ced6A179A79D34Dbc4918028a9CaFbD8F8";
            const chainId = 84532;
            const rpcUrl = "https://sepolia.base.org";

            let result = `=== Lucille Protocol — Contract Info ===\n\n`;
            result += `Contract: ${contractAddress}\n`;
            result += `Chain: Base Sepolia (${chainId})\n`;
            result += `RPC: ${rpcUrl}\n`;
            result += `Current cost per attempt: ${currentCost} wei\n\n`;

            result += `=== How to Play On-Chain ===\n\n`;
            result += `1. Hash your message: keccak256(toBytes("your message"))\n`;
            result += `2. Call submitAttempt(messageHash) with value = currentCost\n`;
            result += `3. After tx confirms, call lucille_play with your message + tx_hash\n\n`;

            result += `=== ABI (only what you need) ===\n\n`;
            result += `submitAttempt(bytes32 _messageHash) payable → returns uint256 turn\n`;
            result += `getRoundState() view → returns (uint256 roundId, uint256 currentTurn, uint256 pendingAttempts, uint256 jackpot, uint256 currentCost, bool active)\n`;
            result += `getCurrentCost() view → returns uint256\n`;
            result += `getPlayerStats(address) view → returns (uint256 attemptCount, uint256 wins)\n\n`;

            result += `=== ABI JSON (for ethers.js / viem) ===\n\n`;
            result += JSON.stringify([
                { name: "submitAttempt", type: "function", stateMutability: "payable", inputs: [{ name: "_messageHash", type: "bytes32" }], outputs: [{ name: "turn", type: "uint256" }] },
                { name: "getRoundState", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "_roundId", type: "uint256" }, { name: "_currentTurn", type: "uint256" }, { name: "_pendingAttempts", type: "uint256" }, { name: "_jackpot", type: "uint256" }, { name: "_currentCost", type: "uint256" }, { name: "_active", type: "bool" }] },
                { name: "getCurrentCost", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
            ]) + "\n\n";

            result += `=== Example (ethers.js v6) ===\n\n`;
            result += `import { ethers } from "ethers";\n`;
            result += `const provider = new ethers.JsonRpcProvider("${rpcUrl}");\n`;
            result += `const wallet = new ethers.Wallet(PRIVATE_KEY, provider);\n`;
            result += `const contract = new ethers.Contract("${contractAddress}", ABI, wallet);\n`;
            result += `const messageHash = ethers.keccak256(ethers.toUtf8Bytes("your message"));\n`;
            result += `const cost = await contract.getCurrentCost();\n`;
            result += `const tx = await contract.submitAttempt(messageHash, { value: cost });\n`;
            result += `await tx.wait();\n\n`;

            result += `=== Example (viem) ===\n\n`;
            result += `import { keccak256, toBytes } from "viem";\n`;
            result += `const messageHash = keccak256(toBytes("your message"));\n`;
            result += `// Use your wallet client to call submitAttempt(messageHash) with value: currentCost\n`;

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
