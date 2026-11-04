// Leave paste shortcuts to the browser's ClipboardEvent. Forwarding Ctrl+V
// to a PTY sends SYN (0x16), which terminal agents can interpret as image paste.
export function browserPasteKey(event) {
    const paste = !event.altKey &&
        ((event.key?.toLowerCase() === 'v' && (event.ctrlKey || event.metaKey)) ||
            (event.key === 'Insert' && event.shiftKey && !event.ctrlKey && !event.metaKey));
    return !paste;
}
