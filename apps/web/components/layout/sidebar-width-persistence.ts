export const LEFT_SIDEBAR_WIDTH_COOKIE_NAME = "left_sidebar_width_px";
export const LEFT_SIDEBAR_WIDTH_CSS_VARIABLE = "--left-sidebar-width";
export const LEFT_SIDEBAR_WIDTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const LEFT_SIDEBAR_MIN_WIDTH_PX = 240;
export const LEFT_SIDEBAR_DEFAULT_WIDTH_PX = 288;
export const LEFT_SIDEBAR_MAX_WIDTH_PX = 420;
export const RIGHT_SIDEBAR_WIDTH_COOKIE_NAME = "right_sidebar_width_px";
export const RIGHT_SIDEBAR_WIDTH_CSS_VARIABLE = "--app-right-sidebar-width";
export const RIGHT_SIDEBAR_WIDTH_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;
export const APP_RIGHT_SIDEBAR_MIN_WIDTH_PX = 240;
export const APP_RIGHT_SIDEBAR_DEFAULT_WIDTH_PX = 288;
export const APP_RIGHT_SIDEBAR_MAX_WIDTH_PX = 880;

export function clampLeftSidebarWidth(widthPx: number): number {
  return Math.min(
    LEFT_SIDEBAR_MAX_WIDTH_PX,
    Math.max(LEFT_SIDEBAR_MIN_WIDTH_PX, Math.round(widthPx)),
  );
}

export function parseLeftSidebarWidth(
  widthValue: string | null | undefined,
  fallbackWidthPx = LEFT_SIDEBAR_DEFAULT_WIDTH_PX,
): number {
  if (!widthValue) {
    return clampLeftSidebarWidth(fallbackWidthPx);
  }

  const parsedWidth = Number.parseInt(widthValue, 10);
  return Number.isFinite(parsedWidth)
    ? clampLeftSidebarWidth(parsedWidth)
    : clampLeftSidebarWidth(fallbackWidthPx);
}

export function clampRightSidebarWidth(widthPx: number): number {
  return Math.min(
    APP_RIGHT_SIDEBAR_MAX_WIDTH_PX,
    Math.max(APP_RIGHT_SIDEBAR_MIN_WIDTH_PX, Math.round(widthPx)),
  );
}

export function parseRightSidebarWidth(
  widthValue: string | null | undefined,
  fallbackWidthPx = APP_RIGHT_SIDEBAR_DEFAULT_WIDTH_PX,
): number {
  if (!widthValue) {
    return clampRightSidebarWidth(fallbackWidthPx);
  }

  const parsedWidth = Number.parseInt(widthValue, 10);
  return Number.isFinite(parsedWidth)
    ? clampRightSidebarWidth(parsedWidth)
    : clampRightSidebarWidth(fallbackWidthPx);
}
