export async function createInterviewEvent(params: {
  accessToken: string;
  refreshToken: string;
  jobTitle: string;
  company: string;
  interviewDate: Date;
  notes?: string;
}): Promise<string> {
  const { accessToken, refreshToken, jobTitle, company, interviewDate, notes } = params;

  // Attempt with current access token; refresh once if expired
  const token = await getValidToken(accessToken, refreshToken);

  const endDate = new Date(interviewDate.getTime() + 60 * 60 * 1000); // +1 hour

  const event = {
    summary: `Interview — ${jobTitle} at ${company}`,
    description: notes
      ? `Job application interview. Applied via JobAgent.\n\nNotes: ${notes}`
      : "Job application interview. Applied via JobAgent.",
    start: { dateTime: interviewDate.toISOString() },
    end: { dateTime: endDate.toISOString() },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 1440 },
        { method: "popup", minutes: 60 },
      ],
    },
  };

  const res = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary/events",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    }
  );

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(
      `Google Calendar API error: ${res.status} — ${JSON.stringify(err)}`
    );
  }

  const data = await res.json();
  return data.htmlLink as string;
}

async function getValidToken(
  accessToken: string,
  refreshToken: string
): Promise<string> {
  // Try a lightweight API call to test the access token
  const test = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/primary",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (test.ok) return accessToken;

  // Token expired — refresh it
  const refreshRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!refreshRes.ok) {
    throw new Error("Failed to refresh Google access token");
  }

  const refreshData = await refreshRes.json();
  return refreshData.access_token as string;
}
