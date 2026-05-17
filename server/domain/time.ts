export const USER_TIMEZONE_HEADER = "x-user-timezone";
export const USER_TIMEZONE_QUERY = "tz";
export const DEFAULT_USER_TIMEZONE = "UTC";

export interface UserTimeContext {
  timeZone: string;
}

export function userTimeContextFromRequest(request: Request): UserTimeContext {
  const url = new URL(request.url);
  return {
    timeZone: normalizeTimeZone(request.headers.get(USER_TIMEZONE_HEADER) || url.searchParams.get(USER_TIMEZONE_QUERY)),
  };
}

export function normalizeTimeZone(value: unknown): string {
  const timeZone = String(value ?? "").trim();
  if (!timeZone) {
    return DEFAULT_USER_TIMEZONE;
  }
  try {
    new Intl.DateTimeFormat("zh-CN", { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_USER_TIMEZONE;
  }
}

export function formatUserDateTime(value: string | Date | undefined, context: UserTimeContext): string {
  if (!value) {
    return "";
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: context.timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

