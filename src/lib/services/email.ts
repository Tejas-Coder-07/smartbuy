import "server-only";
import nodemailer from "nodemailer";
import { gmailConfig } from "@/lib/config";

export type EmailResult = { status: "sent" } | { status: "skipped"; reason: string } | { status: "failed"; error: string };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * Sends one email through Gmail using an app password.
 * When Gmail is not configured the alert still appears in-app.
 */
export async function sendEmail(input: {
  to: string;
  subject: string;
  heading: string;
  lines: string[];
  action?: { label: string; url: string };
}): Promise<EmailResult> {
  const config = gmailConfig();
  if (!config) return { status: "skipped", reason: "Gmail is not configured" };

  const text = [input.heading, "", ...input.lines, ...(input.action ? ["", `${input.action.label}: ${input.action.url}`] : []), "", "— SmartBuy"].join("\n");

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#F4F5FA;font-family:Arial,Helvetica,sans-serif;color:#171A3A">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #DADDEA;border-radius:10px;padding:28px">
    <p style="margin:0 0 4px;font-size:13px;color:#5C6080">SmartBuy price alert</p>
    <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3">${escapeHtml(input.heading)}</h1>
    ${input.lines.map((l) => `<p style="margin:0 0 10px;font-size:15px;line-height:1.5">${escapeHtml(l)}</p>`).join("\n    ")}
    ${
      input.action
        ? `<p style="margin:20px 0 0"><a href="${escapeHtml(input.action.url)}" style="display:inline-block;background:#3538CD;color:#ffffff;text-decoration:none;font-weight:bold;font-size:14px;padding:11px 18px;border-radius:8px">${escapeHtml(input.action.label)}</a></p>`
        : ""
    }
    <p style="margin:24px 0 0;font-size:12px;line-height:1.5;color:#5C6080">Prices can change between our check and your purchase. Confirm the price on the store's page before buying.</p>
  </div>
</body></html>`;

  try {
    const transport = nodemailer.createTransport({
      service: "gmail",
      auth: { user: config.user, pass: config.pass },
    });
    await transport.sendMail({
      from: { name: config.fromName, address: config.user },
      to: input.to,
      subject: input.subject,
      text,
      html,
    });
    return { status: "sent" };
  } catch (err) {
    return { status: "failed", error: err instanceof Error ? err.message.slice(0, 300) : "Unknown email error" };
  }
}
