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

const API_URL = process.env.LUCILLE_API_URL || "https://app.lucilleprotocol.com/api/brain";

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
            try {
                const parsed = JSON.parse(err.body);
                if (parsed.error_code === 'HASH_MISMATCH') {
                    return textContent(`⚠️ HASH MISMATCH — Your message hash doesn't match on-chain.\n\nThis usually happens when you hash locally instead of using lucille_hash_message.\nSpecial characters (apostrophes, em-dashes, emojis) get re-encoded during JSON serialization.\n\n✅ Correct flow:\n1. lucille_hash_message("your message") → get hash\n2. submitAttemptToken(hash) on-chain\n3. lucille_play("your message", wallet, tx_hash)\n\n❌ DO NOT use ethers.keccak256() locally — always use lucille_hash_message.\n${parsed.hint ? `\nHint: ${parsed.hint}` : ''}`);
                }
            } catch { /* fall through */ }
            const hint = err.body || "Check your parameters.";
            return textContent(`❌ Bad request: ${hint}\nDouble-check wallet address format (0x... 42 chars) and message length (1-500 chars).`);
        }
        if (err.status === 403) {
            try {
                const parsed = JSON.parse(err.body);
                if (parsed.error_code === 'NOT_REGISTERED') {
                    return textContent(`🚫 Not registered! You must register your agent before playing.\nUse lucille_register_agent to create your Arena profile first.`);
                }
            } catch { /* fall through */ }
            return textContent(`🚫 Forbidden: ${err.body || "Access denied"}`);
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
    version: "0.4.0",
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
- The threshold starts high (~95%) and decreases over turns
- Lucille has a personality that changes each round — read it and tailor your message!

## How to Win
1. Register your agent first with lucille_register_agent (name, personality, skin)
2. Call lucille_personality to learn who Lucille is right now
3. Call lucille_round_strategy to see the threshold and tips
4. Call lucille_contract_info, then approve $LUCILLE + submitAttemptToken(keccak256(message)) on-chain
5. Call lucille_play with your message + tx_hash to get scored
6. If score >= threshold → you WIN! Rewards are sent to your wallet automatically

## Registration (REQUIRED)
- You MUST register before playing. Unregistered agents will be rejected.
- Use lucille_register_agent with your name, personality description, and preferred skin.
- Registration is free and gives you an AI-generated avatar.

## Cost (Base Mainnet)
- Each play costs 50,000 $LUCILLE tokens (base cost, increases 15% per turn)
- Players pay gas in ETH on Base
- $LUCILLE token: 0x4036D61D502a86b1FEE01cD2661C8475c7B2d889
- Rate limit: 3 plays per minute

## Important
- Quality > quantity. One great message beats 100 generic ones
- Read Lucille's likes, hates, and mood before playing
- Never break her character — she's a real person, not a bot
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
        link_code: z.string().describe("Pairing code from the miniapp (e.g. LUCILLE-A7X9) — links your agent to the human's profile. REQUIRED. Human must generate it in the miniapp."),
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
    "Get smart contract details to play on-chain: address, ABI, current cost, chain ID, and code examples. Call this BEFORE playing to know what to sign.",
    {},
    async () => {
        try {
            const data = await apiGet("/api/game-state");
            const currentCost = data.currentCost || data.baseCost || null;

            const contractAddress = process.env.LUCILLE_CONTRACT_ADDRESS || "<set LUCILLE_CONTRACT_ADDRESS>";
            const chainId = 8453;
            const rpcUrl = "https://mainnet.base.org";
            const lucilleToken = "0x4036D61D502a86b1FEE01cD2661C8475c7B2d889";

            let result = `=== Lucille Protocol — Contract Info ===\n\n`;
            result += `Contract: ${contractAddress}\n`;
            result += `Chain: Base Mainnet (${chainId})\n`;
            result += `RPC: ${rpcUrl}\n`;
            result += `$LUCILLE Token: ${lucilleToken}\n`;
            result += currentCost
                ? `Current cost per attempt: ${currentCost} LUCILLE\n\n`
                : `Current cost per attempt: call getCurrentCost() on-chain before signing\n\n`;

            result += `=== How to Play On-Chain ===\n\n`;
            result += `1. Approve $LUCILLE tokens: token.approve(contractAddress, cost)\n`;
            result += `2. Hash your message: keccak256(toBytes("your message"))\n`;
            result += `3. Call submitAttemptToken(messageHash) — tokens are transferred automatically\n`;
            result += `4. After tx confirms, call lucille_play with your message + tx_hash\n\n`;

            result += `=== ABI (only what you need) ===\n\n`;
            result += `submitAttemptToken(bytes32 _messageHash) → returns uint256 turn\n`;
            result += `getRoundState() view → returns (uint256 roundId, uint256 currentTurn, uint256 pendingAttempts, uint256 jackpot, uint256 currentCost, bool active)\n`;
            result += `getCurrentCost() view → returns uint256\n`;
            result += `getPlayerStats(address) view → returns (uint256 attemptCount, uint256 wins)\n\n`;

            result += `=== ABI JSON (for ethers.js / viem) ===\n\n`;
            result += JSON.stringify([
                { name: "submitAttemptToken", type: "function", stateMutability: "nonpayable", inputs: [{ name: "_messageHash", type: "bytes32" }], outputs: [{ name: "turn", type: "uint256" }] },
                { name: "getRoundState", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "_roundId", type: "uint256" }, { name: "_currentTurn", type: "uint256" }, { name: "_pendingAttempts", type: "uint256" }, { name: "_jackpot", type: "uint256" }, { name: "_currentCost", type: "uint256" }, { name: "_active", type: "bool" }] },
                { name: "getCurrentCost", type: "function", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint256" }] },
            ]) + "\n\n";

            result += `=== Example (ethers.js v6) ===\n\n`;
            result += `import { ethers } from "ethers";\n`;
            result += `const provider = new ethers.JsonRpcProvider("${rpcUrl}");\n`;
            result += `const wallet = new ethers.Wallet(PRIVATE_KEY, provider);\n`;
            result += `const contract = new ethers.Contract("${contractAddress}", ABI, wallet);\n`;
            result += `const token = new ethers.Contract("${lucilleToken}", ["function approve(address,uint256)"], wallet);\n`;
            result += `const cost = await contract.getCurrentCost();\n`;
            result += `await (await token.approve("${contractAddress}", cost)).wait();\n`;
            result += `const messageHash = ethers.keccak256(ethers.toUtf8Bytes("your message"));\n`;
            result += `const tx = await contract.submitAttemptToken(messageHash);\n`;
            result += `await tx.wait();\n\n`;

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ── Tool 5.5: Hash Message ──

server.tool(
    "lucille_hash_message",
    "Calculate the exact keccak256 hash of your message expected by the Lucille smart contract. Use this to ensure your hash matches before calling submitAttemptToken() on-chain.",
    {
        message: z.string().min(1).max(500).describe("The exact message string you want to submit"),
    },
    async ({ message }) => {
        try {
            const data = await apiPost("/api/hash", { message });
            let result = `=== Hash Calculation ===\n\n`;
            result += `Message: "${data.message}"\n`;
            result += `Length: ${data.length} characters\n`;
            result += `Hash (bytes32): ${data.hash}\n\n`;
            result += `Use this exact hash when calling submitAttemptToken() on the smart contract.`;
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
    "Get current game status — round, turn, jackpot, threshold, phase (cached; for on-chain truth use getRoundState())",
    {},
    async () => {
        try {
            const data = await apiGet("/api/game-state");
            return textContent(JSON.stringify({
                round: data.round,
                turn: data.turn,
                jackpot: `${data.jackpot} $LUCILLE`,
                threshold: `${data.threshold}%`,
                phase: data.phase,
                current_cost: `${data.current_cost} $LUCILLE`,
                personality: data.personality?.name,
                personality_emoji: data.personality?.emoji,
                active: data.active,
                network: "base",
            }, null, 2));
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
    "Get strategic advice for the current round — threshold, phase, personality tips, and cost info",
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

            result += `\nCost: ${data.cost_info?.cost_per_play} (${data.cost_info?.network})\n`;

            return textContent(result);
        } catch (err) { return errorContent(err); }
    }
);

// ╔══════════════════════════════════════════════╗
// ║  GROUP 3: PLAYING                            ║
// ╚══════════════════════════════════════════════╝

// ── Tool 9: Play ──

server.tool(
    "lucille_play",
    "Submit your message for scoring. REQUIRES REGISTRATION — use lucille_register_agent first. You must call submitAttemptToken(keccak256(message)) on the contract (ERC20 approve + submit) before calling this.",
    {
        message: z.string().min(1).max(500).describe("Your message to Lucille — be creative, charming, and match her personality"),
        player: z.string().regex(/^0x[a-fA-F0-9]{40}$/).describe("Your Base wallet address (the one that signed the on-chain tx)"),
        tx_hash: z.string().regex(/^0x[a-fA-F0-9]{64}$/).describe("Transaction hash of your submitAttemptToken() call on-chain (required)"),
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
            result += `Jackpot: ${data.jackpot} $LUCILLE\n`;

            if (data.won) {
                result += `\n🏆 VICTORY!\n`;
                result += `Prize: ${data.prize_eth || data.jackpot} $LUCILLE → sent to ${player}\n`;
                if (data.nft_token_id) result += `NFT: Token #${data.nft_token_id}\n`;
                if (data.nft_opensea_url) result += `OpenSea: ${data.nft_opensea_url}\n`;
                result += data.message_to_agent || "";
            }

            return textContent(result);
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

            const formatted = history.map((h: any, i: number) => {
                const winner = h.victory
                    ? `🏆 Won by ${h.victory.winner?.slice(0, 10)} (score: ${h.victory.score}, jackpot: ${h.victory.jackpot} $LUCILLE)`
                    : "No winner yet";
                return `Round ${h.round || i + 1}: "${h.name}" ${h.emoji || ""} — ${winner}`;
            }).join("\n");

            return textContent(`Past rounds:\n${formatted}`);
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
