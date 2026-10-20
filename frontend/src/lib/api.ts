const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// What /api/auth/login/ and /api/auth/me/ return.
export type Me = {
  username: string;
  role: string;
  must_change_password: boolean;
};

// A 401 from these endpoints does not mean "access token expired".
const NO_REFRESH = ["/api/auth/login/", "/api/auth/refresh/", "/api/auth/logout/"];

// Shared by every request that gets a 401 at the same time.
let refreshing: Promise<boolean> | null = null;

function refreshTokens(): Promise<boolean> {
  if (refreshing === null) {
    refreshing = fetch(`${API_URL}/api/auth/refresh/`, {
      method: "POST",
      credentials: "include",
    })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function apiFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  const send = () =>
    fetch(`${API_URL}${path}`, { ...options, headers, credentials: "include" });

  const response = await send();
  if (response.status !== 401 || NO_REFRESH.includes(path)) {
    return response;
  }

  const refreshed = await refreshTokens();
  return refreshed ? send() : response;
}
