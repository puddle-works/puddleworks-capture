// The few Slack Web API calls the Capture app makes, over fetch. The bot
// token makes every call except opening a Socket Mode connection, which
// takes the app-level token.

export interface SlackTokens {
  bot: string;
  app: string;
}

/** A Slack call that answered ok: false. */
export class SlackError extends Error {
  constructor(readonly method: string, readonly code: string) {
    super(`Slack ${method} failed: ${code}`);
  }
}

export type SlackCall = (
  method: string,
  body: Record<string, unknown>,
) => Promise<Record<string, unknown>>;

/** Calls the Web API at `baseUrl` (https://slack.com/api, or a fake in tests). */
export function slackApi(
  tokens: SlackTokens,
  baseUrl = "https://slack.com/api",
  fetcher: typeof fetch = fetch,
): SlackCall {
  return async (method, body) => {
    const token = method === "apps.connections.open" ? tokens.app : tokens.bot;
    // users.info and users.lookupByEmail take form arguments, not JSON.
    const form = method.startsWith("users.");
    const response = await fetcher(`${baseUrl}/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": form
          ? "application/x-www-form-urlencoded"
          : "application/json; charset=utf-8",
      },
      body: form
        ? new URLSearchParams(body as Record<string, string>).toString()
        : JSON.stringify(body),
    });
    const data = await response.json() as Record<string, unknown>;
    if (data.ok !== true) {
      throw new SlackError(method, String(data.error ?? response.status));
    }
    return data;
  };
}
