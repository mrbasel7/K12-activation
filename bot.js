const TelegramBot = require("node-telegram-bot-api");
const Database = require("better-sqlite3");
const crypto = require("crypto");
const express = require("express");

// ==================== غير السطرين دول ====================
const BOT_TOKEN = "8681773635:AAGF5EUAdoD-LBacPeUp2o3Be8YWdQlNxI4";
const ADMIN_IDS = ["7469507752"];
// =========================================================

const WORKSPACE_IDS = [
  "a47c4ac6-36dd-4dec-a738-da6818ce4eed",
  "d1869eec-4d2d-4fce-967f-a1a6b906d51e",
  "a65ebb2e-dd7c-4fdb-9a5d-6ccaf6ad00a3",
  "52fb9943-aa13-4959-92bc-fe5e81c9e7f0",
  "8064da55-e484-4ba0-a0bc-db05ee84462b",
  "885440cb-01f9-4927-b2da-c7734cde849d",
  "d3c40646-82b0-42a5-a9e6-01819e5f66b2",
  "a4ed7848-dc98-4510-b4f8-ee170aad52ce",
  "0c0a3db9-ada3-44c0-8a15-f39a24c903f0",
  "c4d1df5b-81cd-445d-a5ea-4131a0fbb9d2",
  "1a4f5089-cab2-4f46-8073-6c8bb13f6aff",
  "44a5d4e6-e463-4412-88f3-0c98290027b7",
  "73fb6c1c-cac8-4285-99ec-44c6fe854f70",
  "7e443923-cb5f-45f4-a8a1-682de043f351",
  "52dcb028-8f47-4fab-b7e1-d827125b8687",
  "81597c95-7832-4fdc-a1e8-0835bdba7fb3",
  "4fdf7f85-38d1-4eea-aeb9-f50939ffb9d8",
  "e1fbfed6-86a4-49b0-868d-17c396358d57",
  "8c27eb04-d736-4548-af16-662dde1dc6e9",
  "191c2ca9-06fe-45ff-ac6a-de4ec8fefee9",
];

// ==================== DATABASE ====================
const db = new Database("bot_data.db");
db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS codes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    is_used INTEGER DEFAULT 0,
    used_by TEXT,
    used_at TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    username TEXT,
    email TEXT,
    code TEXT,
    workspace_id TEXT,
    route TEXT,
    status TEXT,
    http_code INTEGER,
    response_body TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )
`);

// ==================== BOT ====================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
const userState = {};

// ==================== HELPERS ====================
function parseJwt(at) {
  try {
    const parts = at.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(Buffer.from(parts[1], "base64").toString("utf8"));
    const auth = payload["https://api.openai.com/auth"] || {};
    const prof = payload["https://api.openai.com/profile"] || {};
    return {
      account_id: auth.chatgpt_account_id || "",
      email: prof.email || "",
      plan_type: auth.chatgpt_plan_type || "",
      exp: payload.exp || 0,
    };
  } catch {
    return null;
  }
}

async function sendInvite(at, wsId, route) {
  const url = `https://chatgpt.com/backend-api/accounts/${wsId}/invites/${route}`;
  const deviceId = crypto.randomUUID();
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        accept: "*/*",
        authorization: "Bearer " + at,
        "content-type": "application/json",
        "oai-device-id": deviceId,
        "oai-language": "en-US",
      },
      body: "",
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, body: text };
  } catch (e) {
    return { ok: false, status: 0, body: e.message };
  }
}

function addLog(userId, username, email, code, wsId, route, status, httpCode, body) {
  db.prepare(
    `INSERT INTO logs (user_id, username, email, code, workspace_id, route, status, http_code, response_body)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(userId, username, email, code, wsId, route, status, httpCode, body.slice(0, 1000));
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

// ==================== ADMIN: Generate codes ====================
bot.onText(/\/generate(?: (\d+))?/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, "❌ Admin only command.");
  }

  const count = parseInt(match[1]) || 1;
  if (count > 100) {
    return bot.sendMessage(chatId, "❌ Max 100 codes at a time.");
  }

  const insert = db.prepare(`INSERT OR IGNORE INTO codes (code) VALUES (?)`);
  const codes = [];
  let created = 0;

  for (let i = 0; i < count; i++) {
    const code = "WS-" + crypto.randomBytes(6).toString("hex").toUpperCase();
    const result = insert.run(code);
    if (result.changes > 0) {
      codes.push(code);
      created++;
    }
  }

  if (codes.length > 0) {
    const codeList = codes.join("\n");
    bot.sendMessage(chatId, `✅ Created *${created}* code(s):\n\n\`${codeList}\``, {
      parse_mode: "Markdown",
    });
  } else {
    bot.sendMessage(chatId, "❌ Failed to generate codes.");
  }
});

