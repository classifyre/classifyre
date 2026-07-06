/**
 * Stable event codes for connector activity and connection-test results.
 * The API stores/serves the code + params so the web UI can translate them;
 * the English template here is rendered server-side as the fallback text
 * (and for server logs). Placeholders use the web i18n syntax: {{name}}.
 */
export const CHAT_EVENT_TEMPLATES = {
  // Connector lifecycle
  connectorStarted: 'Connector started.',
  connectorStartFailed: 'Failed to start: {{reason}}',
  // Slack
  socketConnected: 'Socket Mode connected.',
  socketDisconnected: 'Socket Mode disconnected: {{reason}}',
  slackAuthenticated: 'Authenticated as @{{user}} in workspace {{team}}.',
  slackMention: 'Mention from {{user}} in {{channel}}.',
  slackThreadMessage: 'Thread message from {{user}} in {{channel}}.',
  slackReplyPosted: 'Reply posted to thread {{thread}} ({{chars}} chars).',
  eventFailed: 'Event handling failed: {{reason}}',
  // Telegram
  telegramAuthenticated:
    'Authenticated as @{{username}}; long-polling started.',
  telegramPollFailed: 'Poll failed: {{reason}}',
  telegramMessage: 'Message from user {{user}} in chat {{chat}}.',
  telegramReplySent: 'Reply sent to chat {{chat}} ({{chars}} chars).',
  // Agent turn
  processing: 'Processing message — the agent is working on a reply…',
  turnFailed: 'Agent turn failed: {{reason}}',
  // Connection-test checks
  telegramTokenRejected: 'Bot token rejected: {{reason}}',
  telegramWebhookConflict:
    'A webhook is registered ({{url}}) — long-polling cannot receive messages. Delete the webhook to use this bot here.',
  telegramPollingOk:
    'No webhook registered — long-polling can receive messages.',
  telegramWebhookInfoFailed: 'Could not read webhook info: {{reason}}',
  slackBotTokenRejected: 'Bot token (xoxb-…) rejected: {{reason}}',
  slackAppTokenMissing:
    'No app-level token stored — Socket Mode cannot connect.',
  slackAppTokenOk:
    'App token accepted — Socket Mode connections can be opened.',
  slackAppTokenRejected: 'App token (xapp-…) rejected: {{reason}}',
} as const;

export type ChatEventCode = keyof typeof CHAT_EVENT_TEMPLATES;

/** Render the English fallback text for an event. */
export function renderChatEvent(
  code: ChatEventCode,
  params: Record<string, string> = {},
): string {
  return CHAT_EVENT_TEMPLATES[code].replace(
    /\{\{(\w+)\}\}/g,
    (_match, key: string) => params[key] ?? `{{${key}}}`,
  );
}
