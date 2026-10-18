/** Lets a generated UI (SendMessage action) post a chat message without prop-drilling the chat controller. */
let handler: ((text: string) => void) | null = null;

export function setGenUiMessageHandler(h: ((text: string) => void) | null): void {
  handler = h;
}

export function sendFromGenUi(text: string): void {
  handler?.(text);
}