// ==================== ADMIN: Stats ====================
bot.onText(/\/stats/, (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, "❌ Admin only command.");
  }

  const totalCodes = db.prepare(`SELECT COUNT(*) as count FROM codes`).get();
  const usedCodes = db.prepare(`SELECT COUNT(*) as count FROM codes WHERE is_used = 1`).get();
  const unusedCodes = db.prepare(`SELECT COUNT(*) as count FROM codes WHERE is_used = 0`).get();
  const totalLogs = db.prepare(`SELECT COUNT(*) as count FROM logs`).get();
  const successLogs = db.prepare(`SELECT COUNT(*) as count FROM logs WHERE status = 'success'`).get();

  bot.sendMessage(chatId,
    `📊 *Bot Statistics*\n\n` +
    `🔢 Total codes: ${totalCodes.count}\n` +
    `✅ Used: ${usedCodes.count}\n` +
    `🆕 Available: ${unusedCodes.count}\n` +
    `📝 Total operations: ${totalLogs.count}\n` +
    `🎯 Successful: ${successLogs.count}`,
    { parse_mode: "Markdown" }
  );
});

// ==================== ADMIN: List unused codes ====================
bot.onText(/\/codes/, (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, "❌ Admin only command.");
  }

  const codes = db.prepare(`SELECT code, created_at FROM codes WHERE is_used = 0 ORDER BY id DESC LIMIT 30`).all();
  if (codes.length === 0) {
    return bot.sendMessage(chatId, "⚠️ No available codes. Use /generate to create new ones.");
  }

  const codeList = codes.map((c) => `\`${c.code}\` | ${c.created_at}`).join("\n");
  bot.sendMessage(chatId, `🆕 *Last 30 Available Codes:*\n\n${codeList}`, { parse_mode: "Markdown" });
});

// ==================== ADMIN: Send code to user ====================
bot.onText(/\/sendcode (\d+) (.+)/, (msg, match) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);

  if (!isAdmin(userId)) {
    return bot.sendMessage(chatId, "❌ Admin only command.");
  }

  const targetUserId = match[1];
  const code = match[2].trim().toUpperCase();

  const existing = db.prepare(`SELECT * FROM codes WHERE code = ?`).get(code);
  if (!existing) {
    return bot.sendMessage(chatId, "❌ Code not found.");
  }
  if (existing.is_used) {
    return bot.sendMessage(chatId, "❌ This code has already been used.");
  }

  bot.sendMessage(targetUserId,
    `🎁 *Your activation code has arrived!*\n\n` +
    `📟 Code: \`${code}\`\n\n` +
    `🌐 Activate here: https://YOUR_USERNAME.github.io/workspace-bot/\n\n` +
    `📝 *To activate:* Open the link, paste your code, and press Activate.`,
    { parse_mode: "Markdown" }
  ).then(() => {
    bot.sendMessage(chatId, `✅ Code sent to user ${targetUserId}`);
  }).catch(() => {
    bot.sendMessage(chatId, `❌ Failed to send code. Make sure the user has started a chat with the bot.`);
  });
});

// ==================== USER: Start ====================
bot.onText(/\/start/, (msg) => {
  const chatId = msg.chat.id;
  userState[chatId] = { step: "await_input" };

  bot.sendMessage(chatId,
    `👋 *Welcome to the ChatGPT Workspace Activation Bot*\n\n` +
    `🔐 Send your activation code + Access Token in this format:\n` +
    `\`CODE eyJhbGciOi...\`\n\n` +
    `📌 *How to get your Access Token:*\n` +
    `1. Go to https://chatgpt.com and log in\n` +
    `2. Open https://chatgpt.com/api/auth/session\n` +
    `3. Copy the entire \`accessToken\` value\n` +
    `4. Send it here with your code\n\n` +
    `📟 Example: \`WS-ABC123 eyJhbGciOi...\`\n\n` +
    `🌐 *Or use our web activator:* https://YOUR_USERNAME.github.io/workspace-bot/`,
    { parse_mode: "Markdown" }
  );
});

