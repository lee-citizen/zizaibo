/**
 * 可靠的剪贴板写入工具。
 *
 * 优先使用 navigator.clipboard.writeText（安全上下文），
 * 失败时降级为 textarea + document.execCommand('copy')，
 * 兼容 Electron file:// 协议等非安全上下文场景。
 *
 * 必须在用户手势（点击等）的同步调用栈中触发。
 */
export async function copyToClipboard(text: string): Promise<void> {
  const value = String(text ?? "");
  if (!value) return;

  // 1) 优先使用 Clipboard API
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // 继续降级
    }
  }

  // 2) 降级：textarea + execCommand('copy')
  const textarea = document.createElement("textarea");
  textarea.value = value;
  // 防止 iOS 缩放与滚动
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "0";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    if (!ok) {
      throw new Error("execCommand('copy') returned false");
    }
  } finally {
    document.body.removeChild(textarea);
  }
}
