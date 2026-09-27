import { BRAND } from "../config.js";

const ESCAPES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ESCAPES[c]);

const dateFmt = (date) =>
    new Intl.DateTimeFormat("fr-FR", { dateStyle: "short", timeStyle: "medium" }).format(date);

function renderEmbeds(embeds = []) {
    return embeds
        .map((embed) => {
            const title = embed.title ? `<div class="embed-title">${escapeHtml(embed.title)}</div>` : "";
            const description = embed.description
                ? `<div class="embed-desc">${escapeHtml(embed.description).replace(/\n/g, "<br>")}</div>`
                : "";
            const fields = (embed.fields ?? [])
                .map(
                    (field) =>
                        `<div class="embed-field"><div class="embed-field-name">${escapeHtml(field.name)}</div><div>${escapeHtml(field.value).replace(/\n/g, "<br>")}</div></div>`,
                )
                .join("");
            const image = embed.image?.url ? `<img class="embed-image" src="${escapeHtml(embed.image.url)}">` : "";
            return `<div class="embed">${title}${description}${fields}${image}</div>`;
        })
        .join("");
}

function renderMessage(message) {
    const author = message.author;
    const avatar = author.displayAvatarURL?.({ extension: "png", size: 64 });
    const attachments = message.attachments.size
        ? `<div class="attachments">${[...message.attachments.values()]
              .map((file) => {
                  const isImage = (file.contentType ?? "").startsWith("image/");
                  return isImage
                      ? `<a href="${escapeHtml(file.url)}" target="_blank"><img class="attachment" src="${escapeHtml(file.url)}" alt=""></a>`
                      : `<a class="file" href="${escapeHtml(file.url)}" target="_blank">📎 ${escapeHtml(file.name)}</a>`;
              })
              .join("")}</div>`
        : "";
    const content = message.content
        ? `<div class="content">${escapeHtml(message.content).replace(/\n/g, "<br>")}</div>`
        : "";
    const edited = message.editedAt ? `<span class="edited">(modifié)</span>` : "";

    return `<div class="message">
  <img class="avatar" src="${escapeHtml(avatar)}" alt="">
  <div class="body">
    <div class="meta"><span class="author" style="color:#${(author.displayHexColor ?? "#ffffff").replace("#", "")}">${escapeHtml(author.tag ?? author.username)}</span><span class="time">${dateFmt(message.createdAt)}</span>${edited}</div>
    ${content}${renderEmbeds(message.embeds)}${attachments}
  </div>
</div>`;
}

function renderHtml(channel, messages, meta) {
    const rows = messages.map(renderMessage).join("\n");
    return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(meta.title)} — ${escapeHtml(channel.name)}</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 32px 16px; font-family: "gg sans", "Segoe UI", Helvetica, Arial, sans-serif; background: #313338; color: #dbdee1; }
  .wrap { max-width: 860px; margin: 0 auto; }
  header { background: #2b2d31; border: 1px solid #1e1f22; border-radius: 12px; padding: 20px 24px; margin-bottom: 24px; }
  header h1 { margin: 0 0 8px; font-size: 20px; color: #f2f3f5; }
  header p { margin: 4px 0; font-size: 13px; color: #949ba4; }
  header .accent { color: ${"#" + BRAND.colors.brand.toString(16).padStart(6, "0")}; font-weight: 600; }
  .message { display: flex; gap: 14px; padding: 10px 12px; border-radius: 8px; }
  .message:hover { background: #2e3035; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; flex: 0 0 40px; background: #1e1f22; }
  .body { flex: 1; min-width: 0; }
  .meta { display: flex; align-items: baseline; gap: 8px; margin-bottom: 4px; }
  .author { font-weight: 600; }
  .time, .edited { font-size: 11px; color: #949ba4; }
  .content { white-space: pre-wrap; word-wrap: break-word; line-height: 1.4; }
  .embed { margin-top: 8px; padding: 12px 14px; border-left: 4px solid #4f545c; background: #2b2d31; border-radius: 6px; max-width: 560px; }
  .embed-title { font-weight: 700; color: #f2f3f5; margin-bottom: 6px; }
  .embed-desc { font-size: 14px; }
  .embed-field { margin-top: 8px; font-size: 13px; }
  .embed-field-name { font-weight: 600; color: #f2f3f5; }
  .embed-image, .attachment { max-width: 100%; border-radius: 6px; margin-top: 8px; display: block; }
  .file { display: inline-block; margin-top: 6px; color: #00a8fc; text-decoration: none; }
  footer { margin: 32px auto 0; max-width: 860px; text-align: center; font-size: 12px; color: #949ba4; }
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${escapeHtml(meta.title)} <span class="accent">#${escapeHtml(String(meta.number ?? ""))}</span></h1>
  <p>Salon : <strong>#${escapeHtml(channel.name)}</strong> • ${escapeHtml(meta.type ?? "")}</p>
  <p>Ouvert par : ${escapeHtml(meta.userTag ?? "inconnu")} (${escapeHtml(meta.userId ?? "?")})</p>
  <p>Fermé par : ${escapeHtml(meta.closedByTag ?? "inconnu")} le ${escapeHtml(dateFmt(meta.closedAt ?? new Date()))}</p>
  <p>${escapeHtml(String(messages.length))} message(s) archivé(s) • ${escapeHtml(BRAND.name)}</p>
</header>
${rows}
</div>
<footer>Transcription générée par ${escapeHtml(BRAND.name)} • ${escapeHtml(BRAND.website)}</footer>
</body>
</html>`;
}

/** Fetch every message of a channel (up to `limit`) and render a standalone HTML transcript. */
export async function buildTranscript(channel, meta = {}, { limit = 2000 } = {}) {
    const messages = [];
    let before;
    let truncated = false;

    while (messages.length < limit) {
        const batch = await channel.messages.fetch({ limit: Math.min(100, limit - messages.length), before });
        if (batch.size === 0) break;
        messages.push(...batch.values());
        before = batch.last().id;
        if (batch.size < 100) break;
        if (messages.length >= limit) {
            truncated = true;
            break;
        }
    }

    messages.reverse();
    const html = renderHtml(channel, messages, { ...meta, truncated });
    return { html, count: messages.length, truncated };
}
