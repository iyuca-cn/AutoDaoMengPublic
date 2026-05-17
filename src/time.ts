export const USER_TIMEZONE_HEADER = "X-User-Timezone";
export const USER_TIMEZONE_QUERY = "tz";
export const DEFAULT_USER_TIMEZONE = "UTC";

export function userTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || DEFAULT_USER_TIMEZONE;
  } catch {
    return DEFAULT_USER_TIMEZONE;
  }
}

export function formatUserDateTime(value?: string): string {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: userTimeZone(),
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(date);
}

export function withUserTimeZoneQuery(path: string): string {
  const timeZone = userTimeZone();
  if (!timeZone) {
    return path;
  }
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}${USER_TIMEZONE_QUERY}=${encodeURIComponent(timeZone)}`;
}

