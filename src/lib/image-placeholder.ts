// next/image 的 blur placeholder 用 —— 1×1 透明 PNG，~70 字节
// 加载时显示一个柔和的纯色（"empty"），完成后渐入真实图。
// 注意：必须用 base64 PNG，不能用 SVG（next 不认 SVG 的 blurDataURL）
export const IMAGE_BLUR_PLACEHOLDER =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