// ==================== USER: Process activation ====================
bot.on("message", async (msg) => {
  const chatId = msg.chat.id;
  const userId = String(msg.from.id);
  const username = msg.from.username || msg.from.first_name || "unknown";

  if (msg.text && msg.text.startsWith("/")) return;

  const state = userState[chatId];
  if (!state || state.step !== "await_input" || !msg.text) return;

  const text = msg.text.trim();
  const parts = text.split(/\s+/);

  if (parts.length < 2) {
    return bot.sendMessage(chatId,
      "❌ *Invalid format*\n\n" +
      "Send your code followed by the Access Token, separated by a space:\n" +
      "`WS-ABC123 eyJhbGciOi...`",
      { parse_mode: "Markdown" }
    );
  }

  const code = parts[0].toUpperCase();
  const at = parts.slice(1).join("");

  const codeRecord = db.prepare(`SELECT * FROM codes WHERE code = ?`).get(code);

  if (!codeRecord) {
    return bot.sendMessage(chatId, "❌ *Invalid code.* Please check your code and try again.", {
      parse_mode: "Markdown",
    });
  }

  if (codeRecord.is_used) {
    const usedBy = codeRecord.used_by;
    const usedAt = codeRecord.used_at;
    return bot.sendMessage(chatId,
      `❌ *This code has already been used*\n\n` +
      `📅 Used on: ${usedAt}\n` +
      `👤 Used by: ${usedBy}`,
      { parse_mode: "Markdown" }
    );
  }

  const decoded = parseJwt(at);
  if (!decoded || !decoded.email) {
    return bot.sendMessage(chatId,
      "❌ *Invalid Access Token*\n\n" +
      "Make sure:\n" +
      "• You copied the full token\n" +
      "• You are logged in at chatgpt.com\n" +
      "• The token hasn't expired",
      { parse_mode: "Markdown" }
    );
  }

  if (decoded.exp * 1000 < Date.now()) {
    return bot.sendMessage(chatId, "❌ *Token expired.* Log in again and get a fresh token.", {
      parse_mode: "Markdown",
    });
  }

  const minLeft = Math.round((decoded.exp * 1000 - Date.now()) / 60000);
  const timeStr = minLeft > 60 ? `${Math.round(minLeft / 60)} hours` : `${minLeft} minutes`;

  const statusMsg = await bot.sendMessage(chatId,
    `⏳ *Processing your request...*\n\n` +
    `📧 Account: ${decoded.email}\n` +
    `💎 Plan: ${decoded.plan_type || "Unknown"}\n` +
    `⏱ Expires in: ${timeStr}\n\n` +
    `🔄 Trying workspaces...`,
    { parse_mode: "Markdown" }
  );

  db.prepare(`UPDATE codes SET is_used = 1, used_by = ?, used_at = datetime('now') WHERE code = ?`)
    .run(`${username} (${userId})`, code);

  let success = false;
  let resultWsId = "";
  let resultRoute = "";
  let resultStatus = 0;
  let resultBody = "";

  for (const wsId of WORKSPACE_IDS) {
    try {
      await bot.editMessageText(
        `⏳ *Attempting...*\n\n` +
        `📧 ${decoded.email}\n` +
        `🏢 Workspace: \`${wsId.slice(0, 12)}...\`\n` +
        `📨 Route: request`,
        {
          chat_id: chatId,
          message_id: statusMsg.message_id,
          parse_mode: "Markdown",
        }
      );

      const res = await sendInvite(at, wsId, "request");

      if (res.ok) {
        success = true;
        resultWsId = wsId;
        resultRoute = "request";
        resultStatus = res.status;
        resultBody = res.body;
        addLog(userId, username, decoded.email, code, wsId, "request", "success", res.status, res.body);
        break;
      }

      addLog(userId, username, decoded.email, code, wsId, "request", "failed", res.status, res.body);

      if (res.status === 401 || res.status === 403 || res.status === 404) {
        await bot.editMessageText(
          `⏳ *Attempting...*\n\n` +
          `📧 ${decoded.email}\n` +
          `🏢 Workspace: \`${wsId.slice(0, 12)}...\`\n` +
          `📨 Request failed (HTTP ${res.status})\n` +
          `🔄 Trying accept...`,
          {
            chat_id: chatId,
            message_id: statusMsg.message_id,
            parse_mode: "Markdown",
          }
        );

        const res2 = await sendInvite(at, wsId, "accept");

        if (res2.ok) {
          success = true;
          resultWsId = wsId;
          resultRoute = "accept";
          resultStatus = res2.status;
          resultBody = res2.body;
          addLog(userId, username, decoded.email, code, wsId, "accept", "success", res2.status, res2.body);
          break;
        }

        addLog(userId, username, decoded.email, code, wsId, "accept", "failed", res2.status, res2.body);
      }

      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      addLog(userId, username, decoded.email, code, wsId, "request", "error", 0, e.message);
    }
  }

  if (success) {
    await bot.editMessageText(
      `✅ *Activation successful!*\n\n` +
      `📧 Account: ${decoded.email}\n` +
      `💎 Plan: ${decoded.plan_type || "Unknown"}\n` +
      `🏢 Workspace: \`${resultWsId}\`\n` +
      `📨 Route: ${resultRoute}\n` +
      `📡 HTTP: ${resultStatus}\n` +
      `📝 Response: ${resultBody.slice(0, 200)}\n\n` +
      `🎉 Your account has been added to the workspace!`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "Markdown",
      }
    );

    ADMIN_IDS.forEach((adminId) => {
      bot.sendMessage(adminId,
        `💰 *New Sale!*\n\n` +
        `📟 Code: \`${code}\`\n` +
        `👤 User: ${username} (${userId})\n` +
        `📧 Email: ${decoded.email}\n` +
        `🏢 Workspace: \`${resultWsId}\`\n` +
        `✅ Success`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    });
  } else {
    await bot.editMessageText(
      `❌ *Activation failed*\n\n` +
      `📧 ${decoded.email}\n` +
      `🔄 Tried ${WORKSPACE_IDS.length} workspace(s)\n` +
      `⚠️ All attempts failed\n\n` +
      `🔧 Your code has been restored and can be used again.`,
      {
        chat_id: chatId,
        message_id: statusMsg.message_id,
        parse_mode: "Markdown",
      }
    );

    db.prepare(`UPDATE codes SET is_used = 0, used_by = NULL, used_at = NULL WHERE code = ?`).run(code);

    ADMIN_IDS.forEach((adminId) => {
      bot.sendMessage(adminId,
        `⚠️ *Activation Failed*\n\n` +
        `📟 Code: \`${code}\`\n` +
        `👤 User: ${username}\n` +
        `📧 ${decoded.email}\n` +
        `❌ All workspaces failed\n` +
        `🔄 Code restored`,
        { parse_mode: "Markdown" }
      ).catch(() => {});
    });
  }

  userState[chatId] = { step: "await_input" };
});

// ==================== USER: Help ====================
bot.onText(/\/help/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId,
    `📚 *Help*\n\n` +
    `1. Get your Access Token:\n` +
    `   • Go to chatgpt.com and log in\n` +
    `   • Open /api/auth/session\n` +
    `   • Copy the accessToken value\n\n` +
    `2. Send: \`CODE accessToken\`\n\n` +
    `Example: \`WS-ABC123 eyJhbGciOi...\`\n\n` +
    `The bot will activate your account automatically ✅`,
    { parse_mode: "Markdown" }
  );
});

// ==================== USER: Status ====================
bot.onText(/\/status/, (msg) => {
  const chatId = msg.chat.id;
  bot.sendMessage(chatId, `🟢 *Bot is online and ready to process activations*`, {
    parse_mode: "Markdown",
  });
});

// ==================== API for web page ====================
const app = express();
app.use(express.json());

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.header("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

app.post("/check-code", (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ valid: false, message: "No code provided" });

  const record = db.prepare("SELECT * FROM codes WHERE code = ?").get(code.toUpperCase());
  if (!record) return res.json({ valid: false, message: "Code not found" });
  if (record.is_used) return res.json({ valid: false, message: "Code already used" });

  return res.json({ valid: true, message: "Code is valid" });
});

app.post("/use-code", (req, res) => {
  const { code } = req.body;
  if (!code) return res.json({ ok: false });

  db.prepare("UPDATE codes SET is_used = 1, used_by = 'web', used_at = datetime('now') WHERE code = ?").run(code.toUpperCase());
  return res.json({ ok: true });
});

app.listen(process.env.PORT || 3000, () => {
  console.log("API server running on port " + (process.env.PORT || 3000));
});

console.log("✅ Bot is running...");
console.log(`📊 Loaded ${WORKSPACE_IDS.length} workspaces`);
